import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { startReflectScheduler } from "../src/scheduler";
import { MockLLMService } from "../../compost-core/src/llm/mock";
import { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";

/**
 * Week 4 Day 4 — scheduler wiki hook integration test (debate 010 backlog).
 *
 * Validates the full daemon-path chain that Day 1 registry merge + debate 009
 * Fix 2 set up:
 *   scheduler tick -> reflect(db) -> synthesizeWiki(db, registry, dataDir)
 *      -> wiki_pages UPSERT + decision_audit(wiki_rebuild) + disk write
 *
 * Previously this code had zero direct coverage; `cross-p0-integration.test`
 * exercised the pieces but bypassed the scheduler. The three tests below
 * close that gap by driving `startReflectScheduler` with a 5ms interval and
 * a MockLLM-backed BreakerRegistry.
 */

function seed(db: Database): void {
  db.run(
    "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)"
  );
  db.run(
    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL,NULL,NULL)"
  );
  db.run(
    "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence) VALUES ('f1','paris','is-in','france','obs1',0.95)"
  );
}

/**
 * Poll until `predicate()` returns true or timeout elapses. Keeps tests
 * deterministic across slower CI without hardcoding a single sleep window.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  stepMs = 10
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await Bun.sleep(stepMs);
  }
  return predicate();
}

describe("startReflectScheduler wiki hook (Week 4 Day 4)", () => {
  let tmpDir: string;
  let dataDir: string;
  let db: Database;
  let originalWikiSynthesisEnabled: string | undefined;

  beforeEach(() => {
    originalWikiSynthesisEnabled = process.env.WIKI_SYNTHESIS_ENABLED;
    tmpDir = mkdtempSync(join(tmpdir(), "compost-sched-"));
    dataDir = join(tmpDir, "compost");
    mkdirSync(dataDir, { recursive: true });
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seed(db);
  });

  afterEach(() => {
    if (originalWikiSynthesisEnabled === undefined) {
      delete process.env.WIKI_SYNTHESIS_ENABLED;
    } else {
      process.env.WIKI_SYNTHESIS_ENABLED = originalWikiSynthesisEnabled;
    }
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("happy path: one tick writes wiki_rebuild audit row + disk file", async () => {
    process.env.WIKI_SYNTHESIS_ENABLED = "true";
    const registry = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "# Paris\n\nseeded" })
    );
    const sched = startReflectScheduler(db, {
      llm: registry,
      dataDir,
      intervalMs: 5,
    });

    // Wait until the scheduler produces a wiki_rebuild audit row. This
    // proves reflect -> synthesizeWiki -> recordDecision fired end to end.
    const ok = await waitFor(() => {
      const row = db
        .query(
          "SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'wiki_rebuild'"
        )
        .get() as { c: number };
      return row.c >= 1;
    });
    sched.stop();

    expect(ok).toBe(true);

    const wikiRow = db
      .query(
        "SELECT path, title, stale_at FROM wiki_pages WHERE title = 'paris'"
      )
      .get() as { path: string; title: string; stale_at: string | null };
    expect(wikiRow.title).toBe("paris");
    expect(wikiRow.stale_at).toBeNull();
    expect(existsSync(join(dataDir, "wiki", wikiRow.path))).toBe(true);
  });

  test("LLM failure: wiki_pages row gets stale_at, reflect cadence continues", async () => {
    process.env.WIKI_SYNTHESIS_ENABLED = "true";
    // First tick: happy synth (seeds wiki_pages row so stale_at has
    // something to set on later failure -- wiki.ts only marks existing
    // pages stale, per debate 007 Lock 6).
    const happyRegistry = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "# Paris\n\nv1" })
    );
    let sched = startReflectScheduler(db, {
      llm: happyRegistry,
      dataDir,
      intervalMs: 5,
    });
    await waitFor(() => {
      const r = db
        .query("SELECT COUNT(*) AS c FROM wiki_pages WHERE title = 'paris'")
        .get() as { c: number };
      return r.c >= 1;
    });
    sched.stop();

    // Capture audit row count BEFORE second phase so we can detect the
    // scheduler still completed its reflect cycle even though wiki failed.
    const beforeAudit = db
      .query(
        "SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'wiki_rebuild'"
      )
      .get() as { c: number };

    // Add a fresh fact so findTopicsNeedingSynthesis re-lists `paris`,
    // otherwise the second scheduler pass would skip synth entirely.
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence) VALUES ('f2','paris','capital-of','france','obs1',0.9)"
    );

    // Second tick with a failing registry.
    const failingRegistry = new BreakerRegistry(
      new MockLLMService({ mode: "error", errorMessage: "boom" }),
      { minFailures: 1, failureRate: 0, openMs: 60_000 }
    );
    sched = startReflectScheduler(db, {
      llm: failingRegistry,
      dataDir,
      intervalMs: 5,
    });
    const staled = await waitFor(() => {
      const r = db
        .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
        .get() as { stale_at: string | null };
      return r.stale_at !== null;
    });
    sched.stop();

    expect(staled).toBe(true);

    // Scheduler cadence continued: reflect didn't throw, so the scheduler
    // is still healthy even though wiki synth failed. No NEW wiki_rebuild
    // audit row should exist (only the one from the happy phase).
    const afterAudit = db
      .query(
        "SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'wiki_rebuild'"
      )
      .get() as { c: number };
    expect(afterAudit.c).toBe(beforeAudit.c);
  });

  test("no llm opts: scheduler runs reflect but skips wiki synth", async () => {
    const sched = startReflectScheduler(db, { intervalMs: 5 });

    // Give it enough ticks to complete at least one cycle.
    await Bun.sleep(40);
    sched.stop();

    // reflect() always runs but wiki synth is gated on opts.llm presence,
    // so wiki_pages must remain empty and no wiki_rebuild audit exists.
    const wikiCount = db
      .query("SELECT COUNT(*) AS c FROM wiki_pages")
      .get() as { c: number };
    const auditCount = db
      .query(
        "SELECT COUNT(*) AS c FROM decision_audit WHERE kind = 'wiki_rebuild'"
      )
      .get() as { c: number };
    expect(wikiCount.c).toBe(0);
    expect(auditCount.c).toBe(0);
  });

  test("scheduler runs triage() after reflect so scanners fire autonomously (F2)", async () => {
    // Seed an old un-drained outbox row so scanStuckOutbox fires.
    db.run(
      `INSERT INTO observe_outbox (
         seq, adapter, source_id, source_kind, source_uri,
         idempotency_key, trust_tier, transform_policy, payload,
         appended_at
       ) VALUES (99, 'test-adapter', 's1', 'local-file', 'file:///x',
         'idem-99', 'user', 'tp-2026-04', '{}',
         datetime('now', '-48 hours'))`
    );

    const sched = startReflectScheduler(db, { intervalMs: 5 });
    const fired = await waitFor(() => {
      const row = db
        .query(
          "SELECT COUNT(*) AS c FROM health_signals WHERE kind = 'stuck_outbox'"
        )
        .get() as { c: number };
      return row.c >= 1;
    });
    sched.stop();

    expect(fired).toBe(true);
    const sig = db
      .query(
        "SELECT target_ref FROM health_signals WHERE kind = 'stuck_outbox'"
      )
      .get() as { target_ref: string };
    expect(sig.target_ref).toBe("outbox:99");
  });
});
