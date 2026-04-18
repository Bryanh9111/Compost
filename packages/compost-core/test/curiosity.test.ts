import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  detectCuriosityClusters,
  tokenizeQuestion,
  jaccardOverlap,
  matchFactsToGaps,
} from "../src/cognitive/curiosity";
import { logGap, dismissGap, resolveGap } from "../src/cognitive/gap-tracker";

// ---------------------------------------------------------------------------
// tokenizeQuestion — pure helper
// ---------------------------------------------------------------------------

describe("tokenizeQuestion", () => {
  test("lowercases + strips short tokens + strips stopwords", () => {
    const tokens = tokenizeQuestion("What is quasiperiodicity?");
    expect(tokens).toContain("quasiperiodicity");
    expect(tokens).not.toContain("what"); // stopword
    expect(tokens).not.toContain("is"); // stopword + too short
  });

  test("keeps meaningful domain nouns", () => {
    const tokens = tokenizeQuestion("Why does the FTS5 ranking break on long queries?");
    expect(tokens).toEqual(
      expect.arrayContaining(["fts5", "ranking", "break", "long", "queries"])
    );
  });

  test("deduplicates repeated tokens", () => {
    const tokens = tokenizeQuestion("cache cache cache");
    expect(tokens).toEqual(["cache"]);
  });

  test("empty string yields no tokens", () => {
    expect(tokenizeQuestion("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// jaccardOverlap — pure helper
// ---------------------------------------------------------------------------

describe("jaccardOverlap", () => {
  test("identical token sets → 1.0", () => {
    expect(jaccardOverlap(["a", "b"], ["a", "b"])).toBe(1);
  });

  test("disjoint token sets → 0.0", () => {
    expect(jaccardOverlap(["a", "b"], ["c", "d"])).toBe(0);
  });

  test("partial overlap computes correctly", () => {
    // {a,b,c} ∩ {b,c,d} = {b,c} (2); union = 4. 2/4 = 0.5
    expect(jaccardOverlap(["a", "b", "c"], ["b", "c", "d"])).toBe(0.5);
  });

  test("empty sets → 0 (no accidental NaN)", () => {
    expect(jaccardOverlap([], [])).toBe(0);
    expect(jaccardOverlap(["a"], [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectCuriosityClusters
// ---------------------------------------------------------------------------

describe("detectCuriosityClusters", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-curiosity-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("empty database yields empty report", () => {
    const r = detectCuriosityClusters(db);
    expect(r.clusters).toEqual([]);
    expect(r.unclustered).toEqual([]);
    expect(r.window_days).toBeGreaterThan(0);
  });

  test("single gap lands in unclustered (no peer to cluster with)", () => {
    logGap(db, "What is quasiperiodicity?");
    const r = detectCuriosityClusters(db);
    expect(r.clusters).toEqual([]);
    expect(r.unclustered).toHaveLength(1);
  });

  test("two overlapping gaps form a cluster", () => {
    logGap(db, "What is FTS5 ranking?");
    logGap(db, "How does FTS5 ranking break?");
    const r = detectCuriosityClusters(db, { minJaccard: 0.3 });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.gap_ids).toHaveLength(2);
    expect(r.clusters[0]!.shared_tokens).toEqual(
      expect.arrayContaining(["fts5", "ranking"])
    );
    expect(r.unclustered).toHaveLength(0);
  });

  test("two disjoint gaps stay unclustered", () => {
    logGap(db, "What is phi?");
    logGap(db, "Quasiperiodicity means exactly?");
    const r = detectCuriosityClusters(db, { minJaccard: 0.3 });
    expect(r.clusters).toEqual([]);
    expect(r.unclustered).toHaveLength(2);
  });

  test("threshold controls clustering granularity", () => {
    logGap(db, "What is FTS5 ranking?");
    logGap(db, "FTS5 query latency?");
    // minJaccard 0.5 is strict — {fts5,ranking} vs {fts5,query,latency}
    // intersection=1, union=4, 0.25 < 0.5 → no cluster
    expect(detectCuriosityClusters(db, { minJaccard: 0.5 }).clusters).toHaveLength(0);
    // minJaccard 0.2 → clusters
    expect(detectCuriosityClusters(db, { minJaccard: 0.2 }).clusters).toHaveLength(1);
  });

  test("representative picks the highest ask_count member", () => {
    logGap(db, "What is FTS5 ranking?");
    logGap(db, "FTS5 ranking explained?"); // this one will be asked 3x total
    logGap(db, "fts5 ranking explained"); // same hash as previous — bumps to 2
    logGap(db, "fts5 ranking explained."); // same hash — bumps to 3
    const r = detectCuriosityClusters(db, { minJaccard: 0.3 });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.representative).toContain("FTS5 ranking explained");
    expect(r.clusters[0]!.total_asks).toBeGreaterThanOrEqual(4);
  });

  test("dismissed/resolved gaps are excluded by default (status=open)", () => {
    const g1 = logGap(db, "What is FTS5 ranking?");
    const g2 = logGap(db, "FTS5 ranking explained?");
    dismissGap(db, g1.problem_id);
    resolveGap(db, g2.problem_id);
    const r = detectCuriosityClusters(db);
    expect(r.clusters).toEqual([]);
    expect(r.unclustered).toEqual([]);
  });

  test("status filter surfaces resolved clusters when requested", () => {
    const g1 = logGap(db, "What is FTS5 ranking?");
    const g2 = logGap(db, "FTS5 ranking explained?");
    resolveGap(db, g1.problem_id);
    resolveGap(db, g2.problem_id);
    const r = detectCuriosityClusters(db, {
      status: "resolved",
      minJaccard: 0.3,
    });
    expect(r.clusters).toHaveLength(1);
  });

  test("maxClusters caps the top-N", () => {
    logGap(db, "What is FTS5?"); logGap(db, "FTS5 explained?");
    logGap(db, "What is Ollama?"); logGap(db, "Ollama setup?");
    logGap(db, "What is LanceDB?"); logGap(db, "LanceDB docs?");
    const r = detectCuriosityClusters(db, {
      minJaccard: 0.2,
      maxClusters: 2,
    });
    expect(r.clusters).toHaveLength(2);
  });

  test("clusters sorted by total_asks desc (highest-reinforcement first)", () => {
    // Cluster 1: FTS5, asked 2 total
    logGap(db, "What is FTS5?");
    logGap(db, "FTS5 explained?");
    // Cluster 2: Ollama, asked 5 total (one gap asked 4x)
    logGap(db, "What is Ollama?");
    const q = "Ollama setup?";
    logGap(db, q); logGap(db, q); logGap(db, q); logGap(db, q);

    const r = detectCuriosityClusters(db, { minJaccard: 0.3 });
    expect(r.clusters).toHaveLength(2);
    expect(r.clusters[0]!.shared_tokens).toContain("ollama");
    expect(r.clusters[0]!.total_asks).toBeGreaterThanOrEqual(5);
    expect(r.clusters[1]!.shared_tokens).toContain("fts5");
  });
});

// ---------------------------------------------------------------------------
// matchFactsToGaps — "new fact may answer this open gap" active L4 suggestion
// ---------------------------------------------------------------------------

describe("matchFactsToGaps", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-match-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    // Seed source + observation that facts will reference.
    db.run(
      "INSERT INTO source VALUES ('s1','file:///s1','local-file',NULL,0.0,'user',datetime('now'),NULL)"
    );
    db.run(
      `INSERT INTO observations VALUES ('obs-1','s1','file:///s1',
       datetime('now','-1 days'),datetime('now','-1 days'),
       'h','r',NULL,NULL,'text/plain','test',1,'user','idem-1','tp-2026-04',NULL,NULL,NULL)`
    );
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedFact(
    factId: string,
    subject: string,
    predicate: string,
    object: string,
    opts: {
      confidence?: number;
      daysAgo?: number;
      archived?: boolean;
      supersededBy?: string;
    } = {}
  ): void {
    db.run(
      `INSERT INTO facts
         (fact_id, subject, predicate, object, confidence, importance,
          observe_id, created_at, archived_at, superseded_by)
       VALUES (?, ?, ?, ?, ?, 0.5, 'obs-1',
               datetime('now', ? || ' days'), ?, ?)`,
      [
        factId,
        subject,
        predicate,
        object,
        opts.confidence ?? 0.9,
        -(opts.daysAgo ?? 1),
        opts.archived ? "archived" : null,
        opts.supersededBy ?? null,
      ]
    );
  }

  test("empty db yields empty matches", () => {
    expect(matchFactsToGaps(db)).toEqual([]);
  });

  test("no recent facts → every open gap returns with empty candidate list", () => {
    logGap(db, "What is FTS5?");
    const r = matchFactsToGaps(db);
    expect(r).toHaveLength(1);
    expect(r[0]!.candidate_facts).toEqual([]);
  });

  test("single fact whose tokens overlap gap tokens surfaces as candidate", () => {
    logGap(db, "What is FTS5 ranking?");
    seedFact("f1", "FTS5 ranking", "computed via", "BM25 + weights", {
      confidence: 0.9,
      daysAgo: 1,
    });
    const r = matchFactsToGaps(db, { minOverlap: 2 });
    expect(r).toHaveLength(1);
    expect(r[0]!.candidate_facts).toHaveLength(1);
    expect(r[0]!.candidate_facts[0]!.fact_id).toBe("f1");
  });

  test("fact below overlap threshold is excluded", () => {
    logGap(db, "What is FTS5 ranking?");
    seedFact("f-weak", "Postgres", "uses", "replication", { daysAgo: 1 });
    const r = matchFactsToGaps(db, { minOverlap: 2 });
    expect(r[0]!.candidate_facts).toEqual([]);
  });

  test("multiple candidates sorted by overlap desc, capped at maxCandidatesPerGap", () => {
    logGap(db, "What is FTS5 ranking in hybrid search?");
    seedFact("f-strong", "FTS5 ranking hybrid", "is", "BM25 score");
    seedFact("f-mid", "FTS5 ranking", "is", "score");
    seedFact("f-noise", "FTS5", "works", "with sqlite");
    const r = matchFactsToGaps(db, {
      minOverlap: 2,
      maxCandidatesPerGap: 2,
    });
    const ids = r[0]!.candidate_facts.map((c) => c.fact_id);
    expect(ids).toEqual(["f-strong", "f-mid"]);
  });

  test("dismissed / resolved gaps are excluded", () => {
    const g1 = logGap(db, "What is FTS5?");
    const g2 = logGap(db, "How does FTS5 work?");
    dismissGap(db, g1.problem_id);
    resolveGap(db, g2.problem_id);
    seedFact("f1", "FTS5", "uses", "BM25");
    const r = matchFactsToGaps(db);
    expect(r).toEqual([]);
  });

  test("archived / superseded facts excluded from candidate pool", () => {
    logGap(db, "What is FTS5 ranking?");
    seedFact("f-live", "FTS5 ranking", "is", "BM25 score");
    seedFact("f-arch", "FTS5 ranking", "is", "BM25 score", {
      archived: true,
    });
    seedFact("f-super", "FTS5 ranking", "is", "BM25 score", {
      supersededBy: "f-live",
    });
    const r = matchFactsToGaps(db, { minOverlap: 2 });
    const ids = r[0]!.candidate_facts.map((c) => c.fact_id);
    expect(ids).toEqual(["f-live"]);
  });

  test("facts below confidence floor excluded", () => {
    logGap(db, "What is FTS5 ranking?");
    seedFact("f-low", "FTS5 ranking", "is", "BM25 score", {
      confidence: 0.6,
    });
    seedFact("f-ok", "FTS5 ranking", "is", "BM25 score", {
      confidence: 0.9,
    });
    const r = matchFactsToGaps(db, {
      minOverlap: 2,
      confidenceFloor: 0.75,
    });
    const ids = r[0]!.candidate_facts.map((c) => c.fact_id);
    expect(ids).toEqual(["f-ok"]);
  });

  test("window filter excludes old facts", () => {
    logGap(db, "What is FTS5 ranking?");
    seedFact("f-fresh", "FTS5 ranking", "is", "BM25 score", { daysAgo: 1 });
    seedFact("f-stale", "FTS5 ranking", "is", "BM25 score", { daysAgo: 30 });
    const r = matchFactsToGaps(db, { sinceDays: 7, minOverlap: 2 });
    const ids = r[0]!.candidate_facts.map((c) => c.fact_id);
    expect(ids).toEqual(["f-fresh"]);
  });

  test("gaps with no candidates still returned (user sees 'still open')", () => {
    logGap(db, "Unrelated question about quasiperiodicity?");
    logGap(db, "How does FTS5 ranking work?");
    seedFact("f1", "FTS5 ranking", "uses", "BM25");
    const r = matchFactsToGaps(db, { minOverlap: 2 });
    expect(r).toHaveLength(2);
    const byQuestion = Object.fromEntries(
      r.map((m) => [m.question, m.candidate_facts.length])
    );
    expect(byQuestion["How does FTS5 ranking work?"]).toBeGreaterThanOrEqual(1);
    expect(
      byQuestion["Unrelated question about quasiperiodicity?"]
    ).toBe(0);
  });

  test("maxGaps caps returned gaps (highest ask_count first)", () => {
    logGap(db, "Q A?"); // 1 ask
    logGap(db, "Q B?"); // will bump
    logGap(db, "q b?"); // bumps B to 2
    logGap(db, "Q C?"); // 1 ask
    const r = matchFactsToGaps(db, { maxGaps: 2 });
    expect(r).toHaveLength(2);
    // Highest ask_count first
    expect(r[0]!.question).toBe("Q B?");
  });
});
