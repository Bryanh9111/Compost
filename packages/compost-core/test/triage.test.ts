import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  triage,
  resolveSignal,
  scanStuckOutbox,
  scanStaleWiki,
  scanStaleFact,
  scanUnresolvedContradiction,
  scanOrphanDelta,
  type SignalKind,
} from "../src/cognitive/triage";
import { addLink } from "../src/cognitive/fact-links";

/**
 * P0-1 Week 4 Day 2 — first 2 of 6 scanners (stuck_outbox + stale_wiki),
 * resolveSignal, aggregate. Day 3 adds the other 4 scanners + CLI.
 *
 * Contract: debates/011-week4-plan/contract.md pins 6 SignalKind values.
 */

const SOURCE_ROW =
  "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)";
const OBS_ROW =
  "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','payload',1,'user','idem','tp-2026-04',NULL)";

function seedSource(db: Database): void {
  db.run(SOURCE_ROW);
}

function seedSourceAndObs(db: Database): void {
  db.run(SOURCE_ROW);
  db.run(OBS_ROW);
}

function insertFact(
  db: Database,
  factId: string,
  subject: string,
  predicate: string,
  object: string,
  opts: {
    confidence?: number;
    pinned?: boolean;
    reinforcedDaysAgo?: number;
    createdAtSqlExpr?: string;
    conflictGroup?: number | null;
  } = {}
): void {
  const reinforceSec =
    Math.floor(Date.now() / 1000) - (opts.reinforcedDaysAgo ?? 0) * 86_400;
  const createdAtExpr = opts.createdAtSqlExpr ?? "datetime('now')";
  db.run(
    `INSERT INTO facts(
       fact_id, subject, predicate, object, observe_id,
       confidence, importance, importance_pinned,
       last_reinforced_at_unix_sec, half_life_seconds, created_at, conflict_group
     ) VALUES (?, ?, ?, ?, 'obs1', ?, 0.5, ?, ?, 2592000, ${createdAtExpr}, ?)`,
    [
      factId,
      subject,
      predicate,
      object,
      opts.confidence ?? 0.8,
      opts.pinned ? 1 : 0,
      reinforceSec,
      opts.conflictGroup ?? null,
    ]
  );
}

function insertOutboxRow(
  db: Database,
  seq: number,
  appendedAtSqlExpr: string,
  drainedAt: string | null = null
): void {
  db.run(
    `INSERT INTO observe_outbox (
       seq, adapter, source_id, source_kind, source_uri,
       idempotency_key, trust_tier, transform_policy, payload,
       appended_at, drained_at, drain_error, drain_attempts, drain_quarantined_at
     ) VALUES (?, 'test-adapter', 's1', 'local-file', 'file:///x',
       'idem-' || ?, 'user', 'tp-2026-04', '{}',
       ${appendedAtSqlExpr}, ?, NULL, 0, NULL)`,
    [seq, seq, drainedAt]
  );
}

function insertWikiPage(
  db: Database,
  path: string,
  title: string,
  synthAtSqlExpr: string,
  staleAt: string | null = null
): void {
  db.run(
    `INSERT INTO wiki_pages (path, title, last_synthesis_at, last_synthesis_model, stale_at)
     VALUES (?, ?, ${synthAtSqlExpr}, 'mock', ?)`,
    [path, title, staleAt]
  );
}

describe("triage P0-1 schema + empty-DB report", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-schema-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("health_signals table exists with all columns", () => {
    const cols = db
      .query("PRAGMA table_info('health_signals')")
      .all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual([
      "created_at",
      "id",
      "kind",
      "message",
      "resolved_at",
      "resolved_by",
      "severity",
      "target_ref",
    ]);
  });

  test("triage on empty DB returns zero signals", () => {
    const report = triage(db);
    expect(report.unresolvedTotal).toBe(0);
    expect(report.signals).toHaveLength(0);
  });

  test("byKind covers all 6 contract values (0010 original 5 + 0012 correction_candidate)", () => {
    const report = triage(db);
    expect(Object.keys(report.byKind).sort()).toEqual([
      "correction_candidate",
      "orphan_delta",
      "stale_fact",
      "stale_wiki",
      "stuck_outbox",
      "unresolved_contradiction",
    ]);
  });

  test("health_signals CHECK accepts correction_candidate (added by 0012)", () => {
    db.run(
      "INSERT INTO health_signals (kind, severity, message, target_ref) VALUES (?, ?, ?, ?)",
      ["correction_candidate", "info", "test correction signal", "fact-test-1"]
    );
    const row = db
      .query("SELECT kind FROM health_signals WHERE target_ref = 'fact-test-1'")
      .get() as { kind: string };
    expect(row.kind).toBe("correction_candidate");
  });

  test("SignalKind union type exports all 6 contract values", () => {
    const kinds: SignalKind[] = [
      "stale_fact",
      "unresolved_contradiction",
      "stuck_outbox",
      "orphan_delta",
      "stale_wiki",
      "correction_candidate",
    ];
    expect(kinds).toHaveLength(6);
  });
});

describe("triage P0-1 scanStuckOutbox", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-stuck-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedSource(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits signal for un-drained row older than threshold", () => {
    insertOutboxRow(db, 1, "datetime('now', '-48 hours')");
    const inserted = scanStuckOutbox(db, 24, 100);
    expect(inserted).toBe(1);

    const row = db
      .query(
        "SELECT kind, severity, target_ref FROM health_signals WHERE kind = 'stuck_outbox'"
      )
      .get() as { kind: string; severity: string; target_ref: string };
    expect(row.kind).toBe("stuck_outbox");
    expect(row.severity).toBe("warn");
    expect(row.target_ref).toBe("outbox:1");
  });

  test("does NOT emit for drained, quarantined, or fresh rows", () => {
    insertOutboxRow(db, 1, "datetime('now', '-48 hours')", "datetime('now')");
    insertOutboxRow(db, 2, "datetime('now', '-5 hours')");
    db.run(
      `INSERT INTO observe_outbox (
         seq, adapter, source_id, source_kind, source_uri,
         idempotency_key, trust_tier, transform_policy, payload,
         appended_at, drained_at, drain_error, drain_attempts, drain_quarantined_at
       ) VALUES (3, 'test-adapter', 's1', 'local-file', 'file:///x',
         'idem-3', 'user', 'tp-2026-04', '{}',
         datetime('now', '-48 hours'), NULL, 'poison', 5, datetime('now'))`
    );

    expect(scanStuckOutbox(db, 24, 100)).toBe(0);
    const count = db
      .query("SELECT COUNT(*) AS c FROM health_signals")
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  test("idempotent across repeated scans (upsert dedupe)", () => {
    insertOutboxRow(db, 1, "datetime('now', '-48 hours')");
    expect(scanStuckOutbox(db, 24, 100)).toBe(1);
    expect(scanStuckOutbox(db, 24, 100)).toBe(0);
    expect(scanStuckOutbox(db, 24, 100)).toBe(0);

    const row = db
      .query("SELECT COUNT(*) AS c FROM health_signals WHERE target_ref = 'outbox:1'")
      .get() as { c: number };
    expect(row.c).toBe(1);
  });

  test("respects maxPerKind LIMIT", () => {
    for (let i = 1; i <= 5; i++) {
      insertOutboxRow(db, i, "datetime('now', '-48 hours')");
    }
    expect(scanStuckOutbox(db, 24, 3)).toBe(3);
  });
});

describe("triage P0-1 scanStaleWiki", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-wiki-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits signal when stale_at is set (wiki fallback path)", () => {
    insertWikiPage(db, "paris.md", "paris", "datetime('now')", "datetime('now')");
    expect(scanStaleWiki(db, 30, 100)).toBe(1);

    const row = db
      .query(
        "SELECT kind, severity, target_ref, message FROM health_signals WHERE kind = 'stale_wiki'"
      )
      .get() as {
      kind: string;
      severity: string;
      target_ref: string;
      message: string;
    };
    expect(row.target_ref).toBe("wiki:paris.md");
    expect(row.severity).toBe("info");
    expect(row.message).toContain("last rebuild failed");
  });

  test("emits signal when last_synthesis_at is older than days threshold", () => {
    insertWikiPage(db, "london.md", "london", "datetime('now', '-60 days')", null);
    expect(scanStaleWiki(db, 30, 100)).toBe(1);

    const row = db
      .query("SELECT message FROM health_signals WHERE target_ref = 'wiki:london.md'")
      .get() as { message: string };
    expect(row.message).toContain("older than 30d");
  });

  test("does NOT emit for fresh page with no stale_at", () => {
    insertWikiPage(db, "tokyo.md", "tokyo", "datetime('now', '-5 days')", null);
    expect(scanStaleWiki(db, 30, 100)).toBe(0);
  });
});

describe("triage P0-1 scanStaleFact", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-stalefact-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedSourceAndObs(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits signal for unpinned active fact past reinforce window", () => {
    insertFact(db, "f1", "a", "b", "c", { reinforcedDaysAgo: 120 });
    expect(scanStaleFact(db, 90, 100)).toBe(1);

    const row = db
      .query("SELECT kind, target_ref FROM health_signals")
      .get() as { kind: string; target_ref: string };
    expect(row.kind).toBe("stale_fact");
    expect(row.target_ref).toBe("fact:f1");
  });

  test("does NOT emit for pinned fact, archived fact, or recently reinforced", () => {
    insertFact(db, "f1", "a", "b", "c", {
      reinforcedDaysAgo: 200,
      pinned: true,
    });
    insertFact(db, "f2", "a", "b", "d", { reinforcedDaysAgo: 200 });
    db.run("UPDATE facts SET archived_at = datetime('now') WHERE fact_id = 'f2'");
    insertFact(db, "f3", "a", "b", "e", { reinforcedDaysAgo: 30 });
    expect(scanStaleFact(db, 90, 100)).toBe(0);
  });
});

describe("triage P0-1 scanUnresolvedContradiction", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-contra-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedSourceAndObs(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits one signal per (subject,predicate) with 2+ distinct active objects older than days", () => {
    // Two active facts with same (subject, predicate) but different objects,
    // created 10d ago, neither archived nor superseded -> unresolved.
    // No conflict_group set: debate 013 F1 SQL rewrite catches contradictions
    // BEFORE reflect has processed them.
    insertFact(db, "fw", "paris", "capital-of", "france", {
      createdAtSqlExpr: "datetime('now', '-10 days')",
    });
    insertFact(db, "fl", "paris", "capital-of", "england", {
      createdAtSqlExpr: "datetime('now', '-10 days')",
    });

    expect(scanUnresolvedContradiction(db, 7, 100)).toBe(1);
    const row = db
      .query("SELECT kind, target_ref, severity FROM health_signals")
      .get() as { kind: string; target_ref: string; severity: string };
    expect(row.kind).toBe("unresolved_contradiction");
    expect(row.target_ref).toBe("contradiction:paris/capital-of");
    expect(row.severity).toBe("warn");
  });

  test("does NOT emit when one side archived (resolved) or within age threshold", () => {
    // Resolved: winner active, loser archived -> only 1 active object
    insertFact(db, "fw", "paris", "capital-of", "france", {
      createdAtSqlExpr: "datetime('now', '-10 days')",
    });
    insertFact(db, "fl", "paris", "capital-of", "england", {
      createdAtSqlExpr: "datetime('now', '-10 days')",
    });
    db.run(
      "UPDATE facts SET archived_at = datetime('now'), superseded_by = 'fw' WHERE fact_id = 'fl'"
    );
    expect(scanUnresolvedContradiction(db, 7, 100)).toBe(0);

    // Fresh unresolved (age < threshold): don't surface yet, give reflect
    // a chance to resolve.
    insertFact(db, "gw", "berlin", "capital-of", "germany", {
      createdAtSqlExpr: "datetime('now', '-1 days')",
    });
    insertFact(db, "gl", "berlin", "capital-of", "austria", {
      createdAtSqlExpr: "datetime('now', '-1 days')",
    });
    expect(scanUnresolvedContradiction(db, 7, 100)).toBe(0);
  });
});

describe("triage P0-1 scanOrphanDelta", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-orphan-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedSourceAndObs(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits signal for old fact with no links and no access", () => {
    insertFact(db, "f1", "a", "b", "c", {
      createdAtSqlExpr: "datetime('now', '-60 days')",
    });
    expect(scanOrphanDelta(db, 30, 100)).toBe(1);

    const row = db
      .query("SELECT target_ref FROM health_signals WHERE kind = 'orphan_delta'")
      .get() as { target_ref: string };
    expect(row.target_ref).toBe("fact:f1");
  });

  test("does NOT emit for linked fact, recently accessed fact, or young fact", () => {
    // Linked (has an incoming edge)
    insertFact(db, "f1", "a", "b", "c", {
      createdAtSqlExpr: "datetime('now', '-60 days')",
    });
    insertFact(db, "f2", "x", "y", "z", {
      createdAtSqlExpr: "datetime('now', '-60 days')",
    });
    addLink(db, "f2", "f1", "supports", { weight: 1.0 });

    // Recently accessed
    insertFact(db, "f3", "m", "n", "o", {
      createdAtSqlExpr: "datetime('now', '-60 days')",
    });
    db.run(
      "INSERT INTO access_log (fact_id, accessed_at_unix_sec) VALUES ('f3', ?)",
      [Math.floor(Date.now() / 1000) - 5 * 86_400]
    );

    // Young (< threshold)
    insertFact(db, "f4", "p", "q", "r", {
      createdAtSqlExpr: "datetime('now', '-10 days')",
    });

    // f1 has incoming from f2; f2 has outgoing to f1 -- both linked. f3 accessed. f4 young.
    expect(scanOrphanDelta(db, 30, 100)).toBe(0);
  });
});

describe("triage P0-1 aggregate + resolveSignal", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-triage-agg-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedSource(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("triage() aggregates byKind and counts only unresolved rows", () => {
    insertOutboxRow(db, 1, "datetime('now', '-48 hours')");
    insertOutboxRow(db, 2, "datetime('now', '-48 hours')");
    insertWikiPage(db, "paris.md", "paris", "datetime('now')", "datetime('now')");

    const report = triage(db);
    expect(report.byKind.stuck_outbox).toBe(2);
    expect(report.byKind.stale_wiki).toBe(1);
    expect(report.byKind.stale_fact).toBe(0);
    expect(report.unresolvedTotal).toBe(3);
    expect(report.signals).toHaveLength(3);
    expect(report.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("resolveSignal flips a row to resolved; subsequent triage re-emits for still-stuck target", () => {
    insertOutboxRow(db, 1, "datetime('now', '-48 hours')");
    triage(db);

    const sig = db
      .query("SELECT id FROM health_signals WHERE kind = 'stuck_outbox'")
      .get() as { id: number };
    resolveSignal(db, sig.id, "user");

    // After resolution, the outbox row is still stuck -> next triage()
    // writes a fresh signal (upsert dedupes only against *unresolved* rows).
    // This is the correct surfacing behavior: the problem hasn't gone
    // away, so the user should see it again.
    const report2 = triage(db);
    expect(report2.byKind.stuck_outbox).toBe(1);
    expect(report2.unresolvedTotal).toBe(1);
    // The freshly-emitted signal has a different id from the resolved one.
    expect(report2.signals[0]!.id).not.toBe(sig.id);

    // Historical audit: the resolved row is still there, just filtered out.
    const total = db
      .query("SELECT COUNT(*) AS c FROM health_signals")
      .get() as { c: number };
    expect(total.c).toBe(2);
  });

  test("resolveSignal is idempotent (re-resolve is a no-op)", () => {
    insertOutboxRow(db, 1, "datetime('now', '-48 hours')");
    triage(db);
    const sig = db
      .query("SELECT id FROM health_signals")
      .get() as { id: number };

    resolveSignal(db, sig.id, "user");
    resolveSignal(db, sig.id, "agent");

    const row = db
      .query("SELECT resolved_by FROM health_signals WHERE id = ?")
      .get(sig.id) as { resolved_by: string };
    expect(row.resolved_by).toBe("user");
  });
});
