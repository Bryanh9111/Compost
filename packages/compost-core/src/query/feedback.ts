import type { Database } from "bun:sqlite";

export interface FeedbackResult {
  ok: boolean;
  updated: number;
  error?: string;
}

/**
 * Mark a fact as "selected" for a specific query in the ranking audit log.
 * This is the Phase 1 minimal feedback mechanism — just result_selected=TRUE.
 */
export function markResultSelected(
  db: Database,
  queryId: string,
  factId: string
): FeedbackResult {
  const result = db.run(
    `UPDATE ranking_audit_log
     SET result_selected = TRUE
     WHERE query_id = ? AND fact_id = ?`,
    [queryId, factId]
  );

  return {
    ok: true,
    updated: result.changes,
  };
}
