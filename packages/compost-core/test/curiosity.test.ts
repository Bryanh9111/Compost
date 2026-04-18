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
