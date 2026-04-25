import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations, getMigrationStatus } from "../src/schema/migrator";

describe("migrator", () => {
  let dbPath: string;
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-test-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("applyMigrations creates tracking table and applies all 18 migrations", () => {
    const result = applyMigrations(db);

    expect(result.applied).toHaveLength(18);
    expect(result.applied.map((m) => m.name)).toEqual([
      "0001_init",
      "0002_debate3_fixes",
      "0003_stateless_decay",
      "0004_probabilistic_ranking",
      "0005_merged_outbox",
      "0006_chunks_and_fts5",
      "0007_phase2_search",
      "0008_phase3_ranking",
      "0009_phase3_contradiction_and_wiki_versions",
      "0010_phase4_myco_integration",
      "0011_fact_links_and_health_fix",
      "0012_correction_signal_kind",
      "0013_wiki_stale_at",
      "0014_origin_hash_and_method",
      "0015_user_model_schema",
      "0016_open_problems",
      "0017_crawl_queue",
      "0018_reasoning_chains",
    ]);
    expect(result.errors).toHaveLength(0);
  });

  test("applyMigrations is idempotent - second run applies nothing", () => {
    applyMigrations(db);
    const result = applyMigrations(db);

    expect(result.applied).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test("all expected tables exist after migration (+ FTS5 virtual table)", () => {
    applyMigrations(db);

    const tables = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_compost_migrations' AND name NOT LIKE 'facts_fts_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toEqual([
      "access_log",
      "captured_item",
      "chunks",
      "context",
      "correction_events",        // 0010 P0-5
      "crawl_queue",              // 0017 Phase 6 P0 user-approved crawl queue
      "decision_audit",           // 0010 P0-2
      "derivation_run",
      "expected_item",
      "fact_context",
      "fact_links",               // 0011 P0-0
      "facts",
      "facts_fts",
      "graph_health_snapshot",    // 0010 P0-3 (rebuilt in 0011 with DEFAULTs)
      "health_signals",           // 0010 P0-1
      "ingest_queue",
      "observations",
      "observe_outbox",
      "open_problems",            // 0016 Phase 6 P0 gap tracker
      "policies",
      "ranking_audit_log",
      "ranking_profile",
      "reasoning_chains",         // 0018 Phase 7 L5 (debate 025)
      "source",
      "source_context",
      "user_pattern_events",      // 0015 user model schema
      "user_pattern_observations",// 0015
      "user_patterns",            // 0015
      "web_fetch_state",
      "wiki_page_observe",
      "wiki_page_versions",
      "wiki_pages",
    ]);
  });

  test("WAL mode and foreign keys are enabled after migration", () => {
    applyMigrations(db);

    const wal = db.query("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    const fk = db.query("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };

    expect(wal.journal_mode).toBe("wal");
    expect(fk.foreign_keys).toBe(1);
  });

  test("ranking_profile seed data exists", () => {
    applyMigrations(db);

    const row = db
      .query("SELECT profile_id, name, w1_semantic FROM ranking_profile")
      .get() as { profile_id: string; name: string; w1_semantic: number };

    expect(row.profile_id).toBe("rp-phase1-default");
    expect(row.name).toBe("Phase 1 semantic only");
    expect(row.w1_semantic).toBe(1.2);
  });

  test("FK CASCADE: deleting observation cascades to facts, ingest_queue, captured_item", () => {
    applyMigrations(db);

    // Insert test data chain: source -> observation -> facts + ingest_queue + captured_item
    db.run("INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL,NULL,NULL)"
    );
    db.run("INSERT INTO ingest_queue(observe_id, source_kind, priority) VALUES ('obs1','local-file',1)");
    db.run("INSERT INTO captured_item VALUES ('s1','ext1',datetime('now'),'obs1')");
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id) VALUES ('f1','s','p','o','obs1')"
    );

    // Delete the observation
    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");

    // All should be cascade-deleted
    const queueCount = db.query("SELECT count(*) as cnt FROM ingest_queue").get() as { cnt: number };
    const factCount = db.query("SELECT count(*) as cnt FROM facts").get() as { cnt: number };
    const capturedCount = db.query("SELECT count(*) as cnt FROM captured_item").get() as { cnt: number };

    expect(queueCount.cnt).toBe(0);
    expect(factCount.cnt).toBe(0);
    expect(capturedCount.cnt).toBe(0);
  });

  test("observe_outbox.observe_id ON DELETE SET NULL", () => {
    applyMigrations(db);

    db.run("INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      "INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL,NULL,NULL)"
    );
    db.run(
      "INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload,drained_at,observe_id) VALUES ('test','s1','local-file','file:///test','idem1','user','tp-2026-04','{}',datetime('now'),'obs1')"
    );

    db.run("DELETE FROM observations WHERE observe_id = 'obs1'");

    const row = db.query("SELECT observe_id FROM observe_outbox WHERE seq = 1").get() as {
      observe_id: string | null;
    };
    expect(row.observe_id).toBeNull();
  });

  test("getMigrationStatus returns correct status", () => {
    // Before any migrations
    const before = getMigrationStatus(db);
    expect(before.applied).toHaveLength(0);
    expect(before.pending).toHaveLength(18);

    // After all migrations
    applyMigrations(db);
    const after = getMigrationStatus(db);
    expect(after.applied).toHaveLength(18);
    expect(after.pending).toHaveLength(0);
  });

  test("ingest_queue lease columns exist after 0002", () => {
    applyMigrations(db);

    const cols = db
      .query("PRAGMA table_info(ingest_queue)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("lease_owner");
    expect(colNames).toContain("lease_token");
    expect(colNames).toContain("lease_expires_at");
  });

  test("facts decay columns exist after 0003", () => {
    applyMigrations(db);

    const cols = db.query("PRAGMA table_info(facts)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain("last_reinforced_at_unix_sec");
    expect(colNames).toContain("half_life_seconds");
  });
});
