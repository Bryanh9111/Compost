/**
 * compost-hook-shim — fast cold-start hook handler for Claude Code integration.
 *
 * Spec §3b.3: loads only SQLite, no TypeScript bootstrap, no workspace resolution.
 * Target: ≤ 20ms cold (8ms lib + 5ms SQLite append + 7ms overhead).
 *
 * Invoked by Claude Code hooks as: bun packages/compost-hook-shim/src/index.ts <event>
 * Reads JSON envelope from stdin, appends to observe_outbox, exits 0.
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

const ADAPTER_NAME = "compost-adapter-claude-code";

interface HookEnvelope {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function computeIdempotencyKey(
  adapter: string,
  sourceId: string,
  content: string
): string {
  return createHash("sha256")
    .update(adapter + sourceId + content)
    .digest("hex");
}

async function main(): Promise<void> {
  const eventName = process.argv[2];
  if (!eventName) {
    process.exit(2);
  }

  // Read stdin
  let input = "";
  for await (const chunk of Bun.stdin.stream()) {
    input += new TextDecoder().decode(chunk);
  }

  if (!input.trim()) {
    // Empty stdin is valid for measurement-warmup events
    if (eventName === "measurement-warmup") {
      process.exit(0);
    }
    process.stderr.write("compost hook: empty stdin\n");
    process.exit(2);
  }

  let envelope: HookEnvelope;
  try {
    envelope = JSON.parse(input);
  } catch {
    process.stderr.write("compost hook: invalid JSON on stdin\n");
    process.exit(2);
  }

  const dataDir = process.env.COMPOST_DATA_DIR || join(homedir(), ".compost");
  const dbPath = join(dataDir, "ledger.db");

  const sourceId = `claude-code:${envelope.session_id}:${envelope.cwd}`;
  const sourceUri = `claude-code://${envelope.cwd}`;
  const idempotencyKey = computeIdempotencyKey(
    ADAPTER_NAME,
    sourceId,
    JSON.stringify(envelope.payload)
  );

  // Get active policy from policies table, fallback to tp-2026-04
  let transformPolicy = "tp-2026-04";

  const db = new Database(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 500");

    // Try to read active policy
    const policyRow = db
      .query(
        "SELECT policy_id FROM policies ORDER BY effective_from DESC LIMIT 1"
      )
      .get() as { policy_id: string } | null;
    if (policyRow) {
      transformPolicy = policyRow.policy_id;
    }

    // INSERT OR IGNORE into observe_outbox (spec §1.6.1)
    db.run(
      `INSERT OR IGNORE INTO observe_outbox (
        adapter, source_id, source_kind, source_uri, idempotency_key,
        trust_tier, transform_policy, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ADAPTER_NAME,
        sourceId,
        "claude-code",
        sourceUri,
        idempotencyKey,
        "first_party",
        transformPolicy,
        input, // store the full envelope as payload
      ]
    );
  } finally {
    db.close();
  }

  // Exit 0 — success (spec §3b.2: exit 0 = no objection)
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`compost hook: ${err}\n`);
  process.exit(2);
});
