import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";

describe("facts.archive_reason / replaced_by_fact_id / revival_at (P0-4)", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-archive-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("facts table has new archive_reason / replaced_by_fact_id / revival_at columns", () => {
    const cols = db
      .query("PRAGMA table_info('facts')")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("archive_reason");
    expect(names).toContain("replaced_by_fact_id");
    expect(names).toContain("revival_at");
  });

  test("archive_reason CHECK constraint rejects unknown values", () => {
    // Seed minimal observation chain
    db.run("INSERT INTO source VALUES ('s1','file:///t','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///t',datetime('now'),datetime('now'),'h1','r1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL)"
    );
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('f1','s','p','o','obs1')"
    );

    expect(() => {
      db.run(
        "UPDATE facts SET archive_reason = 'bogus_reason' WHERE fact_id = 'f1'"
      );
    }).toThrow();
  });

  test("archive_reason accepts all 6 valid values", () => {
    db.run("INSERT INTO source VALUES ('s1','file:///t','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///t',datetime('now'),datetime('now'),'h1','r1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL)"
    );
    const validReasons = [
      "stale",
      "superseded",
      "contradicted",
      "duplicate",
      "low_access",
      "manual",
    ];
    for (const reason of validReasons) {
      const fid = `f-${reason}`;
      db.run(
        "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, archive_reason) VALUES (?,?,?,?,?,?)",
        [fid, "s", "p", "o", "obs1", reason]
      );
    }
    const count = db
      .query("SELECT COUNT(*) AS c FROM facts WHERE archive_reason IS NOT NULL")
      .get() as { c: number };
    expect(count.c).toBe(6);
  });

  test("replaced_by_fact_id REFERENCES facts(fact_id)", () => {
    db.run("INSERT INTO source VALUES ('s1','file:///t','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///t',datetime('now'),datetime('now'),'h1','r1',NULL,NULL,'text/plain','test',1,'user','idem1','tp-2026-04',NULL)"
    );
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('f1','s','p','o','obs1')"
    );
    // Inserting a fact pointing to non-existent replacement should fail FK
    expect(() => {
      db.run(
        "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, replaced_by_fact_id) VALUES ('f2','s','p','o','obs1','f-nonexistent')"
      );
    }).toThrow();
  });
});
