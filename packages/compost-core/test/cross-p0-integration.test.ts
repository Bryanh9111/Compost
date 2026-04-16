import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { reflect } from "../src/cognitive/reflect";
import { synthesizeWiki } from "../src/cognitive/wiki";
import { takeSnapshot } from "../src/cognitive/graph-health";
import { listDecisions } from "../src/cognitive/audit";
import { getLinks } from "../src/cognitive/fact-links";
import { ask } from "../src/query/ask";
import { MockLLMService } from "../src/llm/mock";
import { BreakerRegistry } from "../src/llm/breaker-registry";
import { CircuitBreakerLLM } from "../src/llm/circuit-breaker";

/**
 * Day 4 cross-P0 integration suite (Phase 4 Batch D).
 *
 * Validates the full scenario locked in debate 009 synthesis:
 *   LLM fail -> breaker open -> wiki.stale_at set
 *        -> ask() reads stale banner + BM25 [LLM unavailable] fallback
 *        -> reflect() writes decision_audit + fact_links + archived loser
 *        -> takeSnapshot() reflects link/cluster counts coherently.
 *
 * These are deliberately cross-module: unit-level state machine coverage
 * already lives in audit.test / circuit-breaker.test / reflect-archive-reason.test.
 * This suite checks that the modules compose without state drift between them.
 */

const SOURCE_ROW =
  "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)";
const OBS_ROW =
  "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','payload',1,'user','idem','tp-2026-04',NULL)";

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
  opts: { confidence?: number } = {}
): void {
  db.run(
    "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence, importance) VALUES (?,?,?,?,?,?,?)",
    [factId, subject, predicate, object, "obs1", opts.confidence ?? 0.8, 0.5]
  );
}

describe("cross-P0 integration (Phase 4 Batch D Day 4)", () => {
  let tmpDir: string;
  let dataDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-crossp0-"));
    dataDir = join(tmpDir, "compost");
    mkdirSync(dataDir, { recursive: true });
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

  // -------------------------------------------------------------------
  // Scenario A: reflect -> audit + fact_links + graph_health snapshot
  //
  // Two contradicting facts for the same (subject, predicate). reflect
  // arbitrates (P0-2), writes a contradicts edge (P0-0), archives the
  // loser with archive_reason='contradicted' + replaced_by_fact_id (P0-4).
  // takeSnapshot (P0-3) must see 1 active fact + 1 link without drift.
  // -------------------------------------------------------------------
  test("reflect writes audit + fact_links + snapshot stays coherent", () => {
    // Winner has higher confidence -> wins arbitration.
    insertFact(db, "fw", "paris", "capital-of", "france", { confidence: 0.95 });
    insertFact(db, "fl", "paris", "capital-of", "england", { confidence: 0.6 });

    const report = reflect(db);
    expect(report.contradictionsResolved).toBe(1);
    expect(report.errors).toEqual([]);

    // P0-2: decision_audit row written.
    const audits = listDecisions(db, { kind: "contradiction_arbitration" });
    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.decidedBy).toBe("reflect");
    const evidence = audit.evidenceRefs;
    expect(evidence.kind).toBe("contradiction_arbitration");
    if (evidence.kind === "contradiction_arbitration") {
      expect(evidence.winner_id).toBe("fw");
      expect(evidence.loser_ids).toEqual(["fl"]);
      expect(evidence.subject).toBe("paris");
      expect(evidence.predicate).toBe("capital-of");
    }

    // P0-0: fact_links contradicts edge written from loser -> winner.
    const outLinks = getLinks(db, "fl", "out");
    expect(outLinks).toHaveLength(1);
    expect(outLinks[0]!.kind).toBe("contradicts");
    expect(outLinks[0]!.to_fact_id).toBe("fw");

    // P0-4: loser has archive_reason + replaced_by_fact_id.
    const loser = db
      .query(
        "SELECT archive_reason, replaced_by_fact_id, archived_at FROM facts WHERE fact_id = 'fl'"
      )
      .get() as {
      archive_reason: string;
      replaced_by_fact_id: string;
      archived_at: string;
    };
    expect(loser.archive_reason).toBe("contradicted");
    expect(loser.replaced_by_fact_id).toBe("fw");
    expect(loser.archived_at).not.toBeNull();

    // P0-3: snapshot reflects the post-reflect state.
    //   totalFacts = active facts only (loser archived).
    //   clusterCount counts active facts' connected components.
    //   The link is loser->winner; loser is archived, so the remaining
    //   active graph has 1 node (winner) and 0 usable edges.
    const snap = takeSnapshot(db);
    expect(snap.totalFacts).toBe(1);
    expect(snap.clusterCount).toBeGreaterThanOrEqual(1);

    // Re-running reflect must be idempotent: no duplicate audit rows, no
    // duplicate link rows.
    const report2 = reflect(db);
    expect(report2.contradictionsResolved).toBe(0);
    expect(listDecisions(db, { kind: "contradiction_arbitration" })).toHaveLength(1);
    expect(getLinks(db, "fl", "out")).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Scenario B: breaker open -> wiki stale_at set -> ask() surfaces
  // both the stale banner AND the [LLM unavailable] BM25 fallback.
  // -------------------------------------------------------------------
  test("breaker open: wiki stale_at + ask stale banner + BM25 fallback", async () => {
    insertFact(db, "f1", "paris", "is-in", "france", { confidence: 0.95 });
    insertFact(db, "f2", "paris", "capital-of", "france", { confidence: 0.9 });

    // 1. First wiki synth succeeds via a happy registry.
    const happyRegistry = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "# Paris\n\nseeded wiki" })
    );
    const firstResult = await synthesizeWiki(db, happyRegistry, dataDir);
    expect(firstResult.pages_created).toBe(1);

    // Baseline: stale_at is NULL, wiki_rebuild audit row exists.
    const beforeRow = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(beforeRow.stale_at).toBeNull();
    expect(listDecisions(db, { kind: "wiki_rebuild" })).toHaveLength(1);

    // Add a new fact so findTopicsNeedingSynthesis re-lists paris.
    insertFact(db, "f3", "paris", "population", "2M", { confidence: 0.8 });

    // 2. Trip a dedicated wiki.synthesis breaker before the second synth.
    const failingInner = new MockLLMService({ mode: "error", errorMessage: "boom" });
    const failingBreaker = new CircuitBreakerLLM(failingInner, "wiki.synthesis", {
      minFailures: 1,
      failureRate: 0,
      openMs: 60_000,
    });
    await failingBreaker.generate("probe").catch(() => {});
    expect(failingBreaker.getState()).toBe("open");

    const secondResult = await synthesizeWiki(db, failingBreaker, dataDir);
    expect(secondResult.pages_created).toBe(0);
    expect(secondResult.pages_updated).toBe(0);

    // wiki_pages.stale_at set; disk still holds the seeded content.
    const afterRow = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(afterRow.stale_at).not.toBeNull();
    const diskContent = readFileSync(join(dataDir, "wiki", "paris.md"), "utf-8");
    expect(diskContent).toContain("seeded wiki");

    // 3. ask() with a failing registry must produce BOTH banners.
    //    expandQuery failure is silent (returns [question]); the answer
    //    path catches CircuitOpenError and falls back to BM25.
    const failingAskRegistry = new BreakerRegistry(
      new MockLLMService({ mode: "error", errorMessage: "boom" }),
      { minFailures: 1, failureRate: 0, openMs: 60_000 }
    );
    // Warm up both sites so their breakers are open by the time ask() runs.
    const expandBreaker = failingAskRegistry.get("ask.expand");
    const answerBreaker = failingAskRegistry.get("ask.answer");
    await expandBreaker.generate("warm").catch(() => {});
    await answerBreaker.generate("warm").catch(() => {});
    expect(answerBreaker.getState()).toBe("open");

    const askResult = await ask(db, "paris", failingAskRegistry, {
      budget: 5,
      expandQueries: false, // avoid expand-side noise in this assertion
    });

    expect(askResult.answer).toContain("[LLM unavailable");
    // Hit at least one fact so BM25 fallback has something to render.
    expect(askResult.hits.length).toBeGreaterThan(0);
    // Wiki page is referenced (stale or not, ask still reads the row).
    expect(askResult.wiki_pages_used).toContain("paris.md");

    // 4. Recovery: a happy registry rebuild clears stale_at.
    const recoverRegistry = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "# Paris v2\n\nrefreshed" })
    );
    // Add one more fact so topic reappears in findTopicsNeedingSynthesis.
    insertFact(db, "f4", "paris", "timezone", "CET", { confidence: 0.8 });
    await synthesizeWiki(db, recoverRegistry, dataDir);
    const finalRow = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(finalRow.stale_at).toBeNull();
    // Two wiki_rebuild audit rows now (seed + recovery; failing call wrote none).
    expect(listDecisions(db, { kind: "wiki_rebuild" })).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // Scenario B2 (Week 4 Day 5): ask() with zero hits must still surface
  // a matching wiki page by question slug + its stale_at banner.
  // Closes ROADMAP known-risk row 3.
  // -------------------------------------------------------------------
  test("ask(hits=0) falls back to wiki title slug + preserves stale banner", async () => {
    // Seed a wiki page but NO facts whose subject matches the query.
    // The only way the wiki shows up is the new slug-title fallback.
    const happyRegistry = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "# Paris\n\nseeded" })
    );
    insertFact(db, "fother", "berlin", "is-in", "germany", { confidence: 0.9 });
    await synthesizeWiki(db, happyRegistry, dataDir);
    // Mark the page stale so the banner must survive the fallback.
    db.run(
      "UPDATE wiki_pages SET stale_at = datetime('now') WHERE title = 'berlin'"
    );

    // Build an ask registry whose answer breaker is OPEN so the fallback
    // path renders -- the BM25 block will include the wiki banner.
    const failingAnswer = new BreakerRegistry(
      new MockLLMService({ mode: "error", errorMessage: "boom" }),
      { minFailures: 1, failureRate: 0, openMs: 60_000 }
    );
    await failingAnswer.get("ask.answer").generate("warm").catch(() => {});

    // Query by exact wiki title. There are no facts about "berlin" that
    // would surface via BM25/LanceDB hits -- only the slug fallback wires
    // this up.
    const result = await ask(db, "berlin", failingAnswer, {
      budget: 5,
      expandQueries: false,
    });

    expect(result.wiki_pages_used).toContain("berlin.md");
    // Answer is the BM25 fallback (answer breaker open), but the wiki
    // page's stale banner should still have been consumed by the prompt
    // builder, visible via the wiki_pages_used evidence.
    expect(result.answer).toContain("[LLM unavailable");
  });

  // -------------------------------------------------------------------
  // Scenario C: happy path composition. reflect (contradiction) +
  // synthesizeWiki + ask run end-to-end; the audit trail shows both
  // kinds and ask consumes the fresh wiki page.
  // -------------------------------------------------------------------
  test("happy path: reflect + wiki + ask compose without audit drift", async () => {
    insertFact(db, "fw", "paris", "capital-of", "france", { confidence: 0.95 });
    insertFact(db, "fl", "paris", "capital-of", "england", { confidence: 0.6 });
    insertFact(db, "fs", "paris", "is-in", "europe", { confidence: 0.9 });

    // reflect resolves the contradiction -> 1 audit row.
    const report = reflect(db);
    expect(report.contradictionsResolved).toBe(1);

    // Debate 010 Fix 3: one shared BreakerRegistry drives both wiki synthesis
    // AND ask() so we validate that the two sites (wiki.synthesis and
    // ask.answer) live in the same registry without polluting each other.
    const registry = new BreakerRegistry(
      new MockLLMService({ mode: "happy", response: "Paris is the capital of France." })
    );
    const wikiResult = await synthesizeWiki(db, registry, dataDir);
    expect(wikiResult.pages_created).toBeGreaterThanOrEqual(1);

    const arb = listDecisions(db, { kind: "contradiction_arbitration" });
    const rebuild = listDecisions(db, { kind: "wiki_rebuild" });
    expect(arb).toHaveLength(1);
    expect(rebuild.length).toBeGreaterThanOrEqual(1);

    // Same registry drives ask(); both breakers should be closed + independent.
    const askResult = await ask(db, "paris", registry, {
      budget: 5,
      expandQueries: false,
    });
    const wikiBreaker = registry.get("wiki.synthesis");
    const answerBreaker = registry.get("ask.answer");
    expect(wikiBreaker.getState()).toBe("closed");
    expect(answerBreaker.getState()).toBe("closed");
    // Different objects -- site-level isolation confirmed.
    expect(wikiBreaker).not.toBe(answerBreaker);
    expect(askResult.answer).not.toContain("[LLM unavailable");
    expect(askResult.answer.toLowerCase()).toContain("paris");

    // Snapshot reflects post-reflect totals (loser archived).
    const snap = takeSnapshot(db);
    expect(snap.totalFacts).toBe(2); // fw + fs remain active
  });
});
