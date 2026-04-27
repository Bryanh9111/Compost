import type { Database } from "bun:sqlite";
import pino from "pino";

const log = pino({ name: "compost-daemon" });
const DEFAULT_STALE_HOURS = 1;
const RECOVERY_ERROR = "daemon restart - reclaimed by recoverStaleRuns";

export function recoverStaleRuns(
  db: Database,
  opts: { staleHours?: number } = {}
): void {
  const staleHours = opts.staleHours ?? DEFAULT_STALE_HOURS;
  const cutoff = `-${staleHours} hours`;

  const row = db
    .query(
      `SELECT count(*) AS count
       FROM derivation_run
       WHERE status = 'running'
         AND started_at < datetime('now', ?)`
    )
    .get(cutoff) as { count: number | bigint } | null;
  const recoveredCount = Number(row?.count ?? 0);

  db.run(
    `UPDATE derivation_run
     SET status = 'failed',
         finished_at = datetime('now'),
         error = ?
     WHERE status = 'running'
       AND started_at < datetime('now', ?)`,
    [RECOVERY_ERROR, cutoff]
  );

  if (recoveredCount > 0) {
    log.warn(
      { recovered_count: recoveredCount },
      "recovered stale derivation_run rows on startup"
    );
  } else {
    log.info({ recovered_count: 0 }, "no stale derivation_run rows on startup");
  }
}
