import type { Database } from "bun:sqlite";
import { extractionTimeoutMs, runExtractor, type ExtractFn } from "../../compost-core/src/pipeline/extractor";
import { namespaceExtractionOutput, namespaceLegacyChunkIds, sha256Hex } from "../../compost-core/src/pipeline/persist-extraction";
import type { ChunkRef } from "../../compost-core/src/storage/lancedb";
import { localChunkId } from "./maintenance-vectors";

export interface BackfillCandidate {
  observe_id: string;
  derivation_id: string;
  transform_policy: string;
  expected_chunks: number;
  existing_chunks: number;
}

export interface BackfillVectorSource {
  listChunkRefs(): Promise<ChunkRef[]>;
  deleteByObserveIds(observeIds: string[]): Promise<void>;
}

export interface BackfillOptions {
  apply?: boolean;
  concurrency?: number;
  /** Process at most this many candidates (operator pacing). */
  limit?: number;
  extract?: ExtractFn;
  vectors?: BackfillVectorSource | null;
  timeoutMs?: number;
}

export interface BackfillReport {
  mode: "dry-run" | "applied";
  candidates: number;
  processed: number;
  inserted_rows: number;
  matched: number;
  mismatched: number;
  failed: number;
  errors: Array<{ observe_id: string; message: string }>;
  sample: string[];
  /** Legacy `cN` rows renamed before the backfill (apply only). */
  legacy_ids_renamed: number;
}

const MAX_REPORTED_ERRORS = 20;

/**
 * Observations whose latest succeeded L2 run produced more chunks than the
 * manifest holds: the rows lost to the pre-0028 chunk id collision.
 */
const CANDIDATES_SQL = `
  WITH latest AS (
    SELECT d.observe_id, d.derivation_id, d.transform_policy,
           CAST(json_extract(d.artifact_ref, '$.chunks') AS INTEGER) AS expected,
           ROW_NUMBER() OVER (PARTITION BY d.observe_id ORDER BY d.finished_at DESC, d.started_at DESC) AS rn
    FROM derivation_run d
    WHERE d.layer = 'L2' AND d.status = 'succeeded' AND d.artifact_ref IS NOT NULL
  ),
  gaps AS (
    SELECT l.observe_id, l.derivation_id, l.transform_policy, l.expected,
           (SELECT count(*) FROM chunks c WHERE c.observe_id = l.observe_id) AS existing
    FROM latest l
    JOIN observations o ON o.observe_id = l.observe_id
    WHERE l.rn = 1
  )
  SELECT observe_id, derivation_id, transform_policy, expected AS expected_chunks, existing AS existing_chunks
  FROM gaps
  WHERE expected > existing
  ORDER BY observe_id`;

export function listBackfillCandidates(db: Database, limit?: number): BackfillCandidate[] {
  const sql = limit === undefined ? CANDIDATES_SQL : `${CANDIDATES_SQL} LIMIT ${Math.max(0, Math.floor(limit))}`;
  return db.query(sql).all() as BackfillCandidate[];
}

export function countBackfillCandidates(db: Database): number {
  const row = db.query(`SELECT count(*) AS n FROM (${CANDIDATES_SQL})`).get() as { n: number };
  return row.n;
}

type VectorIndex = Map<string, Map<string, string>>; // observe_id -> local chunk id -> fact_id

async function loadVectorIndex(vectors: BackfillVectorSource | null | undefined): Promise<VectorIndex> {
  const index: VectorIndex = new Map();
  if (!vectors) return index;
  for (const ref of await vectors.listChunkRefs()) {
    let byLocal = index.get(ref.observe_id);
    if (!byLocal) {
      byLocal = new Map();
      index.set(ref.observe_id, byLocal);
    }
    byLocal.set(localChunkId(ref.chunk_id, ref.observe_id), ref.fact_id);
  }
  return index;
}

function firstActiveFact(db: Database, observeId: string): string | null {
  const row = db
    .query("SELECT fact_id FROM facts WHERE observe_id = ? AND archived_at IS NULL ORDER BY created_at LIMIT 1")
    .get(observeId) as { fact_id: string } | null;
  return row?.fact_id ?? null;
}

/**
 * Re-derive the chunk manifest for candidates by re-running the extractor
 * on the stored raw bytes (chunks only, no LLM). When the re-extraction
 * reproduces exactly the vectors LanceDB holds, the rows are inserted as
 * embedded with their fact mapping; otherwise they are inserted pending and
 * the observation's stale vectors are dropped so the daemon sweep re-embeds.
 */
export async function backfillChunks(db: Database, opts: BackfillOptions = {}): Promise<BackfillReport> {
  const legacyRenamed = opts.apply ? namespaceLegacyChunkIds(db) : 0;
  const candidates = listBackfillCandidates(db, opts.limit);
  const report: BackfillReport = {
    mode: opts.apply ? "applied" : "dry-run",
    candidates: opts.limit === undefined ? candidates.length : countBackfillCandidates(db),
    processed: 0,
    inserted_rows: 0,
    matched: 0,
    mismatched: 0,
    failed: 0,
    errors: [],
    sample: candidates.slice(0, 5).map((c) => c.observe_id),
    legacy_ids_renamed: legacyRenamed,
  };
  if (!opts.apply || candidates.length === 0) return report;

  const extract = opts.extract ?? runExtractor;
  const index = await loadVectorIndex(opts.vectors);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chunks
       (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, fact_id, embedded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const queue = [...candidates];

  async function processOne(candidate: BackfillCandidate): Promise<void> {
    const obs = db
      .query("SELECT source_uri, mime_type, raw_bytes FROM observations WHERE observe_id = ?")
      .get(candidate.observe_id) as { source_uri: string; mime_type: string; raw_bytes: Buffer | null } | null;
    if (!obs) throw new Error("observation vanished");

    const raw = await extract(
      {
        observe_id: candidate.observe_id,
        source_uri: obs.source_uri,
        mime_type: obs.mime_type,
        content_ref: "inline",
        content: obs.raw_bytes ? obs.raw_bytes.toString("utf-8") : "",
        transform_policy: candidate.transform_policy,
        skip_llm_facts: true,
      },
      { timeoutMs: opts.timeoutMs ?? extractionTimeoutMs(0) }
    );
    const output = namespaceExtractionOutput(raw, candidate.observe_id);
    const refs = index.get(candidate.observe_id) ?? new Map<string, string>();
    const complete =
      output.chunks.length === candidate.expected_chunks &&
      output.chunks.every((chunk) => refs.has(localChunkId(chunk.chunk_id, candidate.observe_id)));
    const fallbackFact = complete ? null : firstActiveFact(db, candidate.observe_id);

    let inserted = 0;
    db.transaction(() => {
      output.chunks.forEach((chunk, i) => {
        const factId = complete
          ? (refs.get(localChunkId(chunk.chunk_id, candidate.observe_id)) ?? null)
          : fallbackFact;
        inserted += insert.run(
          chunk.chunk_id,
          candidate.observe_id,
          candidate.derivation_id,
          i,
          chunk.text,
          sha256Hex(chunk.text),
          chunk.metadata?.char_start ?? 0,
          chunk.metadata?.char_end ?? chunk.text.length,
          candidate.transform_policy,
          factId,
          complete ? new Date().toISOString() : null
        ).changes;
      });
    })();

    if (!complete) {
      // Rows that already existed (legacy partial manifest) keep stale
      // embedded_at markers otherwise; the whole observation is re-embedded.
      db.run("UPDATE chunks SET embedded_at = NULL, embed_error = NULL WHERE observe_id = ?", [candidate.observe_id]);
      if (refs.size > 0 && opts.vectors) await opts.vectors.deleteByObserveIds([candidate.observe_id]);
    }
    report.inserted_rows += inserted;
    if (complete) report.matched++;
    else report.mismatched++;
  }

  async function worker(): Promise<void> {
    for (;;) {
      const candidate = queue.shift();
      if (!candidate) return;
      try {
        await processOne(candidate);
      } catch (err) {
        report.failed++;
        if (report.errors.length < MAX_REPORTED_ERRORS) {
          report.errors.push({ observe_id: candidate.observe_id, message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        report.processed++;
      }
    }
  }

  const workers = Math.max(1, Math.min(opts.concurrency ?? 1, queue.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  db.run(
    "INSERT INTO maintenance_audit(operation,target_table,target_id,detail_json) VALUES (?,?,?,?)",
    ["backfill-chunks", "chunks", "batch", JSON.stringify({ ...report, errors: report.errors.length })]
  );
  return report;
}
