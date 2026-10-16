import type { Database } from "bun:sqlite";

const INDEXES = [
  { name: "actions", source: "action_log", fts: "actions_fts" },
  { name: "facts", source: "facts", fts: "facts_fts" },
] as const;
interface IndexState {
  name: string;
  version: number;
  source_revision: number;
  indexed_revision: number;
  indexed_at: string;
  rebuilt_at: string;
}

/** Lock contention is transient and must never be reported as index corruption. */
export function isSqliteLockError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return (
    code === "SQLITE_BUSY" ||
    (typeof message === "string" && message.includes("database is locked"))
  );
}

/** FTS control commands need the writer; the savepoint keeps the probe read-only on disk. */
function probeIndex(
  db: Database,
  source: string,
  fts: string,
): string | undefined {
  db.exec("SAVEPOINT integrity_probe");
  try {
    db.run(`INSERT INTO ${fts}(${fts},rank) VALUES('integrity-check',1)`);
    db.run(
      `INSERT INTO ${source}_cjk(${source}_cjk) VALUES('integrity-check')`,
    );
    return undefined;
  } catch (e) {
    if (isSqliteLockError(e)) throw e;
    return e instanceof Error ? e.message : String(e);
  } finally {
    db.exec("ROLLBACK TO integrity_probe; RELEASE integrity_probe");
  }
}

/** Caller must already hold the write lock (BEGIN IMMEDIATE). */
function collectStatus(db: Database) {
  const indexes = INDEXES.map(({ name, source, fts }) => {
    const state = db
      .query("SELECT * FROM search_index_state WHERE name=?")
      .get(name) as IndexState;
    const changed = (
      db
        .query(
          `SELECT count(*) AS n FROM ${source}_cjk_source s LEFT JOIN ${source}_cjk i ON i.rowid=s.rowid WHERE i.rowid IS NULL OR i.grams!=s.grams`,
        )
        .get() as { n: number }
    ).n;
    const orphan = (
      db
        .query(
          `SELECT count(*) AS n FROM ${source}_cjk i LEFT JOIN ${source} s ON s.rowid=i.rowid WHERE s.rowid IS NULL`,
        )
        .get() as { n: number }
    ).n;
    const error = probeIndex(db, source, fts);
    return {
      ...state,
      mode: "synchronous" as const,
      missing_or_changed: changed,
      orphan,
      error,
      ok:
        changed === 0 &&
        orphan === 0 &&
        !error &&
        state.source_revision === state.indexed_revision,
    };
  });
  return { ok: indexes.every((i) => i.ok), indexes };
}

/** Explicit diagnostic: compares projections and checks actual FTS postings.
 * BEGIN IMMEDIATE up front so busy_timeout applies; a deferred read that later
 * upgrades to the probe's write fails with "database is locked" immediately. */
export function searchIndexStatus(db: Database) {
  return db.transaction(() => collectStatus(db)).immediate();
}

/** Rebuild both lexical paths as one transaction, preserving all source records. */
export function rebuildSearchIndexes(db: Database) {
  return db
    .transaction(() => {
      for (const { name, source, fts } of INDEXES) {
        db.run(`INSERT INTO ${fts}(${fts}) VALUES('rebuild')`);
        db.run(`DELETE FROM ${source}_cjk`);
        db.run(
          `INSERT INTO ${source}_cjk(rowid,grams) SELECT rowid,grams FROM ${source}_cjk_source`,
        );
        db.run(
          "UPDATE search_index_state SET indexed_revision=source_revision,rebuilt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name=?",
          [name],
        );
      }
      const report = collectStatus(db);
      if (!report.ok)
        throw new Error("Search index verification failed; rebuild rolled back");
      return report;
    })
    .immediate();
}
