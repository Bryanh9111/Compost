import * as lancedb from "@lancedb/lancedb";
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, rmSync } from "fs";
import { join } from "path";

const TABLE = "chunk_vectors";
const DEFAULT_PAGE_SIZE = 5000;

export interface ConsolidateOptions {
  dataDir: string;
  /** Older index directories (e.g. a `-previous` copy) merged behind the live one. */
  includePrevious?: string[];
  apply?: boolean;
  pageSize?: number;
}

export interface ConsolidateReport {
  mode: "dry-run" | "applied";
  sources: Array<{ dir: string; rows: number }>;
  orphans_dropped: number;
  /** Rows of observations with a pending vector cleanup; dropped, queue cleared on apply. */
  gc_pending_dropped: number;
  duplicates_dropped: number;
  ids_rewritten: number;
  written: number;
  live_dir: string;
  previous_dir: string | null;
}

/** Refuses to touch the index while the daemon holds it open. */
export function assertDaemonStopped(dataDir: string): void {
  const pidFile = join(dataDir, "daemon.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf-8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch {
    return; // stale pid file
  }
  throw new Error(`daemon running (pid ${pid}); stop it with \`compost daemon stop\` first`);
}

/** Extractor-local id (c3) behind a namespaced chunk id (observe:c3); uuid ids pass through. */
export function localChunkId(chunkId: string, observeId: string): string {
  const prefix = `${observeId}:`;
  return chunkId.startsWith(prefix) ? chunkId.slice(prefix.length) : chunkId;
}

/** The post-0028 form of a chunk id: namespaced when extractor-local, unchanged otherwise. */
export function canonicalChunkId(chunkId: string, observeId: string): string {
  const local = localChunkId(chunkId, observeId);
  return /^c\d+$/.test(local) ? `${observeId}:${local}` : chunkId;
}

function toNumbers(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  const arrowLike = value as { toArray?: () => ArrayLike<number> } | null;
  if (arrowLike && typeof arrowLike.toArray === "function") return Array.from(arrowLike.toArray());
  throw new Error("unsupported vector value in LanceDB row");
}

async function openSource(dir: string): Promise<{ conn: lancedb.Connection; table: lancedb.Table } | null> {
  if (!existsSync(dir)) return null;
  const conn = await lancedb.connect(dir);
  if (!(await conn.tableNames()).includes(TABLE)) {
    conn.close();
    return null;
  }
  return { conn, table: await conn.openTable(TABLE) };
}

/**
 * Rebuild the vector index from one or more LanceDB directories without
 * re-embedding: keep rows whose observation still exists, dedupe by
 * (observe_id, local chunk id) with the live index winning, rewrite legacy
 * extractor-local ids to the namespaced form, and write a compacted table.
 * Apply swaps it in atomically and keeps the old live index as `-previous`.
 */
export async function consolidateVectors(
  db: Database,
  opts: ConsolidateOptions
): Promise<ConsolidateReport> {
  const liveDir = join(opts.dataDir, "lancedb");
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const report: ConsolidateReport = {
    mode: opts.apply ? "applied" : "dry-run",
    sources: [],
    orphans_dropped: 0,
    gc_pending_dropped: 0,
    duplicates_dropped: 0,
    ids_rewritten: 0,
    written: 0,
    live_dir: liveDir,
    previous_dir: null,
  };
  const known = new Set(
    (db.query("SELECT observe_id FROM observations").all() as Array<{ observe_id: string }>).map(
      (r) => r.observe_id
    )
  );
  const gcPending = new Set(
    (db.query("SELECT observe_id FROM vector_gc_queue").all() as Array<{ observe_id: string }>).map((r) => r.observe_id)
  );
  const seen = new Set<string>();
  const outDir = join(opts.dataDir, `lancedb-consolidate-${Date.now()}-${process.pid}`);
  const outConn = opts.apply ? await lancedb.connect(outDir) : null;
  let out: lancedb.Table | null = null;

  try {
    for (const dir of [liveDir, ...(opts.includePrevious ?? [])]) {
      const source = await openSource(dir);
      if (!source) continue;
      let rows = 0;
      try {
        for (let offset = 0; ; offset += pageSize) {
          const page = (await source.table
            .query()
            .select(["chunk_id", "fact_id", "observe_id", "vector"])
            .limit(pageSize)
            .offset(offset)
            .toArray()) as Array<{ chunk_id: string; fact_id: string; observe_id: string; vector: unknown }>;
          if (page.length === 0) break;
          rows += page.length;
          const batch: Array<{ chunk_id: string; fact_id: string; observe_id: string; vector: number[] }> = [];
          for (const row of page) {
            if (!known.has(row.observe_id)) {
              report.orphans_dropped++;
              continue;
            }
            if (gcPending.has(row.observe_id)) {
              report.gc_pending_dropped++;
              continue;
            }
            const key = `${row.observe_id}|${localChunkId(row.chunk_id, row.observe_id)}`;
            if (seen.has(key)) {
              report.duplicates_dropped++;
              continue;
            }
            seen.add(key);
            const chunkId = canonicalChunkId(row.chunk_id, row.observe_id);
            if (chunkId !== row.chunk_id) report.ids_rewritten++;
            report.written++;
            if (outConn) {
              batch.push({ chunk_id: chunkId, fact_id: row.fact_id, observe_id: row.observe_id, vector: toNumbers(row.vector) });
            }
          }
          if (outConn && batch.length > 0) {
            if (out) await out.add(batch);
            else out = await outConn.createTable(TABLE, batch);
          }
          if (page.length < pageSize) break;
        }
      } finally {
        source.table.close();
        source.conn.close();
      }
      report.sources.push({ dir, rows });
    }

    if (!outConn) return report;
    if (!out) {
      // Every row was an orphan or there was no index: the live index (if
      // any) still has to go, or the report would lie about dropped rows.
      outConn.close();
      rmSync(outDir, { recursive: true, force: true });
      if (existsSync(liveDir)) {
        const previous = `${outDir}-previous`;
        renameSync(liveDir, previous);
        report.previous_dir = previous;
        recordAudit(db, report);
      }
      return report;
    }
    const count = await out.countRows();
    if (count !== report.written) {
      throw new Error(`consolidated table holds ${count} rows, expected ${report.written}`);
    }
    await out.optimize();
    out.close();
    outConn.close();
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }

  const previous = `${outDir}-previous`;
  const hadLive = existsSync(liveDir);
  if (hadLive) renameSync(liveDir, previous);
  try {
    renameSync(outDir, liveDir);
  } catch (error) {
    if (hadLive) renameSync(previous, liveDir);
    throw error;
  }
  report.previous_dir = hadLive ? previous : null;
  recordAudit(db, report);
  return report;
}

function recordAudit(db: Database, report: ConsolidateReport): void {
  // The new index no longer holds vectors of queued observations.
  db.run("DELETE FROM vector_gc_queue");
  db.run(
    "INSERT INTO maintenance_audit(operation,target_table,target_id,detail_json) VALUES (?,?,?,?)",
    ["consolidate-vectors", "chunk_vectors", "lancedb", JSON.stringify(report)]
  );
}
