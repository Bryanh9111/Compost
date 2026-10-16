import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import {
  isFatalLlmProbeError,
  parsePositiveInteger,
} from "../src/commands/doctor";

import { runCli } from "./run-cli";

function setupDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  upsertPolicies(db);
  return db;
}

function insertOutboxRow(
  db: Database,
  sourceId: string,
  payload: string
): void {
  db.run(
    `INSERT INTO observe_outbox
      (adapter, source_id, source_kind, source_uri, idempotency_key,
       trust_tier, transform_policy, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "test-adapter",
      sourceId,
      "claude-code",
      `claude-code://${sourceId}`,
      `key-${sourceId}-${payload.length}`,
      "first_party",
      "tp-2026-04",
      payload,
    ]
  );
}

describe("doctor --check-pii", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-doctor-pii-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("reports zero findings on clean DB", async () => {
    const db = setupDb(dataDir);
    insertOutboxRow(db, "s1", JSON.stringify({ plain: "clean text" }));
    db.close();

    const result = await runCli(["doctor", "--check-pii"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.rows_scanned).toBe(1);
    expect(report.rows_with_pii).toBe(0);
    expect(report.total_redactions).toBe(0);
  });

  test("detects CC in outbox payload and reports sample", async () => {
    const db = setupDb(dataDir);
    insertOutboxRow(
      db,
      "s-with-cc",
      JSON.stringify({ note: "card 4532015112830366" })
    );
    insertOutboxRow(db, "s-clean", JSON.stringify({ plain: "safe" }));
    db.close();

    const result = await runCli(["doctor", "--check-pii"], dataDir);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.rows_scanned).toBe(2);
    expect(report.rows_with_pii).toBe(1);
    expect(report.total_redactions).toBeGreaterThanOrEqual(1);
    expect(report.sample_sources).toBeArray();
    expect(report.sample_sources[0].source_id).toBe("s-with-cc");
    expect(report.hint).toContain("PII found");
  });

  test("detects multiple PII types across rows", async () => {
    const db = setupDb(dataDir);
    insertOutboxRow(
      db,
      "s-token",
      JSON.stringify({ cmd: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" })
    );
    insertOutboxRow(
      db,
      "s-cc",
      JSON.stringify({ note: "card 4532015112830366" })
    );
    db.close();

    const result = await runCli(["doctor", "--check-pii"], dataDir);
    const report = JSON.parse(result.stdout);
    expect(report.rows_with_pii).toBe(2);
    expect(report.total_redactions).toBeGreaterThanOrEqual(2);
  });
});

describe("doctor --check-integrity", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "compost-doctor-integrity-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("reports zero issues on fresh empty DB", async () => {
    const db = setupDb(dataDir);
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.orphan_observations).toBe(0);
    expect(report.pending_ingest_observations).toBe(0);
    expect(report.dangling_fact_links).toBe(0);
    expect(report.stale_wiki_pages).toBe(0);
    expect(report.quarantined_outbox).toBe(0);
    expect(report.quarantined_ingest).toBe(0);
    expect(report.unembedded_chunks).toBe(0);
    expect(report.embed_error_chunks).toBe(0);
    expect(report.legacy_chunk_ids).toBe(0);
    expect(report.unknown_transform_policies.in_observe_outbox).toBe(0);
    expect(report.unknown_transform_policies.in_observations).toBe(0);
    expect(report.total_issues).toBe(0);
  });

  test("counts quarantined ingest rows as issues and --ingest-retry requeues them", async () => {
    const db = setupDb(dataDir);
    db.run("INSERT INTO source VALUES ('s1','file:///a','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      `INSERT INTO observations VALUES ('obs-q','s1','file:///a',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/markdown','local-file',1,'user','k','tp-2026-04',NULL,NULL,NULL)`
    );
    db.run(
      `INSERT INTO ingest_queue (observe_id, source_kind, priority, attempts, last_error, quarantined_at)
       VALUES ('obs-q', 'local-file', 1, 3, 'extractor exploded', datetime('now'))`
    );
    db.close();

    const before = JSON.parse((await runCli(["doctor", "--check-integrity"], dataDir)).stdout);
    expect(before.quarantined_ingest).toBe(1);
    expect(before.pending_ingest_observations).toBe(0);
    expect(before.orphan_observations).toBe(0);
    expect(before.total_issues).toBe(1);
    expect(before.hint).toContain("--ingest-retry");

    const bad = await runCli(["doctor", "--ingest-retry", "nope"], dataDir);
    expect(bad.exitCode).toBe(1);

    const retry = await runCli(["doctor", "--ingest-retry", "all"], dataDir);
    expect(retry.exitCode).toBe(0);
    expect(JSON.parse(retry.stdout)).toEqual({ requeued: 1 });

    const after = JSON.parse((await runCli(["doctor", "--check-integrity"], dataDir)).stdout);
    expect(after.quarantined_ingest).toBe(0);
    expect(after.pending_ingest_observations).toBe(1);
    expect(after.total_issues).toBe(0);
    const check = new Database(join(dataDir, "ledger.db"), { readonly: true });
    const row = check.query("SELECT attempts, last_error FROM ingest_queue").get() as { attempts: number; last_error: string | null };
    check.close();
    expect(row).toEqual({ attempts: 0, last_error: null });
  });

  test("counts chunk rows that still carry pre-0028 ids as issues", async () => {
    const db = setupDb(dataDir);
    db.run("INSERT INTO source VALUES ('s1','file:///a','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      `INSERT INTO observations VALUES ('obs-l','s1','file:///a',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/markdown','local-file',1,'user','k','tp-2026-04',NULL,NULL,NULL)`
    );
    db.run("INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES ('d1','obs-l','L2','tp-2026-04','succeeded')");
    db.run(
      `INSERT INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, embedded_at)
       VALUES ('c0','obs-l','d1',0,'a','h',0,1,'tp-2026-04',datetime('now'))`
    );
    db.close();
    const report = JSON.parse((await runCli(["doctor", "--check-integrity"], dataDir)).stdout);
    expect(report.legacy_chunk_ids).toBe(1);
    expect(report.total_issues).toBe(1);
    expect(report.hint).toContain("pre-0028");
  });

  test("reports unembedded and isolated chunks without counting them as issues", async () => {
    const db = setupDb(dataDir);
    db.run("INSERT INTO source VALUES ('s1','file:///a','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      `INSERT INTO observations VALUES ('obs-c','s1','file:///a',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/markdown','local-file',1,'user','k','tp-2026-04',NULL,NULL,NULL)`
    );
    db.run("INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status) VALUES ('d1','obs-c','L2','tp-2026-04','succeeded')");
    db.run(
      `INSERT INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, embed_error)
       VALUES ('obs-c:c0','obs-c','d1',0,'a','h',0,1,'tp-2026-04',NULL), ('obs-c:c1','obs-c','d1',1,'b','h',0,1,'tp-2026-04','dim 1')`
    );
    db.close();

    const report = JSON.parse((await runCli(["doctor", "--check-integrity"], dataDir)).stdout);
    expect(report.unembedded_chunks).toBe(1);
    expect(report.embed_error_chunks).toBe(1);
    expect(report.total_issues).toBe(0);
  });

  test("--drain-retry resets drain_attempts along with the quarantine", async () => {
    const db = setupDb(dataDir);
    db.run(
      `INSERT INTO observe_outbox
        (adapter, source_id, source_kind, source_uri, idempotency_key,
         trust_tier, transform_policy, payload, drain_attempts,
         drain_error, drain_quarantined_at)
       VALUES ('test', 's1', 'host-adapter', 'test://s1', 'k1',
               'first_party', 'tp-2026-04', '{}', 6,
               'boom', datetime('now'))`
    );
    db.close();

    const result = await runCli(["doctor", "--drain-retry"], dataDir);
    expect(JSON.parse(result.stdout)).toEqual({ released: 1 });
    const check = new Database(join(dataDir, "ledger.db"), { readonly: true });
    const row = check.query("SELECT drain_attempts, drain_quarantined_at FROM observe_outbox").get() as { drain_attempts: number; drain_quarantined_at: string | null };
    check.close();
    expect(row).toEqual({ drain_attempts: 0, drain_quarantined_at: null });
  });

  test("detects orphan observations (observation without derivation_run)", async () => {
    const db = setupDb(dataDir);
    // Insert source first (FK dependency)
    db.run(
      `INSERT INTO source (id, uri, kind, trust_tier)
       VALUES ('orphan-src', 'test://orphan', 'local-file', 'first_party')`
    );
    db.run(
      `INSERT INTO observations
        (observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, mime_type, adapter, adapter_sequence,
         trust_tier, idempotency_key, transform_policy)
       VALUES ('obs-orphan-1', 'orphan-src', 'test://orphan',
               datetime('now'), datetime('now'),
               'hash1', 'raw1', 'text/plain', 'test-adapter', 1,
               'first_party', 'idem-orphan-1', 'tp-2026-04')`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.orphan_observations).toBe(1);
    expect(report.total_issues).toBeGreaterThanOrEqual(1);
    expect(report.hint).toContain("Integrity issues detected");
  });

  test("does not flag action_log-only observations as orphaned", async () => {
    const db = setupDb(dataDir);
    db.run(
      `INSERT INTO source (id, uri, kind, trust_tier)
       VALUES ('action-src', 'obsidian://note', 'host-adapter', 'first_party')`
    );
    db.run(
      `INSERT INTO observations
        (observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, mime_type, adapter, adapter_sequence,
         trust_tier, idempotency_key, transform_policy)
       VALUES ('obs-action-1', 'action-src', 'obsidian://note',
               datetime('now'), datetime('now'),
               'hash-action-1', 'raw-action-1', 'application/json',
               'compost-adapter-obsidian', 1,
               'first_party', 'idem-action-1', 'tp-2026-04')`
    );
    db.run(
      `INSERT INTO action_log
        (action_id, source_system, source_id, source_observe_id, who,
         what_text, project)
       VALUES ('action-1', 'obsidian', 'obsidian:test', 'obs-action-1',
               'user', 'Obsidian note changed', 'Constellation')`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.orphan_observations).toBe(0);
    expect(report.total_issues).toBe(0);
  });

  test("reports in-flight ingest separately instead of as an orphan", async () => {
    const db = setupDb(dataDir);
    db.run(
      `INSERT INTO source (id, uri, kind, trust_tier)
       VALUES ('pending-src', 'test://pending', 'local-file', 'first_party')`
    );
    db.run(
      `INSERT INTO observations
        (observe_id, source_id, source_uri, occurred_at, captured_at,
         content_hash, raw_hash, mime_type, adapter, adapter_sequence,
         trust_tier, idempotency_key, transform_policy)
       VALUES ('obs-pending-1', 'pending-src', 'test://pending',
               datetime('now'), datetime('now'),
               'hash-pending', 'raw-pending', 'text/plain', 'test-adapter', 1,
               'first_party', 'idem-pending', 'tp-2026-04')`
    );
    db.run(
      `INSERT INTO ingest_queue (observe_id, source_kind, priority)
       VALUES ('obs-pending-1', 'local-file', 1)`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    const report = JSON.parse(result.stdout);
    expect(report.orphan_observations).toBe(0);
    expect(report.pending_ingest_observations).toBe(1);
    expect(report.total_issues).toBe(0);
  });

  test("detects unknown transform_policy in observe_outbox", async () => {
    const db = setupDb(dataDir);
    db.run(
      `INSERT INTO observe_outbox
        (adapter, source_id, source_kind, source_uri, idempotency_key,
         trust_tier, transform_policy, payload)
       VALUES ('test', 's1', 'claude-code', 'claude-code://s1', 'k1',
               'first_party', 'tp-nonexistent-2099', '{}')`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    const report = JSON.parse(result.stdout);
    expect(report.unknown_transform_policies.in_observe_outbox).toBe(1);
    expect(report.total_issues).toBeGreaterThanOrEqual(1);
  });

  test("detects quarantined outbox rows", async () => {
    const db = setupDb(dataDir);
    db.run(
      `INSERT INTO observe_outbox
        (adapter, source_id, source_kind, source_uri, idempotency_key,
         trust_tier, transform_policy, payload, drain_attempts,
         drain_error, drain_quarantined_at)
       VALUES ('test', 's1', 'host-adapter', 'test://s1', 'k1',
               'first_party', 'tp-2026-04', '{}', 6,
               'FOREIGN KEY constraint failed', datetime('now'))`
    );
    db.close();

    const result = await runCli(["doctor", "--check-integrity"], dataDir);
    const report = JSON.parse(result.stdout);
    expect(report.quarantined_outbox).toBe(1);
    expect(report.total_issues).toBe(1);
    expect(report.hint).toContain("quarantined outbox");
  });
});

describe("doctor argument validation", () => {
  test("reports error when no option is specified", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "compost-doctor-noarg-"));
    const db = setupDb(dataDir);
    db.close();

    const result = await runCli(["doctor"], dataDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--check-pii");
    expect(result.stderr).toContain("--check-integrity");

    rmSync(dataDir, { recursive: true, force: true });
  });
});

describe("doctor --check-llm helpers", () => {
  test("parses positive integer options with fallback", () => {
    expect(parsePositiveInteger(undefined, 3000)).toBe(3000);
    expect(parsePositiveInteger("12000", 3000)).toBe(12000);
    expect(parsePositiveInteger(4500, 3000)).toBe(4500);
    expect(parsePositiveInteger("0", 3000)).toBe(3000);
    expect(parsePositiveInteger("not-a-number", 3000)).toBe(3000);
  });

  test("treats quick generation timeout as warning unless strict", () => {
    const timeout = { name: "AbortError", message: "The operation was aborted." };
    const realError = { name: "Error", message: "model not found" };

    expect(isFatalLlmProbeError(timeout, false)).toBe(false);
    expect(isFatalLlmProbeError(timeout, true)).toBe(true);
    expect(isFatalLlmProbeError(realError, false)).toBe(true);
  });
});

test('doctor reports dangling access FK and exits nonzero', async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'doctor-fk-'));
 try{
  const db=setupDb(dataDir);db.exec('PRAGMA foreign_keys=OFF');
  db.run("INSERT INTO access_log(fact_id,accessed_at_unix_sec,query_id,ranking_profile_id) VALUES ('missing',0,'q','rp-phase3-default')");db.close();
  const result=await runCli(['doctor','--check-integrity'],dataDir);
  expect(result.exitCode).toBe(1);expect(JSON.parse(result.stdout).foreign_key_violations).toHaveLength(1);
 }finally{rmSync(dataDir,{recursive:true,force:true});}
});
