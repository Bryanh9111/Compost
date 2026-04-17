import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";

describe("user_model schema (Migration 0015)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-user-model-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("user_patterns has expected columns and defaults", () => {
    const cols = db.query("PRAGMA table_info(user_patterns)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    const byName = new Map(cols.map((c) => [c.name, c]));

    // Primary + core
    // Note: SQLite TEXT PRIMARY KEY does not set PRAGMA notnull=1 (only
    // INTEGER PRIMARY KEY aliases ROWID and enforces NOT NULL). PK uniqueness
    // constraint is still enforced; matches existing compost-core convention.
    expect(byName.has("pattern_id")).toBe(true);
    expect(byName.get("pattern_kind")?.notnull).toBe(1);
    expect(byName.get("description")?.notnull).toBe(1);
    expect(byName.get("derivation_policy")?.notnull).toBe(1);
    expect(byName.get("last_reinforced_at_unix_sec")?.notnull).toBe(1);

    // Defaults
    expect(byName.get("confidence")?.dflt_value).toBe("0.5");
    expect(byName.get("status")?.dflt_value).toBe("'active'");
    expect(byName.get("observed_count")?.dflt_value).toBe("1");
    expect(byName.get("half_life_seconds")?.dflt_value).toBe("7776000");

    // Nullables
    expect(byName.get("derived_from_fact_ids")?.notnull).toBe(0);
    expect(byName.get("engram_memory_id")?.notnull).toBe(0);
    expect(byName.get("user_reviewed_at")?.notnull).toBe(0);
    expect(byName.get("user_verdict")?.notnull).toBe(0);
    expect(byName.get("project")?.notnull).toBe(0);
  });

  test("pattern_kind CHECK accepts known values and rejects unknown", () => {
    const insert = (kind: string) =>
      db.run(
        `INSERT INTO user_patterns
         (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec)
         VALUES (?, ?, 'd', 'policy-a', 1000)`,
        [`p-${kind}`, kind]
      );

    expect(() => insert("writing_style")).not.toThrow();
    expect(() => insert("decision_heuristic")).not.toThrow();
    expect(() => insert("blind_spot")).not.toThrow();
    expect(() => insert("recurring_question")).not.toThrow();
    expect(() => insert("skill_growth")).not.toThrow();
    expect(() => insert("typo_kind")).toThrow();
  });

  test("status CHECK rejects unknown values", () => {
    expect(() =>
      db.run(
        `INSERT INTO user_patterns
         (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec, status)
         VALUES ('p1', 'writing_style', 'd', 'p', 1000, 'bogus')`
      )
    ).toThrow();
  });

  test("user_verdict CHECK accepts NULL and the three verdict values", () => {
    db.run(
      `INSERT INTO user_patterns
       (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec, user_verdict)
       VALUES ('p-null', 'writing_style', 'd', 'p', 1000, NULL)`
    );
    db.run(
      `INSERT INTO user_patterns
       (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec, user_verdict)
       VALUES ('p-c', 'writing_style', 'd', 'p', 1000, 'confirmed')`
    );
    db.run(
      `INSERT INTO user_patterns
       (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec, user_verdict)
       VALUES ('p-r', 'writing_style', 'd', 'p', 1000, 'rejected')`
    );
    db.run(
      `INSERT INTO user_patterns
       (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec, user_verdict)
       VALUES ('p-f', 'writing_style', 'd', 'p', 1000, 'refined')`
    );
    expect(() =>
      db.run(
        `INSERT INTO user_patterns
         (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec, user_verdict)
         VALUES ('p-bad', 'writing_style', 'd', 'p', 1000, 'maybe')`
      )
    ).toThrow();
  });

  test("user_pattern_observations cascade-deletes on pattern or observation delete", () => {
    // Seed source + observation
    db.run(
      "INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)"
    );
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL,NULL,NULL)"
    );
    db.run(
      `INSERT INTO user_patterns
       (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec)
       VALUES ('p1', 'writing_style', 'd', 'policy', 1000)`
    );
    db.run(
      "INSERT INTO user_pattern_observations(pattern_id, observe_id) VALUES ('p1', 'obs1')"
    );

    // Cascade via observation delete
    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");
    const afterObsDelete = db
      .query("SELECT count(*) AS cnt FROM user_pattern_observations")
      .get() as { cnt: number };
    expect(afterObsDelete.cnt).toBe(0);

    // Re-seed and cascade via pattern delete
    db.run(
      "INSERT INTO observations VALUES ('obs2','s1','file:///test',datetime('now'),datetime('now'),'h2','r2',NULL,NULL,'text/plain','test',1,'user','idem2','tp-2026-04',NULL,NULL,NULL)"
    );
    db.run(
      "INSERT INTO user_pattern_observations(pattern_id, observe_id) VALUES ('p1', 'obs2')"
    );
    db.run("DELETE FROM user_patterns WHERE pattern_id = 'p1'");
    const afterPatternDelete = db
      .query("SELECT count(*) AS cnt FROM user_pattern_observations")
      .get() as { cnt: number };
    expect(afterPatternDelete.cnt).toBe(0);
  });

  test("user_pattern_events cascade-deletes on pattern delete and CHECK restricts event_kind", () => {
    db.run(
      `INSERT INTO user_patterns
       (pattern_id, pattern_kind, description, derivation_policy, last_reinforced_at_unix_sec)
       VALUES ('p2', 'blind_spot', 'd', 'policy', 1000)`
    );
    db.run(
      "INSERT INTO user_pattern_events(event_id, pattern_id, event_kind, event_data) VALUES ('e1','p2','created','{}')"
    );

    expect(() =>
      db.run(
        "INSERT INTO user_pattern_events(event_id, pattern_id, event_kind) VALUES ('e2','p2','invented_kind')"
      )
    ).toThrow();

    db.run("DELETE FROM user_patterns WHERE pattern_id = 'p2'");
    const cnt = db
      .query("SELECT count(*) AS cnt FROM user_pattern_events")
      .get() as { cnt: number };
    expect(cnt.cnt).toBe(0);
  });

  test("expected indexes exist", () => {
    const idx = db
      .query(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_user_%' OR name LIKE 'idx_pattern_%' ORDER BY name`
      )
      .all() as { name: string }[];
    const names = idx.map((i) => i.name);

    expect(names).toContain("idx_user_patterns_kind_status");
    expect(names).toContain("idx_user_patterns_engram");
    expect(names).toContain("idx_user_patterns_project_kind");
    expect(names).toContain("idx_pattern_obs_observe");
    expect(names).toContain("idx_pattern_events_pattern");
  });
});
