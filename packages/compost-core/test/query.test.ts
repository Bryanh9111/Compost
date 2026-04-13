import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { upsertPolicies } from "../src/policies/registry";
import { OllamaEmbeddingService } from "../src/embedding/ollama";
import { VectorStore } from "../src/storage/lancedb";
import { ingestFile } from "../src/pipeline/ingest";
import {
  query,
  type QueryHit,
  type QueryOptions,
  type QueryResult,
} from "../src/query/search";

describe("query/search", () => {
  let db: Database;
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-query-"));
    dataDir = join(tmpDir, "data");
    require("fs").mkdirSync(dataDir, { recursive: true });
    db = new Database(join(dataDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("query without vectorStore returns empty hits", async () => {
    const result = await query(db, "anything");
    expect(result.hits).toEqual([]);
    expect(result.query_id).toBeTruthy();
  });

  test("query returns UUID format query_id", async () => {
    const result = await query(db, "test query");
    expect(result.query_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("QueryResult shape matches spec", async () => {
    const result = await query(db, "test", {
      budget: 10,
      ranking_profile_id: "rp-phase3-default",
    });
    expect(result.ranking_profile_id).toBe("rp-phase3-default");
    expect(result.budget).toBe(10);
    expect(result.hits).toEqual([]);
  });

  test("defaults: budget=20, profile=rp-phase3-default", async () => {
    const result = await query(db, "test");
    expect(result.ranking_profile_id).toBe("rp-phase3-default");
    expect(result.budget).toBe(20);
  });

  test("QueryHit type has correct shape", () => {
    const mockHit: QueryHit = {
      fact: { subject: "s", predicate: "p", object: "o" },
      fact_id: "f1",
      confidence: 0.9,
      provenance: {
        source_uri: "file:///test",
        captured_at: "2026-04-01",
        adapter: "test",
        transform_policy: "tp-2026-04",
      },
      contexts: [],
      ranking_components: {},
      final_score: 0,
    };
    expect(mockHit.ranking_components).toEqual({});
  });

  test("empty query returns empty hits", async () => {
    const result = await query(db, "  ");
    expect(result.hits).toEqual([]);
  });
});

describe("query/search (BM25-only, no vectorStore)", () => {
  let db: Database;
  let tmpDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-bm25-"));
    dataDir = join(tmpDir, "data");
    require("fs").mkdirSync(dataDir, { recursive: true });
    db = new Database(join(dataDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    upsertPolicies(db);

    // Insert test facts directly (bypassing ingest pipeline)
    db.run("INSERT INTO source VALUES ('s1','file:///test','local-file',NULL,0.0,'user',datetime('now'),NULL)");
    db.run(
      `INSERT INTO observations VALUES ('obs1','s1','file:///test',datetime('now'),datetime('now'),
       'hash1','raw1',NULL,NULL,'text/plain','test-adapter',1,'user','idem1','tp-2026-04',NULL)`
    );
    db.run(
      `INSERT INTO facts(fact_id, subject, predicate, object, confidence, importance, observe_id,
       last_reinforced_at_unix_sec, half_life_seconds)
       VALUES ('f1', 'TypeScript', 'is', 'a typed superset of JavaScript', 0.9, 0.7, 'obs1',
       ${Math.floor(Date.now() / 1000)}, 2592000)`
    );
    db.run(
      `INSERT INTO facts(fact_id, subject, predicate, object, confidence, importance, observe_id,
       last_reinforced_at_unix_sec, half_life_seconds)
       VALUES ('f2', 'Python', 'is used for', 'data science and machine learning', 0.9, 0.6, 'obs1',
       ${Math.floor(Date.now() / 1000)}, 2592000)`
    );
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("BM25-only query returns results without vectorStore", async () => {
    const result = await query(db, "TypeScript");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].fact.subject).toBe("TypeScript");
  });

  test("BM25 finds exact keyword matches", async () => {
    const result = await query(db, "Python");
    expect(result.hits.length).toBeGreaterThan(0);
    const pythonHit = result.hits.find((h) => h.fact.subject === "Python");
    expect(pythonHit).toBeTruthy();
  });

  test("BM25-only has semantic_score=0 in ranking_components", async () => {
    const result = await query(db, "TypeScript");
    if (result.hits.length > 0) {
      expect(result.hits[0].ranking_components.w1_semantic).toBe(0);
    }
  });
});

describe("query/search (integration with LanceDB)", () => {
  let db: Database;
  let tmpDir: string;
  let dataDir: string;
  let embSvc: OllamaEmbeddingService;
  let vectorStore: VectorStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-query-int-"));
    dataDir = join(tmpDir, "data");
    require("fs").mkdirSync(dataDir, { recursive: true });
    db = new Database(join(dataDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    upsertPolicies(db);

    embSvc = new OllamaEmbeddingService();
    vectorStore = new VectorStore(join(dataDir, "lancedb"), embSvc);
    await vectorStore.connect();

    // Ingest test documents
    const doc1 = join(tmpDir, "ml.md");
    writeFileSync(
      doc1,
      `# Machine Learning

Neural networks are computational models inspired by the brain.

## Deep Learning

Convolutional networks excel at image recognition tasks.
`
    );

    const doc2 = join(tmpDir, "cooking.md");
    writeFileSync(
      doc2,
      `# Italian Cooking

Pasta is made from durum wheat semolina and water.

## Techniques

Al dente means cooking pasta until it is firm to the bite.
`
    );

    await ingestFile(db, doc1, dataDir, {
      embeddingService: embSvc,
      vectorStore,
    });
    await ingestFile(db, doc2, dataDir, {
      embeddingService: embSvc,
      vectorStore,
    });
  });

  afterEach(async () => {
    await vectorStore.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("query returns relevant results ranked by semantic similarity", async () => {
    const result = await query(db, "artificial intelligence", {}, vectorStore);

    expect(result.hits.length).toBeGreaterThan(0);
    // ML-related facts should rank higher than cooking
    const topHit = result.hits[0];
    expect(topHit.fact).toBeTruthy();
    expect(topHit.fact_id).toBeTruthy();
    expect(topHit.confidence).toBeGreaterThan(0);
    expect(topHit.final_score).toBeGreaterThan(0);
    expect(topHit.provenance.source_uri).toBeTruthy();
    expect(topHit.provenance.transform_policy).toBe("tp-2026-04-03");
  });

  test("query respects budget limit", async () => {
    const result = await query(db, "learning", { budget: 1 }, vectorStore);
    expect(result.hits.length).toBeLessThanOrEqual(1);
    expect(result.budget).toBe(1);
  });

  test("debug_ranking writes to ranking_audit_log", async () => {
    const result = await query(
      db,
      "neural networks",
      { debug_ranking: true },
      vectorStore
    );

    if (result.hits.length > 0) {
      const auditCount = db
        .query(
          "SELECT count(*) as cnt FROM ranking_audit_log WHERE query_id = ?"
        )
        .get(result.query_id) as { cnt: number };
      expect(auditCount.cnt).toBe(result.hits.length);
    }
  });

  test("query writes to access_log", async () => {
    const result = await query(db, "pasta cooking", {}, vectorStore);

    if (result.hits.length > 0) {
      const accessCount = db
        .query(
          "SELECT count(*) as cnt FROM access_log WHERE query_id = ?"
        )
        .get(result.query_id) as { cnt: number };
      expect(accessCount.cnt).toBe(result.hits.length);
    }
  });

  test("ranking_components has w1_semantic > 0 for results", async () => {
    const result = await query(db, "machine learning", {}, vectorStore);

    for (const hit of result.hits) {
      expect(hit.ranking_components.w1_semantic).toBeGreaterThan(0);
      // rp-phase3-default: w2_temporal=0.15, w3_access=0.1
      // w2 should be > 0 for fresh facts; w3 starts at 0 (no access history yet)
      expect(hit.ranking_components.w2_temporal).toBeGreaterThanOrEqual(0);
      expect(hit.ranking_components.w3_access).toBeGreaterThanOrEqual(0);
    }
  });

  test("temporal decay: rp-phase3-default makes w2_temporal nonzero", async () => {
    const result = await query(
      db,
      "machine learning",
      { ranking_profile_id: "rp-phase3-default" },
      vectorStore
    );

    expect(result.hits.length).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.ranking_components.w1_semantic).toBeGreaterThan(0);
      // w2_temporal should now contribute (0.15 * decay_factor)
      expect(hit.ranking_components.w2_temporal).toBeGreaterThan(0);
    }
  });

  test("temporal decay: far-future as_of penalizes old facts", async () => {
    // Query with current time — facts are fresh
    const fresh = await query(
      db,
      "neural networks",
      { ranking_profile_id: "rp-phase3-default", as_of_unix_sec: Math.floor(Date.now() / 1000) },
      vectorStore
    );

    // Query with as_of 1 year in the future — facts should decay
    const oneYearLater = Math.floor(Date.now() / 1000) + 365 * 86400;
    const stale = await query(
      db,
      "neural networks",
      { ranking_profile_id: "rp-phase3-default", as_of_unix_sec: oneYearLater },
      vectorStore
    );

    if (fresh.hits.length > 0 && stale.hits.length > 0) {
      // Same fact should have lower final_score when queried far in the future
      expect(stale.hits[0].final_score).toBeLessThan(fresh.hits[0].final_score);
      // w2_temporal should be smaller (more decayed)
      expect(stale.hits[0].ranking_components.w2_temporal).toBeLessThan(
        fresh.hits[0].ranking_components.w2_temporal
      );
    }
  });
});
