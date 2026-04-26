import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  readState,
  writeState,
  pauseScheduler,
  resumeScheduler,
  getRecentVerdictStats,
  selectSeeds,
  canTriggerCycle,
  runCycle,
  ENTRY_CHAIN_COUNT,
  HARD_GATE_CONSECUTIVE_SKIPS,
  HARD_GATE_AUTO_RESUME_HOURS,
  SOFT_GATE_REJECTED_RATE,
  SOFT_GATE_MIN_JUDGED,
} from "../src/cognitive/reason-scheduler";
import {
  runReasoning,
  setVerdict,
} from "../src/cognitive/reasoning";
import { MockLLMService } from "../src/llm/mock";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// source.kind has a CHECK constraint (only local-file/local-dir/web/claude-code/
// host-adapter/sensory). observation.adapter is independent. For tests we just
// pin source.kind='local-file' and let adapter vary on the observation row.
function insertSource(db: Database, id: string): void {
  db.run(
    "INSERT OR IGNORE INTO source VALUES (?,?,?,NULL,0.0,'user',datetime('now'),NULL)",
    [id, `file:///${id}`, "local-file"]
  );
}

interface ObsFixture {
  obsId: string;
  sourceId: string;
  adapter: string;
  capturedAt?: string; // ISO 'YYYY-MM-DD HH:MM:SS' override
}

function insertObservation(db: Database, fx: ObsFixture): void {
  const sql =
    fx.capturedAt !== undefined
      ? `INSERT INTO observations VALUES
           (?,?,?, ?, ?,
            'h','r',NULL,NULL,'text/plain',?,1,'user',?,'tp-2026-04',NULL,NULL,NULL)`
      : `INSERT INTO observations VALUES
           (?,?,?, datetime('now'), datetime('now'),
            'h','r',NULL,NULL,'text/plain',?,1,'user',?,'tp-2026-04',NULL,NULL,NULL)`;
  if (fx.capturedAt !== undefined) {
    db.run(sql, [
      fx.obsId,
      fx.sourceId,
      `file:///${fx.sourceId}`,
      fx.capturedAt,
      fx.capturedAt,
      fx.adapter,
      `idem-${fx.obsId}`,
    ]);
  } else {
    db.run(sql, [
      fx.obsId,
      fx.sourceId,
      `file:///${fx.sourceId}`,
      fx.adapter,
      `idem-${fx.obsId}`,
    ]);
  }
}

interface FactFixture {
  factId: string;
  obsId: string;
  subject: string;
  predicate?: string;
  object?: string;
  createdAtOverride?: string; // for testing 7d window
}

function insertFact(db: Database, fx: FactFixture): void {
  if (fx.createdAtOverride) {
    db.run(
      `INSERT INTO facts (fact_id, subject, predicate, object, confidence, observe_id, created_at)
       VALUES (?, ?, ?, ?, 0.85, ?, ?)`,
      [
        fx.factId,
        fx.subject,
        fx.predicate ?? "relates_to",
        fx.object ?? "value",
        fx.obsId,
        fx.createdAtOverride,
      ]
    );
  } else {
    db.run(
      `INSERT INTO facts (fact_id, subject, predicate, object, confidence, observe_id)
       VALUES (?, ?, ?, ?, 0.85, ?)`,
      [
        fx.factId,
        fx.subject,
        fx.predicate ?? "relates_to",
        fx.object ?? "value",
        fx.obsId,
      ]
    );
  }
}

function happyLlmReply(text: string, conf: number = 0.7): string {
  return JSON.stringify({ chain: text, confidence: conf });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reason-scheduler", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-reason-sched-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // State read/write
  // -------------------------------------------------------------------------

  describe("readState / writeState", () => {
    test("initial state from migration 0020: not paused, no cycle history, counter=0", () => {
      const s = readState(db);
      expect(s.paused).toBe(false);
      expect(s.paused_reason).toBeNull();
      expect(s.last_cycle_at).toBeNull();
      expect(s.last_cycle_stats).toBeNull();
      expect(s.consecutive_skipped_cycles).toBe(0);
    });

    test("writeState patches only specified columns; round-trips through readState", () => {
      writeState(db, { paused: true, paused_reason: "test" });
      const s1 = readState(db);
      expect(s1.paused).toBe(true);
      expect(s1.paused_reason).toBe("test");

      writeState(db, { consecutive_skipped_cycles: 2 });
      const s2 = readState(db);
      expect(s2.paused).toBe(true); // unchanged
      expect(s2.consecutive_skipped_cycles).toBe(2);
    });

    test("pauseScheduler / resumeScheduler round-trip clears counter", () => {
      writeState(db, { consecutive_skipped_cycles: 3 });
      pauseScheduler(db, "manual test");
      const paused = readState(db);
      expect(paused.paused).toBe(true);
      expect(paused.paused_reason).toBe("manual test");
      expect(paused.paused_at).not.toBeNull();

      resumeScheduler(db);
      const resumed = readState(db);
      expect(resumed.paused).toBe(false);
      expect(resumed.paused_reason).toBeNull();
      expect(resumed.consecutive_skipped_cycles).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getRecentVerdictStats — Codex's prerequisite helper
  // -------------------------------------------------------------------------

  describe("getRecentVerdictStats", () => {
    test("empty ledger → 0/0/0/0 with rejected_rate=0", () => {
      const r = getRecentVerdictStats(db, 10);
      expect(r).toEqual({
        judged: 0,
        confirmed: 0,
        refined: 0,
        rejected: 0,
        rejected_rate: 0,
      });
    });

    test("scoped to last N judged via verdict_at DESC; ignores unjudged", async () => {
      // 4 chains: 2 confirmed, 1 rejected, 1 unjudged. window=10.
      insertSource(db, "src-1");
      insertObservation(db, { obsId: "obs-1", sourceId: "src-1", adapter: "local-file" });
      insertFact(db, { factId: "f-a", obsId: "obs-1", subject: "alpha topic" });
      insertFact(db, { factId: "f-b", obsId: "obs-1", subject: "beta topic" });
      insertFact(db, { factId: "f-c", obsId: "obs-1", subject: "gamma topic" });
      insertFact(db, { factId: "f-d", obsId: "obs-1", subject: "delta topic" });

      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("c", 0.7),
      });
      // Run 4 chains under different policy versions to force fresh rows
      const c1 = await runReasoning(db, { kind: "fact", id: "f-a" }, llm, { policyVersion: "p1" });
      const c2 = await runReasoning(db, { kind: "fact", id: "f-b" }, llm, { policyVersion: "p2" });
      const c3 = await runReasoning(db, { kind: "fact", id: "f-c" }, llm, { policyVersion: "p3" });
      await runReasoning(db, { kind: "fact", id: "f-d" }, llm, { policyVersion: "p4" });

      setVerdict(db, c1.chain_id, "confirmed");
      setVerdict(db, c2.chain_id, "confirmed");
      setVerdict(db, c3.chain_id, "rejected");

      const r = getRecentVerdictStats(db, 10);
      expect(r.judged).toBe(3);
      expect(r.confirmed).toBe(2);
      expect(r.rejected).toBe(1);
      expect(r.rejected_rate).toBeCloseTo(1 / 3, 4);
    });
  });

  // -------------------------------------------------------------------------
  // selectSeeds — (c) recently-active subjects + engram surge guard
  // -------------------------------------------------------------------------

  describe("selectSeeds", () => {
    test("empty ledger → returns empty array (no throw)", () => {
      expect(selectSeeds(db, 3)).toEqual([]);
    });

    test("returns top N subjects from last 7d, excluding engram-adapter facts (surge guard)", () => {
      // local-file facts (eligible)
      insertSource(db, "src-local");
      insertObservation(db, { obsId: "obs-local-a", sourceId: "src-local", adapter: "local-file" });
      insertObservation(db, { obsId: "obs-local-b", sourceId: "src-local", adapter: "local-file" });
      insertFact(db, { factId: "f-local-1", obsId: "obs-local-a", subject: "compost architecture" });
      insertFact(db, { factId: "f-local-2", obsId: "obs-local-b", subject: "phase 7 design" });

      // engram facts (surge — should be filtered out)
      insertSource(db, "src-engram");
      insertObservation(db, { obsId: "obs-engram-1", sourceId: "src-engram", adapter: "engram" });
      insertObservation(db, { obsId: "obs-engram-2", sourceId: "src-engram", adapter: "engram" });
      insertFact(db, { factId: "f-eng-1", obsId: "obs-engram-1", subject: "engram bulk subj 1" });
      insertFact(db, { factId: "f-eng-2", obsId: "obs-engram-2", subject: "engram bulk subj 2" });

      const seeds = selectSeeds(db, 3);
      expect(seeds.length).toBe(2);
      const subjects = seeds.map((s) => s.subject).sort();
      expect(subjects).toEqual(["compost architecture", "phase 7 design"]);
      // None of the engram subjects should appear
      expect(seeds.every((s) => !s.subject.startsWith("engram bulk"))).toBe(true);
    });

    test("excludes facts older than 7d window", () => {
      insertSource(db, "src");
      insertObservation(db, { obsId: "obs-old", sourceId: "src", adapter: "local-file" });
      insertObservation(db, { obsId: "obs-new", sourceId: "src", adapter: "local-file" });
      insertFact(db, {
        factId: "f-old",
        obsId: "obs-old",
        subject: "ancient topic",
        createdAtOverride: "2020-01-01 00:00:00",
      });
      insertFact(db, { factId: "f-new", obsId: "obs-new", subject: "fresh topic" });

      const seeds = selectSeeds(db, 3);
      expect(seeds.length).toBe(1);
      expect(seeds[0]?.subject).toBe("fresh topic");
    });

    test("budget cap respected; one fact per subject (no duplicate seeds)", () => {
      insertSource(db, "src");
      insertObservation(db, { obsId: "obs-a", sourceId: "src", adapter: "local-file" });
      // Same subject, multiple facts
      insertFact(db, { factId: "f-a-1", obsId: "obs-a", subject: "topic-X" });
      insertFact(db, { factId: "f-a-2", obsId: "obs-a", subject: "topic-X" });
      insertFact(db, { factId: "f-b", obsId: "obs-a", subject: "topic-Y" });
      insertFact(db, { factId: "f-c", obsId: "obs-a", subject: "topic-Z" });

      const seeds = selectSeeds(db, 2);
      expect(seeds.length).toBe(2);
      const subjects = seeds.map((s) => s.subject);
      // Deduplicated on subject
      expect(new Set(subjects).size).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // canTriggerCycle — three-layer gate
  // -------------------------------------------------------------------------

  describe("canTriggerCycle", () => {
    function seedChains(db: Database, n: number): void {
      // Build n chains using mock LLM, each with unique policyVersion
      insertSource(db, "src-gate");
      insertObservation(db, { obsId: "obs-g", sourceId: "src-gate", adapter: "local-file" });
      for (let i = 0; i < n; i++) {
        insertFact(db, { factId: `f-g-${i}`, obsId: "obs-g", subject: `gate-subj-${i}` });
      }
    }

    test("below entry: total chains < ENTRY_CHAIN_COUNT → skipped_below_entry", async () => {
      const result = canTriggerCycle(db);
      expect(result.decision).toBe("skipped_below_entry");
      expect(result.detail).toContain(`< entry=${ENTRY_CHAIN_COUNT}`);
    });

    test("hard pause: scheduler manually paused → skipped_hard_paused", async () => {
      // Synthesize ENTRY_CHAIN_COUNT chains via direct INSERT (bypass LLM
      // for speed). Schema requires retrieval_trace_json + answer_json + JSON
      // valid + idempotent chain_ids.
      seedChains(db, ENTRY_CHAIN_COUNT);
      for (let i = 0; i < ENTRY_CHAIN_COUNT; i++) {
        db.run(
          `INSERT INTO reasoning_chains
            (chain_id, seed_kind, seed_id, policy_version,
             candidate_fact_ids_json, retrieval_trace_json, answer_json, confidence)
           VALUES (?, 'fact', ?, 'p-test', '[]', '{}', '{}', 0.5)`,
          [`chain-${i}`, `f-g-${i}`]
        );
      }
      pauseScheduler(db, "test-pause");
      const result = canTriggerCycle(db);
      expect(result.decision).toBe("skipped_hard_paused");
      expect(result.detail).toContain("paused since");
    });

    test("hard pause auto-resumes after 7d threshold", async () => {
      seedChains(db, ENTRY_CHAIN_COUNT);
      for (let i = 0; i < ENTRY_CHAIN_COUNT; i++) {
        db.run(
          `INSERT INTO reasoning_chains
            (chain_id, seed_kind, seed_id, policy_version,
             candidate_fact_ids_json, retrieval_trace_json, answer_json, confidence)
           VALUES (?, 'fact', ?, 'p-test', '[]', '{}', '{}', 0.5)`,
          [`chain-${i}`, `f-g-${i}`]
        );
      }
      // Simulate a paused_at older than auto-resume window
      const old = new Date(
        Date.now() - (HARD_GATE_AUTO_RESUME_HOURS + 1) * 60 * 60 * 1000
      )
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
      writeState(db, {
        paused: true,
        paused_reason: "old",
        paused_at: old,
      });
      const result = canTriggerCycle(db);
      // No verdict signal yet → soft gate doesn't trip → decision = "ran"
      expect(result.decision).toBe("ran");
      // State should now show resumed
      const s = readState(db);
      expect(s.paused).toBe(false);
      expect(s.paused_reason).toBeNull();
    });

    test("soft gate triggers above threshold; bumps consecutive counter", async () => {
      // Need ENTRY_CHAIN_COUNT+ chains, with at least SOFT_GATE_MIN_JUDGED
      // judged where rejected_rate >= SOFT_GATE_REJECTED_RATE.
      seedChains(db, ENTRY_CHAIN_COUNT);
      for (let i = 0; i < ENTRY_CHAIN_COUNT; i++) {
        db.run(
          `INSERT INTO reasoning_chains
            (chain_id, seed_kind, seed_id, policy_version,
             candidate_fact_ids_json, retrieval_trace_json, answer_json,
             confidence, user_verdict, verdict_at)
           VALUES (?, 'fact', ?, 'p-test', '[]', '{}', '{}', 0.5, ?, datetime('now', '-' || ? || ' minutes'))`,
          [
            `chain-${i}`,
            `f-g-${i}`,
            // First SOFT_GATE_MIN_JUDGED rows rejected, then confirmed
            i < SOFT_GATE_MIN_JUDGED ? "rejected" : "confirmed",
            i, // verdict_at offsets so DESC order preserves the rejected ones at top
          ]
        );
      }

      // recent rejected_rate should be high enough to trip soft gate
      const recent = getRecentVerdictStats(db, 10);
      expect(recent.rejected_rate).toBeGreaterThanOrEqual(
        SOFT_GATE_REJECTED_RATE
      );

      const r = canTriggerCycle(db);
      expect(r.decision).toBe("skipped_soft");
      expect(readState(db).consecutive_skipped_cycles).toBe(1);
    });

    test("K consecutive soft skips → transitions to hard pause", async () => {
      seedChains(db, ENTRY_CHAIN_COUNT);
      // All 10 rejected so soft gate fires every call
      for (let i = 0; i < ENTRY_CHAIN_COUNT; i++) {
        db.run(
          `INSERT INTO reasoning_chains
            (chain_id, seed_kind, seed_id, policy_version,
             candidate_fact_ids_json, retrieval_trace_json, answer_json,
             confidence, user_verdict, verdict_at)
           VALUES (?, 'fact', ?, 'p-test', '[]', '{}', '{}', 0.5, 'rejected', datetime('now'))`,
          [`chain-${i}`, `f-g-${i}`]
        );
      }
      // Pre-bump counter to one short of the threshold
      writeState(db, {
        consecutive_skipped_cycles: HARD_GATE_CONSECUTIVE_SKIPS - 1,
      });
      const r = canTriggerCycle(db);
      expect(r.decision).toBe("skipped_hard_paused");
      expect(readState(db).paused).toBe(true);
      expect(readState(db).consecutive_skipped_cycles).toBe(
        HARD_GATE_CONSECUTIVE_SKIPS
      );
    });
  });

  // -------------------------------------------------------------------------
  // runCycle — integration smoke
  // -------------------------------------------------------------------------

  describe("runCycle", () => {
    test("below entry → writes last_cycle_stats with skipped_below_entry", async () => {
      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("ok", 0.7),
      });
      const stats = await runCycle(db, llm);
      expect(stats.gate_decision).toBe("skipped_below_entry");
      expect(stats.chains_attempted).toBe(0);
      expect(readState(db).last_cycle_at).not.toBeNull();
    });

    test("entry met + no recent facts → skipped_no_seeds", async () => {
      // Fill chains to clear entry gate
      insertSource(db, "src-empty");
      insertObservation(db, { obsId: "obs-empty", sourceId: "src-empty", adapter: "local-file" });
      insertFact(db, { factId: "f-empty", obsId: "obs-empty", subject: "x" });
      for (let i = 0; i < ENTRY_CHAIN_COUNT; i++) {
        db.run(
          `INSERT INTO reasoning_chains
            (chain_id, seed_kind, seed_id, policy_version,
             candidate_fact_ids_json, retrieval_trace_json, answer_json, confidence)
           VALUES (?, 'fact', 'f-empty', 'p-test', '[]', '{}', '{}', 0.5)`,
          [`chain-${i}`]
        );
      }
      // Backdate the only fact so selectSeeds finds nothing recent
      db.run(
        "UPDATE facts SET created_at = '2020-01-01 00:00:00' WHERE fact_id = 'f-empty'"
      );

      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("ok", 0.7),
      });
      const stats = await runCycle(db, llm);
      expect(stats.gate_decision).toBe("skipped_no_seeds");
    });

    test("happy path: runs reasoning over selected seeds, resets soft-skip counter", async () => {
      // Seed entry-gate-meeting chains + 2 fresh local-file facts
      insertSource(db, "src-h");
      insertObservation(db, { obsId: "obs-h", sourceId: "src-h", adapter: "local-file" });
      insertFact(db, { factId: "f-h-1", obsId: "obs-h", subject: "topic alpha" });
      insertFact(db, { factId: "f-h-2", obsId: "obs-h", subject: "topic beta" });
      for (let i = 0; i < ENTRY_CHAIN_COUNT; i++) {
        db.run(
          `INSERT INTO reasoning_chains
            (chain_id, seed_kind, seed_id, policy_version,
             candidate_fact_ids_json, retrieval_trace_json, answer_json, confidence)
           VALUES (?, 'fact', 'f-h-1', 'p-test', '[]', '{}', '{}', 0.5)`,
          [`chain-pre-${i}`]
        );
      }
      writeState(db, { consecutive_skipped_cycles: 2 });

      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("synthesized chain", 0.7),
      });
      const stats = await runCycle(db, llm, undefined, 2);
      expect(stats.gate_decision).toBe("ran");
      expect(stats.chains_attempted).toBe(2);
      // Counter resets on successful gate-pass cycle
      expect(readState(db).consecutive_skipped_cycles).toBe(0);
    });
  });
});
