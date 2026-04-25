import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  computeChainId,
  runReasoning,
  persistDerivedLinks,
  readChain,
  getChainsBySeed,
  listRecentChains,
  POLICY_VERSION,
} from "../src/cognitive/reasoning";
import { MockLLMService } from "../src/llm/mock";
import { addLink, getLinks } from "../src/cognitive/fact-links";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function insertSource(db: Database, id: string): void {
  db.run(
    "INSERT INTO source VALUES (?,?,?,NULL,0.0,'user',datetime('now'),NULL)",
    [id, `file:///${id}`, "local-file"]
  );
}

function insertObservation(db: Database, obsId: string, sourceId: string): void {
  db.run(
    `INSERT INTO observations VALUES
       (?,?,?, datetime('now'), datetime('now'),
        'h','r',NULL,NULL,'text/plain','test',1,'user',?,'tp-2026-04',NULL,NULL,NULL)`,
    [obsId, sourceId, `file:///${sourceId}`, `idem-${obsId}`]
  );
}

interface FactFixture {
  factId: string;
  obsId: string;
  subject?: string;
  predicate?: string;
  object?: string;
  confidence?: number;
}

function insertFact(db: Database, fx: FactFixture): void {
  db.run(
    `INSERT INTO facts (fact_id, subject, predicate, object, confidence, observe_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      fx.factId,
      fx.subject ?? "topic",
      fx.predicate ?? "relates_to",
      fx.object ?? "value",
      fx.confidence ?? 0.85,
      fx.obsId,
    ]
  );
}

function happyLlmReply(chain: string, conf: number = 0.7): string {
  return JSON.stringify({ chain, confidence: conf });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reasoning", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-reasoning-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    insertSource(db, "src-1");
    insertObservation(db, "obs-1", "src-1");
    insertFact(db, {
      factId: "fact-seed",
      obsId: "obs-1",
      subject: "polymer chemistry",
      predicate: "studies",
      object: "molecular weight distribution",
    });
    insertFact(db, {
      factId: "fact-a",
      obsId: "obs-1",
      subject: "molecular weight",
      predicate: "affects",
      object: "polymer viscosity",
    });
    insertFact(db, {
      factId: "fact-b",
      obsId: "obs-1",
      subject: "polymer viscosity",
      predicate: "determines",
      object: "processing temperature",
    });
    insertFact(db, {
      factId: "fact-c",
      obsId: "obs-1",
      subject: "molecular weight distribution",
      predicate: "measured_by",
      object: "GPC chromatography",
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // computeChainId — pure helper
  // -------------------------------------------------------------------------

  describe("computeChainId", () => {
    test("same inputs → same id (idempotency seed for storage layer)", () => {
      const a = computeChainId("fact", "fact-seed", POLICY_VERSION, ["c", "a", "b"]);
      const b = computeChainId("fact", "fact-seed", POLICY_VERSION, ["a", "b", "c"]);
      expect(a).toBe(b); // candidate order doesn't matter
    });

    test("different seed → different id", () => {
      const a = computeChainId("fact", "fact-seed", POLICY_VERSION, ["x"]);
      const b = computeChainId("fact", "fact-other", POLICY_VERSION, ["x"]);
      expect(a).not.toBe(b);
    });

    test("different policy_version → different id (so policy bump invalidates cache)", () => {
      const a = computeChainId("fact", "s", "l5-v1", ["x"]);
      const b = computeChainId("fact", "s", "l5-v2", ["x"]);
      expect(a).not.toBe(b);
    });

    test("different seed_kind with same seed_id → different id", () => {
      const a = computeChainId("fact", "abc", POLICY_VERSION, ["x"]);
      const b = computeChainId("question", "abc", POLICY_VERSION, ["x"]);
      expect(a).not.toBe(b);
    });

    test("output is a UUIDv5 string (36 chars, dashed)", () => {
      const id = computeChainId("fact", "s", POLICY_VERSION, ["x"]);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  // -------------------------------------------------------------------------
  // runReasoning — main entry
  // -------------------------------------------------------------------------

  describe("runReasoning", () => {
    test("seed=fact: produces chain with non-empty candidates and writes derived_from edges", async () => {
      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("Molecular weight affects viscosity which sets processing temp.", 0.8),
      });
      const r = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);

      expect(r.candidate_fact_ids.length).toBeGreaterThan(0);
      expect(r.answer.chain).not.toBeNull();
      expect(r.answer.confidence).toBeCloseTo(0.8, 2);
      expect(r.status).toBe("active");
      expect(r.reused_existing).toBe(false);

      // derived_from edges written from seed to each candidate
      const links = getLinks(db, "fact-seed", "out", ["derived_from"]);
      expect(links.length).toBe(r.candidate_fact_ids.length);
    });

    test("seed=question: no graph traversal (graph_count=0), still produces chain", async () => {
      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("...", 0.6),
      });
      const r = await runReasoning(db, { kind: "question", id: "what affects polymer viscosity" }, llm);

      expect(r.retrieval_trace.graph_count).toBe(0);
      // No graph anchor → no derived_from edges written
      const links = db.query("SELECT COUNT(*) AS n FROM fact_links WHERE kind='derived_from'").get() as { n: number };
      expect(links.n).toBe(0);
    });

    test("idempotency: same seed twice → same chain_id, second call reused_existing=true", async () => {
      const llm = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("first chain", 0.5),
      });
      const r1 = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);
      expect(r1.reused_existing).toBe(false);

      // Second call — even with a different LLM that would return different
      // text, the chain_id is determined by (seed, policy, candidates), so
      // we get the cached row back with chain="first chain"
      const llm2 = new MockLLMService({
        mode: "happy",
        response: happyLlmReply("DIFFERENT chain", 0.99),
      });
      const r2 = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm2);
      expect(r2.chain_id).toBe(r1.chain_id);
      expect(r2.reused_existing).toBe(true);
      expect(r2.answer.chain).toBe("first chain"); // proves reuse, not regen
      expect(llm2.getCallCount()).toBe(0); // second LLM was never called
    });

    test("noLinkWriteback: no derived_from edges written even with successful chain", async () => {
      const llm = new MockLLMService({ mode: "happy", response: happyLlmReply("ok", 0.5) });
      await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm, { noLinkWriteback: true });

      const links = db.query("SELECT COUNT(*) AS n FROM fact_links WHERE kind='derived_from'").get() as { n: number };
      expect(links.n).toBe(0);
    });

    test("LLM failure: chain=null, status=active, failure_reason populated, NO link writeback", async () => {
      const llm = new MockLLMService({ mode: "error", errorMessage: "ollama 503" });
      const r = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);

      expect(r.answer.chain).toBeNull();
      expect(r.answer.failure_reason).toContain("ollama 503");
      expect(r.status).toBe("active"); // recoverable, surfaced in list
      expect(r.confidence).toBe(0);

      // Failed chains do NOT write derived_from (no evidence of relatedness)
      const links = db.query("SELECT COUNT(*) AS n FROM fact_links WHERE kind='derived_from'").get() as { n: number };
      expect(links.n).toBe(0);
    });

    test("noLlm flag: skips LLM call entirely, chain=null", async () => {
      const llm = new MockLLMService({ mode: "happy" });
      const r = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm, { noLlm: true });

      expect(llm.getCallCount()).toBe(0);
      expect(r.answer.chain).toBeNull();
      expect(r.answer.failure_reason).toBe("noLlm flag set");
    });

    test("garbage LLM output: chain=null, failure_reason notes parse failure", async () => {
      const llm = new MockLLMService({ mode: "happy", response: "this is not JSON" });
      const r = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);

      expect(r.answer.chain).toBeNull();
      expect(r.answer.failure_reason).toBe("llm output not JSON");
    });

    test("seed=fact not found: throws", async () => {
      const llm = new MockLLMService({ mode: "happy", response: happyLlmReply("x") });
      await expect(
        runReasoning(db, { kind: "fact", id: "fact-does-not-exist" }, llm)
      ).rejects.toThrow(/fact not found/);
    });
  });

  // -------------------------------------------------------------------------
  // persistDerivedLinks — write-back side effect
  // -------------------------------------------------------------------------

  describe("persistDerivedLinks", () => {
    test("writes one derived_from edge per candidate", () => {
      const written = persistDerivedLinks(db, "fact-seed", ["fact-a", "fact-b"]);
      expect(written).toBe(2);
      const links = getLinks(db, "fact-seed", "out", ["derived_from"]);
      expect(links).toHaveLength(2);
    });

    test("self-loops skipped silently", () => {
      const written = persistDerivedLinks(db, "fact-seed", ["fact-seed", "fact-a"]);
      expect(written).toBe(1); // self-loop skipped, only fact-a written
      const links = getLinks(db, "fact-seed", "out", ["derived_from"]);
      expect(links).toHaveLength(1);
      expect(links[0]?.to_fact_id).toBe("fact-a");
    });

    test("repeated calls reinforce existing edges (observed_count bumps), no duplicates", () => {
      persistDerivedLinks(db, "fact-seed", ["fact-a"]);
      persistDerivedLinks(db, "fact-seed", ["fact-a"]);
      const links = getLinks(db, "fact-seed", "out", ["derived_from"]);
      expect(links).toHaveLength(1);
      expect(links[0]?.observed_count).toBeGreaterThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // Read helpers
  // -------------------------------------------------------------------------

  describe("read helpers", () => {
    test("readChain returns null for unknown chain_id", () => {
      expect(readChain(db, "00000000-0000-5000-8000-000000000000")).toBeNull();
    });

    test("getChainsBySeed returns chains for the given seed, newest first", async () => {
      const llm = new MockLLMService({ mode: "happy", response: happyLlmReply("c1") });
      const r1 = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);
      // Force a different policy version → different chain_id, both for same seed
      const r2 = await runReasoning(
        db,
        { kind: "fact", id: "fact-seed" },
        new MockLLMService({ mode: "happy", response: happyLlmReply("c2") }),
        { policyVersion: "l5-v2" }
      );

      const chains = getChainsBySeed(db, "fact", "fact-seed");
      expect(chains.length).toBeGreaterThanOrEqual(2);
      expect(chains.map((c) => c.chain_id).sort()).toEqual(
        [r1.chain_id, r2.chain_id].sort()
      );
    });

    test("listRecentChains respects limit and only returns active rows", async () => {
      const llm = new MockLLMService({ mode: "happy", response: happyLlmReply("x") });
      await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);
      const recent = listRecentChains(db, 5);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.every((c) => c.status === "active")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Graceful degradation guarantee (debate 025 §Q1 (c) tiebreak)
  // -------------------------------------------------------------------------

  describe("graceful degradation", () => {
    test("sparse graph (no fact_links rows): result behaves as retrieval-only, no edge_refs", async () => {
      // No addLink() calls have happened — fact_links is empty
      const llm = new MockLLMService({ mode: "happy", response: happyLlmReply("retrieval-only chain") });
      const r = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);

      expect(r.edge_refs).toBeNull(); // no incoming/outgoing edges from seed
      expect(r.retrieval_trace.graph_count).toBe(0); // graph lane empty
      expect(r.retrieval_trace.ann_count).toBeGreaterThanOrEqual(0); // retrieval lane drove RRF
      expect(r.candidate_fact_ids.length).toBeGreaterThan(0);
    });

    test("dense graph (pre-seeded fact_links): graph lane contributes candidates", async () => {
      // Seed graph manually so the seed has real outgoing edges before reasoning
      addLink(db, "fact-seed", "fact-a", "supports");
      addLink(db, "fact-seed", "fact-b", "elaborates");

      const llm = new MockLLMService({ mode: "happy", response: happyLlmReply("dense chain") });
      const r = await runReasoning(db, { kind: "fact", id: "fact-seed" }, llm);

      expect(r.retrieval_trace.graph_count).toBeGreaterThan(0);
      expect(r.edge_refs).not.toBeNull();
      expect(r.edge_refs!.length).toBeGreaterThanOrEqual(2);
    });
  });
});
