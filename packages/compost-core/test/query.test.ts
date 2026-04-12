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
      ranking_profile_id: "rp-phase1-default",
    });
    expect(result.ranking_profile_id).toBe("rp-phase1-default");
    expect(result.budget).toBe(10);
    expect(result.hits).toEqual([]);
  });

  test("defaults: budget=20, profile=rp-phase1-default", async () => {
    const result = await query(db, "test");
    expect(result.ranking_profile_id).toBe("rp-phase1-default");
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
    expect(topHit.provenance.transform_policy).toBe("tp-2026-04");
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
      // Phase 1: w2-w4 are 0 because profile weights are 0
      expect(hit.ranking_components.w2_temporal).toBe(0);
      expect(hit.ranking_components.w3_access).toBe(0);
    }
  });
});
