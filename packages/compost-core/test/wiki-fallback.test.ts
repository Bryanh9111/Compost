import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { MockLLMService } from "../src/llm/mock";
import { CircuitBreakerLLM, CircuitOpenError } from "../src/llm/circuit-breaker";
import { synthesizeWiki } from "../src/cognitive/wiki";

/**
 * P0-6 Week 3 wiki fallback (debate 007 Lock 6): when the LLM fails during
 * wiki synthesis, keep the existing on-disk page but mark wiki_pages.stale_at
 * so downstream readers can flag the stale state.
 */

function seed(db: Database): void {
  db.run(
    "INSERT INTO source VALUES ('s1','file:///x','local-file',NULL,0.0,'user',datetime('now'),NULL)"
  );
  db.run(
    "INSERT INTO observations VALUES ('obs1','s1','file:///x',datetime('now'),datetime('now'),'h','r',NULL,NULL,'text/plain','t',1,'user','i','tp-2026-04',NULL)"
  );
  db.run(
    "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence) VALUES ('f1','paris','is-in','france','obs1',0.95)"
  );
}

describe("wiki rebuild fallback (P0-6 Week 3)", () => {
  let tmpDir: string;
  let dataDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-wiki-fb-"));
    dataDir = join(tmpDir, "compost");
    mkdirSync(dataDir, { recursive: true });
    db = new Database(join(tmpDir, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
    seed(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("first rebuild success creates page with stale_at NULL", async () => {
    const llm = new MockLLMService({ mode: "happy", response: "# Paris\n\ncontent" });
    const result = await synthesizeWiki(db, llm, dataDir);
    expect(result.pages_created).toBe(1);

    const row = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(row.stale_at).toBeNull();

    const content = readFileSync(join(dataDir, "wiki", "paris.md"), "utf-8");
    expect(content).toContain("# Paris");
  });

  test("rebuild failure on existing page sets stale_at, keeps disk content", async () => {
    // 1. First successful rebuild
    const happyLlm = new MockLLMService({ mode: "happy", response: "# Paris\n\noriginal" });
    await synthesizeWiki(db, happyLlm, dataDir);

    // Verify disk content
    const beforePath = join(dataDir, "wiki", "paris.md");
    expect(readFileSync(beforePath, "utf-8")).toContain("original");

    // Add another fact so findTopicsNeedingSynthesis re-lists `paris`.
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence) VALUES ('f2','paris','capital-of','france','obs1',0.95)"
    );

    // 2. Second rebuild with open circuit breaker
    const failingInner = new MockLLMService({ mode: "error", errorMessage: "boom" });
    const breaker = new CircuitBreakerLLM(failingInner, "wiki.synthesis", {
      minFailures: 1,
      failureRate: 0,
      openMs: 60_000,
    });
    // Trip the breaker
    await breaker.generate("probe").catch(() => {});
    expect(breaker.getState()).toBe("open");

    const result = await synthesizeWiki(db, breaker, dataDir);
    expect(result.pages_created).toBe(0);
    expect(result.pages_updated).toBe(0);

    // stale_at should be set
    const row = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(row.stale_at).not.toBeNull();

    // Disk content still original
    expect(readFileSync(beforePath, "utf-8")).toContain("original");
  });

  test("successful rebuild clears stale_at", async () => {
    // Mark the page as stale manually (simulating prior breaker-open failure)
    const happyLlm1 = new MockLLMService({ mode: "happy", response: "v1" });
    await synthesizeWiki(db, happyLlm1, dataDir);
    db.run("UPDATE wiki_pages SET stale_at = datetime('now') WHERE title = 'paris'");

    // Add new fact -> topic reappears
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence) VALUES ('f2','paris','capital-of','france','obs1',0.95)"
    );

    // Successful rebuild should clear stale_at
    const happyLlm2 = new MockLLMService({ mode: "happy", response: "v2" });
    await synthesizeWiki(db, happyLlm2, dataDir);

    const row = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(row.stale_at).toBeNull();
  });

  test("failure on first-time topic with no cached page: no page created", async () => {
    const failingLlm = new MockLLMService({ mode: "error" });
    const result = await synthesizeWiki(db, failingLlm, dataDir);
    expect(result.pages_created).toBe(0);

    const row = db
      .query("SELECT COUNT(*) AS c FROM wiki_pages WHERE title = 'paris'")
      .get() as { c: number };
    expect(row.c).toBe(0);
  });

  test("CircuitOpenError is handled as regular LLM failure", async () => {
    // First, create a page so there's something to mark stale
    const happyLlm = new MockLLMService({ mode: "happy", response: "v1" });
    await synthesizeWiki(db, happyLlm, dataDir);

    // Build a breaker over a failing inner
    const failingInner = new MockLLMService({ mode: "error" });
    const breaker = new CircuitBreakerLLM(failingInner, "wiki.synthesis", {
      minFailures: 1,
      failureRate: 0,
    });
    await breaker.generate("probe").catch(() => {});
    expect(breaker.getState()).toBe("open");

    // Direct test: breaker throws CircuitOpenError on a gated call
    await expect(breaker.generate("another")).rejects.toThrow(CircuitOpenError);

    // Then rebuild — add a fact so topic reappears
    db.run(
      "INSERT INTO facts(fact_id, subject, predicate, object, observe_id, confidence) VALUES ('f2','paris','x','y','obs1',0.95)"
    );
    const result = await synthesizeWiki(db, breaker, dataDir);
    expect(result.pages_created).toBe(0);
    expect(result.pages_updated).toBe(0);

    const row = db
      .query("SELECT stale_at FROM wiki_pages WHERE title = 'paris'")
      .get() as { stale_at: string | null };
    expect(row.stale_at).not.toBeNull();
  });
});
