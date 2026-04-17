import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { applyMigrations } from "../src/schema/migrator";
import { upsertPolicies } from "../src/policies/registry";
import { appendToOutbox, drainOne } from "../src/ledger/outbox";
import type { OutboxEvent } from "../src/ledger/outbox";
import { computeOriginHash } from "../src/ledger/origin";
import { backfillOriginHash } from "../src/pipeline/backfill-origin";

describe("origin_hash + method (Migration 0014)", () => {
  let db: Database;
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-origin-"));
    dataDir = join(tmpDir, "compost");
    mkdirSync(dataDir, { mode: 0o700 });
    db = new Database(join(dataDir, "ledger.db"));
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("migration adds origin_hash + method as nullable columns", () => {
    const cols = db
      .query("PRAGMA table_info(observations)")
      .all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    const byName = new Map(cols.map((c) => [c.name, c]));

    const originHash = byName.get("origin_hash");
    const method = byName.get("method");

    expect(originHash).toBeDefined();
    expect(method).toBeDefined();
    expect(originHash?.notnull).toBe(0);
    expect(method?.notnull).toBe(0);
    expect(originHash?.dflt_value).toBeNull();
    expect(method?.dflt_value).toBeNull();
  });

  test("partial index idx_obs_origin_hash exists", () => {
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_obs_origin_hash'"
      )
      .get();
    expect(idx).not.toBeNull();
  });

  test("drainOne populates origin_hash + method on new observations", () => {
    const event: OutboxEvent = {
      adapter: "local-file",
      source_id: "/tmp/test.md",
      source_kind: "local-file",
      source_uri: "file:///tmp/test.md",
      idempotency_key: "idem-abc-123",
      trust_tier: "user",
      transform_policy: "tp-2026-04-02",
      payload: JSON.stringify({
        content: "hello world",
        mime_type: "text/markdown",
        occurred_at: "2026-04-17T00:00:00Z",
      }),
    };

    appendToOutbox(db, event);
    const result = drainOne(db);
    expect(result).not.toBeNull();

    const row = db
      .query(
        "SELECT origin_hash, method FROM observations WHERE observe_id = ?"
      )
      .get(result!.observe_id) as { origin_hash: string; method: string };

    const expected = computeOriginHash(
      "local-file",
      "file:///tmp/test.md",
      "idem-abc-123"
    );
    expect(row.origin_hash).toBe(expected);
    expect(row.method).toBe("local-file");
  });

  test("origin_hash is stable across identical inlet signatures", () => {
    const h1 = computeOriginHash("web-url", "https://x.test", "key-1");
    const h2 = computeOriginHash("web-url", "https://x.test", "key-1");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  test("origin_hash differs when any inlet field changes", () => {
    const base = computeOriginHash("web-url", "https://x.test", "k");
    expect(computeOriginHash("web-url", "https://x.test", "k2")).not.toBe(base);
    expect(computeOriginHash("web-url", "https://y.test", "k")).not.toBe(base);
    expect(computeOriginHash("local-file", "https://x.test", "k")).not.toBe(
      base
    );
  });

  test("backfill fills origin_hash for pre-0014 observations", () => {
    // Simulate pre-0014 rows by inserting directly with origin_hash NULL.
    db.run(
      `INSERT INTO source (id, uri, kind, trust_tier) VALUES
       ('src-legacy', 'file:///legacy.md', 'local-file', 'user')`
    );
    db.run(
      `INSERT INTO observations (
        observe_id, source_id, source_uri, occurred_at, captured_at,
        content_hash, raw_hash, mime_type, adapter, adapter_sequence,
        trust_tier, idempotency_key, transform_policy, origin_hash, method
      ) VALUES (?, 'src-legacy', 'file:///legacy.md', ?, ?,
                'ch', 'rh', 'text/markdown', 'local-file', 1,
                'user', 'legacy-key', 'tp-2026-04-02', NULL, NULL)`,
      ["01921000-0000-7000-8000-000000000001", "2026-01-01", "2026-01-01"]
    );

    const before = db
      .query(
        "SELECT COUNT(*) AS n FROM observations WHERE origin_hash IS NULL"
      )
      .get() as { n: number };
    expect(before.n).toBe(1);

    const res = backfillOriginHash(db);
    expect(res.dryRun).toBe(false);
    expect(res.updated).toBe(1);

    const row = db
      .query(
        "SELECT origin_hash, method FROM observations WHERE observe_id = ?"
      )
      .get("01921000-0000-7000-8000-000000000001") as {
      origin_hash: string;
      method: string;
    };
    expect(row.origin_hash).toBe(
      computeOriginHash("local-file", "file:///legacy.md", "legacy-key")
    );
    expect(row.method).toBe("local-file");
  });

  test("backfill --dry-run reports pending count without writing", () => {
    db.run(
      `INSERT INTO source (id, uri, kind, trust_tier) VALUES
       ('src-dry', 'file:///dry.md', 'local-file', 'user')`
    );
    db.run(
      `INSERT INTO observations (
        observe_id, source_id, source_uri, occurred_at, captured_at,
        content_hash, raw_hash, mime_type, adapter, adapter_sequence,
        trust_tier, idempotency_key, transform_policy, origin_hash, method
      ) VALUES (?, 'src-dry', 'file:///dry.md', ?, ?,
                'ch', 'rh', 'text/markdown', 'local-file', 1,
                'user', 'dry-key', 'tp-2026-04-02', NULL, NULL)`,
      ["01921000-0000-7000-8000-000000000002", "2026-01-01", "2026-01-01"]
    );

    const res = backfillOriginHash(db, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.scanned).toBe(1);
    expect(res.updated).toBe(0);

    const still = db
      .query(
        "SELECT origin_hash FROM observations WHERE observe_id = ?"
      )
      .get("01921000-0000-7000-8000-000000000002") as {
      origin_hash: string | null;
    };
    expect(still.origin_hash).toBeNull();
  });

  test("backfill is idempotent on already-populated rows", () => {
    const event: OutboxEvent = {
      adapter: "local-file",
      source_id: "/tmp/idem.md",
      source_kind: "local-file",
      source_uri: "file:///tmp/idem.md",
      idempotency_key: "idem-key",
      trust_tier: "user",
      transform_policy: "tp-2026-04-02",
      payload: JSON.stringify({
        content: "x",
        mime_type: "text/markdown",
        occurred_at: "2026-04-17T00:00:00Z",
      }),
    };
    appendToOutbox(db, event);
    drainOne(db);

    const res1 = backfillOriginHash(db);
    const res2 = backfillOriginHash(db);
    expect(res1.updated).toBe(0);
    expect(res2.updated).toBe(0);
  });
});
