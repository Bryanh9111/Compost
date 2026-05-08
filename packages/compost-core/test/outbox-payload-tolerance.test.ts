import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { appendToOutbox, drainOne } from "../src/ledger/outbox";
import type { OutboxEvent } from "../src/ledger/outbox";
import { upsertPolicies } from "../src/policies/registry";
import { applyMigrations } from "../src/schema/migrator";

const AUTO_WRAPPED_REASON =
  "non-JSON payload accepted by v4 consumer-flexibility tolerance";

function makeEvent(payload: string, index: number): OutboxEvent {
  return {
    adapter: "test-adapter",
    source_id: `payload-tolerance:${index}`,
    source_kind: "local-file",
    source_uri: `file:///tmp/payload-tolerance-${index}.md`,
    idempotency_key: `payload-tolerance-${index}`,
    trust_tier: "user",
    transform_policy: "tp-2026-04",
    payload,
  };
}

function rawBytesToString(rawBytes: unknown): string {
  if (rawBytes instanceof Uint8Array) {
    return Buffer.from(rawBytes).toString("utf8");
  }
  throw new Error("expected raw_bytes to be a Uint8Array");
}

describe("outbox payload tolerance", () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "compost-outbox-payload-"));
    db = new Database(join(tmpDir, "ledger.db"));
    applyMigrations(db);
    upsertPolicies(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("valid envelope keeps metadata unchanged and does not auto-wrap", () => {
    appendToOutbox(
      db,
      makeEvent(
        JSON.stringify({ content: "x", mime: "text/markdown" }),
        1
      )
    );

    const result = drainOne(db);
    expect(result).not.toBeNull();

    const row = db
      .query(
        `SELECT mime_type, raw_bytes, metadata
         FROM observations
         WHERE observe_id = ?`
      )
      .get(result!.observe_id) as {
      mime_type: string;
      raw_bytes: Uint8Array;
      metadata: string | null;
    };

    expect(row.mime_type).toBe("text/markdown");
    expect(rawBytesToString(row.raw_bytes)).toBe("x");
    expect(row.metadata).toBeNull();
  });

  test("plain markdown string auto-wraps as text/plain with provenance metadata", () => {
    appendToOutbox(db, makeEvent("# Hello", 2));

    const result = drainOne(db);
    expect(result).not.toBeNull();

    const row = db
      .query(
        `SELECT mime_type, raw_bytes, metadata
         FROM observations
         WHERE observe_id = ?`
      )
      .get(result!.observe_id) as {
      mime_type: string;
      raw_bytes: Uint8Array;
      metadata: string;
    };
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;

    expect(row.mime_type).toBe("text/plain");
    expect(rawBytesToString(row.raw_bytes)).toBe("# Hello");
    expect(metadata["auto_wrapped"]).toBe(true);
    expect(metadata["auto_wrapped_reason"]).toBe(AUTO_WRAPPED_REASON);
  });

  test("non-envelope JSON values auto-wrap with provenance metadata", () => {
    appendToOutbox(db, makeEvent(JSON.stringify("hello"), 3));
    appendToOutbox(db, makeEvent(JSON.stringify({ random: "key" }), 4));

    const stringResult = drainOne(db);
    const objectResult = drainOne(db);
    expect(stringResult).not.toBeNull();
    expect(objectResult).not.toBeNull();

    const rows = db
      .query(
        `SELECT idempotency_key, mime_type, raw_bytes, metadata
         FROM observations
         ORDER BY adapter_sequence`
      )
      .all() as Array<{
      idempotency_key: string;
      mime_type: string;
      raw_bytes: Uint8Array;
      metadata: string;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]?.mime_type).toBe("text/plain");
    expect(rawBytesToString(rows[0]?.raw_bytes)).toBe("hello");
    expect(rows[1]?.mime_type).toBe("text/plain");
    expect(rawBytesToString(rows[1]?.raw_bytes)).toBe('{"random":"key"}');

    for (const row of rows) {
      const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      expect(metadata["auto_wrapped"]).toBe(true);
      expect(metadata["auto_wrapped_reason"]).toBe(AUTO_WRAPPED_REASON);
    }
  });

  test("empty string remains an explicit drain error", () => {
    appendToOutbox(db, makeEvent("", 5));

    const result = drainOne(db);
    expect(result).toBeNull();

    const outbox = db
      .query(
        `SELECT drain_attempts, drain_error, drained_at
         FROM observe_outbox
         WHERE seq = 1`
      )
      .get() as {
      drain_attempts: number;
      drain_error: string;
      drained_at: string | null;
    };
    const obsCount = db
      .query("SELECT count(*) AS count FROM observations")
      .get() as { count: number };

    expect(outbox.drain_attempts).toBe(1);
    expect(outbox.drain_error).toBe("empty payload");
    expect(outbox.drained_at).toBeNull();
    expect(obsCount.count).toBe(0);
  });
});
