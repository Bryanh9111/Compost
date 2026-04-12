/**
 * compost hook <event>
 *
 * Reads JSON from stdin, computes sha256 idempotency_key, appends to outbox.
 * Must be fast (<30ms target). No daemon required - direct DB write.
 */
import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { appendToOutbox } from "../../../compost-core/src/ledger/outbox";
import type { OutboxEvent } from "../../../compost-core/src/ledger/outbox";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

function sha256hex(s: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(s);
  return hasher.digest("hex");
}

export function registerHook(program: Command): void {
  program
    .command("hook")
    .description("Claude Code hook shim — delegates to outbox")
    .argument("<event>", "Hook event name (e.g. session-start)")
    .action(async (event: string) => {
      // Read stdin synchronously for speed
      const stdinText = await Bun.stdin.text();
      const payload = stdinText.trim() || "{}";

      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        // non-JSON stdin — treat as raw content
        parsed = { raw: stdinText };
      }

      const adapter = "claude-code";
      const sourceId = `${adapter}:${event}`;
      const content = JSON.stringify(parsed);
      const idempotencyKey = sha256hex(`${adapter}:${sourceId}:${content}`);
      const now = new Date().toISOString();

      const outboxPayload = JSON.stringify({
        content,
        mime_type: "application/json",
        occurred_at: now,
        metadata: { hook_event: event },
      });

      const outboxEvent: OutboxEvent = {
        adapter,
        source_id: sourceId,
        source_kind: "claude-code",
        source_uri: `claude-code://${event}`,
        idempotency_key: idempotencyKey,
        trust_tier: "first_party",
        transform_policy: "default",
        payload: outboxPayload,
      };

      const db = openDb();
      try {
        appendToOutbox(db, outboxEvent);
      } finally {
        db.close();
      }
      // Exit fast — no stdout (Claude Code hooks ignore output)
    });
}
