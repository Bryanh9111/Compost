import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import {
  appendToOutbox,
  drainOne,
  isWikiSelfConsumption,
} from "../src/ledger/outbox";

/**
 * P0-6 Self-Consumption guard (debate 007 Lock 5). drainOne is the universal
 * L2 entry gate; the guard quarantines outbox rows whose `source_uri` points
 * at Compost's own wiki export directory, preventing an LLM-generated page
 * from being re-ingested as raw input.
 */

describe("isWikiSelfConsumption (regex predicate)", () => {
  test("default home-based path matches", () => {
    expect(
      isWikiSelfConsumption("file:///Users/alice/.compost/wiki/paris.md")
    ).toBe(true);
    expect(
      isWikiSelfConsumption("file:///home/bob/.compost/wiki/page-1.md")
    ).toBe(true);
  });

  test("non-md files under wiki/ are NOT blocked", () => {
    expect(
      isWikiSelfConsumption("file:///Users/alice/.compost/wiki/index.html")
    ).toBe(false);
  });

  test("user's personal ~/notes/wiki/ is NOT blocked", () => {
    expect(
      isWikiSelfConsumption("file:///Users/alice/notes/wiki/recipe.md")
    ).toBe(false);
  });

  test("non-file schemes pass through", () => {
    expect(isWikiSelfConsumption("https://example.com/wiki/foo.md")).toBe(false);
    expect(isWikiSelfConsumption("http://localhost/wiki/bar.md")).toBe(false);
  });
});

describe("drainOne Self-Consumption quarantine (P0-6)", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-selfconsum-"));
    dbPath = join(tmpDir, "ledger.db");
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    applyMigrations(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("wiki-export source_uri is quarantined on first drain", () => {
    appendToOutbox(db, {
      adapter: "compost-adapter-local-file",
      source_id: "local-file:wiki-export",
      source_kind: "local-file",
      source_uri: "file:///Users/test/.compost/wiki/generated.md",
      idempotency_key: "idem-1",
      trust_tier: "user",
      transform_policy: "tp-2026-04",
      payload: JSON.stringify({ content: "fake wiki content" }),
    });

    const result = drainOne(db);
    expect(result).toBeNull(); // skipped

    const row = db
      .query(
        "SELECT drained_at, drain_quarantined_at, drain_error FROM observe_outbox"
      )
      .get() as {
      drained_at: string | null;
      drain_quarantined_at: string | null;
      drain_error: string | null;
    };
    expect(row.drained_at).toBeNull();
    expect(row.drain_quarantined_at).not.toBeNull();
    expect(row.drain_error).toMatch(/self-consumption/);
  });

  test("non-wiki file drain works normally (sanity)", () => {
    appendToOutbox(db, {
      adapter: "compost-adapter-local-file",
      source_id: "local-file:real-note",
      source_kind: "local-file",
      source_uri: "file:///Users/test/notes/random.md",
      idempotency_key: "idem-real",
      trust_tier: "user",
      transform_policy: "tp-2026-04",
      payload: JSON.stringify({ content: "real user note" }),
    });

    const result = drainOne(db);
    expect(result).not.toBeNull();
    expect(result!.observe_id).toBeDefined();

    const row = db
      .query("SELECT drain_quarantined_at FROM observe_outbox")
      .get() as { drain_quarantined_at: string | null };
    expect(row.drain_quarantined_at).toBeNull();
  });

  test("quarantined row is skipped on subsequent drains", () => {
    appendToOutbox(db, {
      adapter: "compost-adapter-local-file",
      source_id: "local-file:wiki2",
      source_kind: "local-file",
      source_uri: "file:///Users/test/.compost/wiki/paris.md",
      idempotency_key: "idem-2",
      trust_tier: "user",
      transform_policy: "tp-2026-04",
      payload: JSON.stringify({ content: "paris wiki" }),
    });
    drainOne(db); // quarantines
    expect(drainOne(db)).toBeNull(); // nothing else pending
  });
});
