import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  query,
  type QueryHit,
  type QueryOptions,
  type QueryResult,
} from "../src/query/search";

describe("query/search (Phase 0 stub)", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-query-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("query returns QueryResult with empty hits array", () => {
    const result = query(db, "anything");
    expect(result.hits).toEqual([]);
    expect(result.query_id).toBeTruthy();
  });

  test("query returns a stable query_id (UUID format)", () => {
    const result = query(db, "test query");
    expect(result.query_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("QueryResult shape matches spec (ranking_profile_id, budget)", () => {
    const result = query(db, "test", { budget: 10, ranking_profile_id: "rp-phase1-default" });
    expect(result.ranking_profile_id).toBe("rp-phase1-default");
    expect(result.budget).toBe(10);
    expect(result.hits).toEqual([]);
  });

  test("default budget is 20, default profile is rp-phase1-default", () => {
    const result = query(db, "test");
    expect(result.ranking_profile_id).toBe("rp-phase1-default");
    expect(result.budget).toBe(20);
  });

  test("QueryHit type has correct shape (compile-time check)", () => {
    // This is a compile-time type check more than runtime,
    // but verifying the shape is importable and correct.
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
    expect(mockHit.final_score).toBe(0);
  });

  test("query accepts QueryOptions with contexts filter", () => {
    const opts: QueryOptions = {
      contexts: ["work", "project-x"],
      budget: 5,
      as_of_unix_sec: 1712000000,
      debug_ranking: true,
    };
    const result = query(db, "test", opts);
    expect(result.hits).toEqual([]);
  });
});
