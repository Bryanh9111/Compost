/** Deterministic lexical quality check on disposable SQLite; no LLM or live writes. */
import { Database } from "bun:sqlite";
import { applyMigrations } from "../packages/compost-core/src/schema/migrator";
import { auditCoverage } from "../packages/compost-core/src/metacognitive/coverage-audit";
import fixture from "./fixtures/search-quality.json";

const db = new Database(":memory:");
try {
  const migrations = applyMigrations(db);
  if (migrations.errors.length)
    throw new Error(JSON.stringify(migrations.errors));
  for (const d of fixture.documents)
    db.run(
      `INSERT INTO action_log(action_id,source_system,source_id,who,what_text,project,when_ts,artifact_locations)
 VALUES (?,'manual',?,'user',?,?,'2026-01-01',?)`,
      [d.id, d.id, d.content, d.project, JSON.stringify({ labels: d.tags })],
    );
  // Old positives must remain visible after newer irrelevant history arrives.
  db.transaction(() => {
    for (let i = 0; i < 1100; i++)
      db.run(
        `INSERT INTO action_log(action_id,source_system,source_id,who,what_text,when_ts) VALUES (?,'manual',?,'user','Routine background activity','2026-09-05')`,
        [`noise${i}`, `noise${i}`],
      );
  })();
  const rows = fixture.queries.map((q) => {
    const started = performance.now();
    const hits = auditCoverage(db, q.query, {
      project: q.project,
      limit: 10,
      includeDocs: false,
    }).matched_actions.map((a) => a.action_id);
    const recall = q.expected.length
      ? q.expected.filter((id) => hits.includes(id)).length / q.expected.length
      : null;
    const rank = hits.findIndex((id) => q.expected.includes(id));
    return {
      query: q.query,
      project: q.project,
      expected: q.expected,
      hits,
      recall_at_10: recall,
      reciprocal_rank: rank < 0 ? 0 : 1 / (rank + 1),
      elapsed_ms: performance.now() - started,
      pass: q.expected.length ? recall === 1 : hits.length === 0,
    };
  });
  const positives = rows.filter((r) => r.expected.length > 0);
  const report = {
    cases: rows.length,
    passed: rows.filter((r) => r.pass).length,
    recall_at_10:
      positives.reduce((s, r) => s + (r.recall_at_10 ?? 0), 0) /
      positives.length,
    mrr:
      positives.reduce((s, r) => s + r.reciprocal_rank, 0) / positives.length,
    rows,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.cases) process.exitCode = 1;
} finally {
  db.close();
}
