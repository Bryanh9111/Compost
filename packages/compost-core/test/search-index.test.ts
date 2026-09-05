import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../src/schema/migrator";
import { auditCoverage } from "../src/metacognitive/coverage-audit";
import { query } from "../src/query/search";
import type { VectorStore } from "../src/storage/lancedb";

let db: Database;
beforeEach(() => {
  db = new Database(":memory:");
  expect(applyMigrations(db).errors).toEqual([]);
});
afterEach(() => db.close());
function action(
  id: string,
  text: string,
  project = "compost",
  artifact = "{}",
) {
  db.run(
    `INSERT INTO action_log(action_id,source_system,source_id,who,what_text,when_ts,project,artifact_locations)
 VALUES (?,'codex',?,'agent',?,'2026-01-01',?,?)`,
    [id, id, text, project, artifact],
  );
}
function seedFact() {
  db.exec(`INSERT INTO source VALUES ('s','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL);
 INSERT INTO observations VALUES ('o','s','file:///test',datetime('now'),datetime('now'),'h','raw',NULL,NULL,'text/plain','test',1,'user','i','tp-2026-04',NULL,NULL,NULL);
 INSERT INTO facts(fact_id,subject,predicate,object,confidence,importance,observe_id,last_reinforced_at_unix_sec,half_life_seconds)
 VALUES ('f','付款','约束','我们使用整数分保存金额并改进检索速度',0.9,0.7,'o',strftime('%s','now'),2592000);`);
}
test("topic and artifact search cover history beyond the newest 1000 actions", () => {
  action(
    "old",
    "历史检索改造",
    "compost",
    JSON.stringify({ path: "archive/unique-design.md" }),
  );
  db.transaction(() => {
    for (let i = 0; i < 1100; i++)
      action(`noise${i}`, "routine unrelated work");
  })();
  db.run("UPDATE action_log SET when_ts='2026-09-05' WHERE action_id!='old'");
  for (const q of ["检索", "unique-design.md"])
    expect(
      auditCoverage(db, q, { includeDocs: false }).matched_actions.map(
        (a) => a.action_id,
      ),
    ).toContain("old");
  expect(
    auditCoverage(db, "检索", { project: "other", includeDocs: false })
      .matched_actions,
  ).toEqual([]);
});
test("CJK phrases preserve adjacency and follow raw SQL updates/deletes", () => {
  action("a", "整数与数分来自不同位置");
  expect(
    auditCoverage(db, "整数分", { includeDocs: false }).matched_actions,
  ).toEqual([]);
  db.run(
    "UPDATE action_log SET what_text='金额必须使用整数分' WHERE action_id='a'",
  );
  expect(
    auditCoverage(db, "整数分", { includeDocs: false }).matched_actions,
  ).toHaveLength(1);
  db.run("DELETE FROM action_log WHERE action_id='a'");
  expect(
    auditCoverage(db, "整数分", { includeDocs: false }).matched_actions,
  ).toEqual([]);
});
test("time range query uses the expression index including stable secondary ordering", () => {
  const plan = db
    .query(
      "EXPLAIN QUERY PLAN SELECT action_id FROM action_log WHERE project=? AND julianday(when_ts)>=julianday(?) ORDER BY julianday(when_ts) DESC,created_at DESC LIMIT 50",
    )
    .all("compost", "2026-01-01");
  expect(JSON.stringify(plan)).toContain("idx_action_log_project_epoch");
  expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
});
test("facts support two-character and longer CJK queries and archive filtering", async () => {
  seedFact();
  for (const q of ["检索", "整数分", "f"])
    expect((await query(db, q)).hits.map((h) => h.fact_id)).toContain("f");
  db.run("UPDATE facts SET archived_at=datetime('now') WHERE fact_id='f'");
  expect((await query(db, "检索")).hits).toEqual([]);
});
test("slow optional semantic search cannot hold lexical results hostage", async () => {
  seedFact();
  const vector = {
    search: () => new Promise(() => {}),
  } as unknown as VectorStore;
  const started = performance.now();
  const result = await query(db, "检索", { semantic_timeout_ms: 20 }, vector);
  expect(result.hits.map((h) => h.fact_id)).toContain("f");
  expect(performance.now() - started).toBeLessThan(1000);
});

test("index diagnostics detect lost postings and rebuild preserves canonical rows", async () => {
  const { searchIndexStatus, rebuildSearchIndexes } = await import(
    "../src/query/search-index"
  );
  seedFact();
  action("a", "可靠检索证据");
  const before = db.query("SELECT * FROM action_log").all();
  db.run("INSERT INTO actions_fts(actions_fts) VALUES('delete-all')");
  db.run("DELETE FROM facts_cjk");
  expect(searchIndexStatus(db).ok).toBe(false);
  expect(rebuildSearchIndexes(db).ok).toBe(true);
  expect(db.query("SELECT * FROM action_log").all()).toEqual(before);
  expect(
    auditCoverage(db, "检索", { includeDocs: false }).matched_actions,
  ).toHaveLength(1);
  db.run("INSERT INTO action_log_cjk(rowid,grams) VALUES(99999,'orphan')");
  expect(searchIndexStatus(db).indexes[0]?.orphan).toBe(1);
  expect(rebuildSearchIndexes(db).ok).toBe(true);
});

test("failed rebuild rolls back all index changes", async () => {
  const { rebuildSearchIndexes } = await import("../src/query/search-index");
  action("a", "transactional index history");
  db.run(
    "CREATE TRIGGER fail_search_rebuild BEFORE UPDATE ON search_index_state BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  );
  expect(() => rebuildSearchIndexes(db)).toThrow("injected failure");
  expect(
    auditCoverage(db, "transactional", { includeDocs: false }).matched_actions,
  ).toHaveLength(1);
});

test("context filters apply before lexical candidate truncation", async () => {
  seedFact();
  db.exec(
    "INSERT INTO context(id,display_name) VALUES('target','target'); INSERT INTO fact_context(fact_id,context_id) VALUES('f','target')",
  );
  db.transaction(() => {
    for (let i = 0; i < 205; i++)
      db.run(
        `INSERT INTO facts(fact_id,subject,predicate,object,observe_id) VALUES (?,'检索','关联','检索','o')`,
        [`n${i}`],
      );
  })();
  expect(
    (await query(db, "检索", { contexts: ["target"] })).hits.map(
      (h) => h.fact_id,
    ),
  ).toEqual(["f"]);
});

test("escaped Unicode artifact values are searchable", () => {
  action(
    "a",
    "archive pointer",
    "compost",
    '{"path":"notes/\\u68c0\\u7d22.md"}',
  );
  expect(
    auditCoverage(db, "检索", { includeDocs: false }).matched_actions,
  ).toHaveLength(1);
});
