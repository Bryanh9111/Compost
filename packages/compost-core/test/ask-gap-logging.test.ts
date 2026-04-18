import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { ask, DEFAULT_GAP_THRESHOLD } from "../src/query/ask";
import { gapStats, listGaps } from "../src/cognitive/gap-tracker";
import { MockLLMService } from "../src/llm/mock";
import { BreakerRegistry } from "../src/llm/breaker-registry";

/**
 * Debate 023 — gap logging now lives inside ask() itself, provenance-gated
 * by whether the LLM actually synthesized an answer. These tests lock in:
 *   1. default threshold value (drift regression)
 *   2. gapThreshold: null disables logging entirely
 *   3. no-evidence case (hits=0 + wiki=0) always logs a gap
 *   4. LLM-synthesized + low-confidence logs a gap
 *   5. LLM-synthesized + high-confidence does NOT log a gap
 *   6. BM25 fallback (LLM failed) does NOT log a gap regardless of conf
 *
 * Cross-p0-integration.test.ts Scenario B carries the stricter end-to-end
 * breaker-open assertion; this file is the unit-level provenance contract.
 */

const SOURCE_ROW =
  "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)";
const OBS_ROW =
  "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','payload',1,'user','idem','tp-2026-04',NULL,NULL,NULL)";

function seedBase(db: Database): void {
  db.run(SOURCE_ROW);
  db.run(OBS_ROW);
}

function insertFact(
  db: Database,
  factId: string,
  subject: string,
  predicate: string,
  object: string,
  confidence: number
): void {
  db.run(
    "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence, importance) VALUES (?,?,?,?,?,?,?)",
    [factId, subject, predicate, object, "obs1", confidence, 0.5]
  );
}

describe("ask() gap logging (debate 023)", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-ask-gap-"));
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seedBase(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("DEFAULT_GAP_THRESHOLD constant equals 0.4 (drift regression)", () => {
    // If this flips, every existing Curiosity cluster produced under the
    // old threshold becomes retroactively miscategorized. Changing this
    // number requires deliberate debate, not silent drift.
    expect(DEFAULT_GAP_THRESHOLD).toBe(0.4);
  });

  test("no-evidence case logs a gap even when LLM would have succeeded", async () => {
    // Seed nothing matching — hits=0, wiki=0. ask() returns the canned
    // "I don't have enough information" string without calling the LLM.
    const reg = new BreakerRegistry(new MockLLMService({ mode: "happy" }));
    const result = await ask(db, "totally unseeded subject?", reg, {
      expandQueries: false,
    });
    expect(result.hits).toHaveLength(0);
    const gaps = listGaps(db, {});
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.question).toBe("totally unseeded subject?");
    expect(gapStats(db).open).toBe(1);
  });

  test("LLM-synthesized + low-confidence hit logs a gap", async () => {
    // Fact with confidence 0.2 (below 0.4 default threshold).
    // Single-word subject (FTS5 tokenizer splits on hyphens).
    insertFact(db, "flow", "obscure", "is", "fuzzy", 0.2);
    const reg = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "some synthesized answer" })
    );
    const result = await ask(db, "obscure", reg, {
      expandQueries: false,
    });
    expect(result.answer).toBe("some synthesized answer");
    expect(result.hits[0]!.confidence).toBe(0.2);
    const gaps = listGaps(db, {});
    expect(gaps).toHaveLength(1);
  });

  test("LLM-synthesized + high-confidence hit does NOT log a gap", async () => {
    // Fact with confidence 0.9 (well above 0.4 default threshold).
    insertFact(db, "fhigh", "solid", "is", "good", 0.9);
    const reg = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "confident answer" })
    );
    const result = await ask(db, "solid", reg, {
      expandQueries: false,
    });
    expect(result.answer).toBe("confident answer");
    expect(result.hits[0]!.confidence).toBe(0.9);
    expect(gapStats(db).total_asks).toBe(0);
  });

  test("BM25 fallback (LLM breaker open) does NOT log a gap even on low conf", async () => {
    // Provenance gate: LLM never actually synthesized, so the caller
    // received degraded output — not a "brain admitted it can't answer".
    insertFact(db, "flow2", "breakerless", "is", "x", 0.2);
    const failReg = new BreakerRegistry(
      new MockLLMService({ mode: "error", errorMessage: "boom" }),
      { minFailures: 1, failureRate: 0, openMs: 60_000 }
    );
    // Warm up both sites so they open before ask() runs.
    await failReg.get("ask.expand").generate("warm").catch(() => {});
    await failReg.get("ask.answer").generate("warm").catch(() => {});

    const result = await ask(db, "breakerless", failReg, {
      expandQueries: false,
    });
    expect(result.answer).toContain("[LLM unavailable");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(gapStats(db).total_asks).toBe(0);
  });

  test("gapThreshold: null disables logging entirely (L5 internal escape hatch)", async () => {
    insertFact(db, "flow3", "internaltopic", "is", "x", 0.1);
    const reg = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "internal answer" })
    );
    const result = await ask(db, "internaltopic", reg, {
      expandQueries: false,
      gapThreshold: null,
    });
    expect(result.answer).toBe("internal answer");
    expect(result.hits[0]!.confidence).toBe(0.1);
    // Even though 0.1 < 0.4, null threshold skips logging.
    expect(gapStats(db).total_asks).toBe(0);
  });

  test("explicit gapThreshold override (e.g. 0.7) widens gap-flagging", async () => {
    // Fact at 0.5 is below a user-raised threshold of 0.7 -> flag as gap.
    insertFact(db, "fmid", "middling", "is", "ok", 0.5);
    const reg = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "mid answer" })
    );
    await ask(db, "middling", reg, {
      expandQueries: false,
      gapThreshold: 0.7,
    });
    expect(gapStats(db).open).toBe(1);
  });

  test("repeated ask of same question bumps ask_count, not duplicate rows", async () => {
    insertFact(db, "flow4", "repeated", "is", "x", 0.2);
    const reg = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "answer" })
    );
    await ask(db, "repeated", reg, { expandQueries: false });
    await ask(db, "repeated?", reg, { expandQueries: false }); // normalized same
    const gaps = listGaps(db, {});
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.ask_count).toBe(2);
  });
});
