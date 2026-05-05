import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";
import { computeOriginHash } from "./origin";
import { processObservationAction } from "../metacognitive/action-processor";
import { getActivePolicy } from "../policies/registry";

/**
 * OutboxEvent — what writers (hook shim, adapters) pass to appendToOutbox.
 * Maps 1:1 to observe_outbox columns. Spec §1.6.1.
 */
export interface OutboxEvent {
  adapter: string;
  source_id: string;
  source_kind:
    | "local-file"
    | "local-dir"
    | "web"
    | "claude-code"
    | "host-adapter"
    | "sensory";
  source_uri: string;
  idempotency_key: string;
  trust_tier: "user" | "first_party" | "web";
  transform_policy: string;
  payload: string; // JSON string
  contexts?: string[];
}

export interface DrainResult {
  seq: number;
  observe_id: string;
}

const QUARANTINE_THRESHOLD = 5;

/**
 * Synchronous append to observe_outbox. Spec §1.6.1 hook write path.
 * INSERT OR IGNORE for idempotency (idx_outbox_idempotency UNIQUE).
 */
export function appendToOutbox(db: Database, event: OutboxEvent): void {
  const payloadWithContexts = mergeContextsIntoPayload(
    event.payload,
    event.contexts
  );
  const transformPolicy = resolveOutboxTransformPolicy(
    db,
    event.transform_policy
  );
  const payload = transformPolicy.wasFallback
    ? annotateTransformPolicyFallback(
        payloadWithContexts,
        event.transform_policy,
        transformPolicy.policyId
      )
    : payloadWithContexts;

  db.run(
    `INSERT OR IGNORE INTO observe_outbox (
      adapter, source_id, source_kind, source_uri, idempotency_key,
      trust_tier, transform_policy, payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.adapter,
      event.source_id,
      event.source_kind,
      event.source_uri,
      event.idempotency_key,
      event.trust_tier,
      transformPolicy.policyId,
      payload,
    ]
  );
}

function resolveOutboxTransformPolicy(
  db: Database,
  requestedPolicyId: string
): { policyId: string; wasFallback: boolean } {
  const row = db
    .query("SELECT 1 FROM policies WHERE policy_id = ?")
    .get(requestedPolicyId);
  if (row) return { policyId: requestedPolicyId, wasFallback: false };

  return { policyId: getActivePolicy().id, wasFallback: true };
}

function annotateTransformPolicyFallback(
  payload: string,
  requestedPolicyId: string,
  appliedPolicyId: string
): string {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const metadata =
      parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
        ? (parsed.metadata as Record<string, unknown>)
        : {};

    return JSON.stringify({
      ...parsed,
      metadata: {
        ...metadata,
        compost_policy_fallback: {
          requested_transform_policy: requestedPolicyId,
          applied_transform_policy: appliedPolicyId,
          reason: "unregistered transform_policy",
        },
      },
    });
  } catch {
    return payload;
  }
}

interface OutboxRow {
  seq: number;
  adapter: string;
  source_id: string;
  source_kind: string;
  source_uri: string;
  idempotency_key: string;
  trust_tier: string;
  transform_policy: string;
  payload: string;
  appended_at: string;
}

interface DraftObservationPayload {
  content: string;
  mime_type: string;
  occurred_at: string;
  metadata?: unknown;
  contexts?: unknown;
  [key: string]: unknown;
}

const AUTO_WRAPPED_METADATA = {
  auto_wrapped: true,
  auto_wrapped_reason:
    "non-JSON payload accepted by v4 consumer-flexibility tolerance",
};

/**
 * Drain one outbox row. Implements spec §1.6.2 canonical single-DB transaction.
 *
 * Steps:
 * 1. Claim next drainable row (skips quarantined via partial index)
 * 2. Auto-register source if missing
 * 3. Auto-link source_context
 * 4. INSERT OR IGNORE observation
 * 5. Resolve canonical observe_id
 * 6. Enqueue for derivation pipeline
 * 7. Mark outbox row drained
 *
 * Returns null if no drainable rows exist.
 */
export function drainOne(db: Database): DrainResult | null {
  // STEP 1: Claim next drainable row
  const pending = db
    .query(
      `SELECT seq, adapter, source_id, source_kind, source_uri, idempotency_key,
              trust_tier, transform_policy, payload, appended_at
       FROM observe_outbox
       WHERE drained_at IS NULL AND drain_quarantined_at IS NULL
       ORDER BY seq
       LIMIT 1`
    )
    .get() as OutboxRow | null;

  if (!pending) return null;

  // P0-6 Self-Consumption guard (debate 007 Lock 5): quarantine immediately
  // when the source URI points at Compost's own wiki export (= an LLM-generated
  // page being offered back as raw input). drainOne is the universal L2 entry
  // gate, so guarding here covers every adapter without per-pipeline changes.
  if (isWikiSelfConsumption(pending.source_uri)) {
    quarantineImmediately(
      db,
      pending.seq,
      "self-consumption: refusing to re-ingest compost wiki export"
    );
    return null;
  }

  let parsedPayload: DraftObservationPayload;
  try {
    parsedPayload = draftObservationFromPending(pending);
  } catch (e) {
    recordDrainFailure(
      db,
      pending.seq,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }

  try {
    const observeId = uuidv7();
    const contentHash = computeHash(parsedPayload.content);
    const rawHash = computeHash(pending.payload);
    const now = new Date().toISOString().replace("T", " ").replace("Z", "");

    let contexts: string[] = [];
    if (Array.isArray(parsedPayload.contexts)) {
      contexts = parsedPayload.contexts.filter(
        (context): context is string => typeof context === "string"
      );
    }

    const tx = db.transaction(() => {
      // STEP 2: Auto-register source if missing
      db.run(
        `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
         VALUES (?, ?, ?, ?, NULL)`,
        [
          pending.source_id,
          pending.source_uri,
          pending.source_kind,
          pending.trust_tier,
        ]
      );

      // STEP 3: Auto-link source_context
      for (const contextId of contexts) {
        db.run(
          `INSERT OR IGNORE INTO source_context (source_id, context_id)
           VALUES (?, ?)`,
          [pending.source_id, contextId]
        );
      }

      // STEP 4: INSERT the observation.
      // origin_hash + method (Migration 0014) capture the inlet-provenance
      // signature distinct from content_hash/raw_hash. method mirrors adapter
      // so the ingest-method taxonomy can diverge later without schema churn.
      const originHash = computeOriginHash(
        pending.adapter,
        pending.source_uri,
        pending.idempotency_key
      );
      db.run(
        `INSERT OR IGNORE INTO observations (
          observe_id, source_id, source_uri, occurred_at, captured_at,
          content_hash, raw_hash, raw_bytes, blob_ref, mime_type,
          adapter, adapter_sequence, trust_tier, idempotency_key,
          transform_policy, metadata, origin_hash, method
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          observeId,
          pending.source_id,
          pending.source_uri,
          parsedPayload.occurred_at,
          now,
          contentHash,
          rawHash,
          parsedPayload.content
            ? Buffer.from(parsedPayload.content)
            : null,
          null,
          parsedPayload.mime_type,
          pending.adapter,
          pending.seq,
          pending.trust_tier,
          pending.idempotency_key,
          pending.transform_policy,
          parsedPayload.metadata
            ? JSON.stringify(parsedPayload.metadata)
            : null,
          originHash,
          pending.adapter,
        ]
      );

      // STEP 5: Resolve canonical observe_id
      const resolved = db
        .query(
          `SELECT observe_id FROM observations
           WHERE adapter = ? AND source_id = ? AND idempotency_key = ?`
        )
        .get(
          pending.adapter,
          pending.source_id,
          pending.idempotency_key
        ) as { observe_id: string };

      const canonicalId = resolved.observe_id;

      // STEP 6: Enqueue for derivation pipeline
      db.run(
        `INSERT INTO ingest_queue (observe_id, source_kind, priority)
         SELECT ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM ingest_queue
           WHERE observe_id = ? AND completed_at IS NULL
         )`,
        [canonicalId, pending.source_kind, 1, canonicalId]
      );

      // STEP 7: Mark outbox row drained
      db.run(
        `UPDATE observe_outbox
         SET drained_at = datetime('now'), observe_id = ?, drain_error = NULL
         WHERE seq = ?`,
        [canonicalId, pending.seq]
      );

      // STEP 8: Best-effort v4 metacognitive lift. This writes the normalized
      // action surface for coverage/pattern queries without blocking the
      // durable observation path if an adapter payload is unusual.
      processObservationAction(db, canonicalId);

      return canonicalId;
    });

    const finalObserveId = tx();
    return { seq: pending.seq, observe_id: finalObserveId };
  } catch (e) {
    recordDrainFailure(
      db,
      pending.seq,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

function draftObservationFromPending(
  pending: OutboxRow
): DraftObservationPayload {
  if (pending.payload.length === 0) {
    throw new Error("empty payload");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(pending.payload);
  } catch {
    return autoWrappedPayload(pending.payload, pending.appended_at);
  }

  if (!isRecord(parsed) || !hasOwnContent(parsed)) {
    return autoWrappedPayload(
      typeof parsed === "string" ? parsed : pending.payload,
      pending.appended_at,
      isRecord(parsed) ? parsed : undefined
    );
  }

  const content = parsed["content"];
  if (typeof content !== "string") {
    return autoWrappedPayload(pending.payload, pending.appended_at, parsed);
  }

  const hasMetadata = Object.prototype.hasOwnProperty.call(parsed, "metadata");
  const mimeType =
    typeof parsed["mime_type"] === "string"
      ? parsed["mime_type"]
      : typeof parsed["mime"] === "string"
        ? parsed["mime"]
        : "application/json";
  const occurredAt =
    typeof parsed["occurred_at"] === "string"
      ? parsed["occurred_at"]
      : pending.appended_at;

  return {
    ...parsed,
    content,
    mime_type: mimeType,
    occurred_at: occurredAt,
    ...(hasMetadata ? { metadata: parsed["metadata"] } : {}),
  };
}

function autoWrappedPayload(
  content: string,
  occurredAt: string,
  parsedObject?: Record<string, unknown>
): DraftObservationPayload {
  const metadata = {
    ...(isRecord(parsedObject?.["metadata"]) ? parsedObject["metadata"] : {}),
    ...AUTO_WRAPPED_METADATA,
  };

  return {
    content,
    mime_type: "text/plain",
    occurred_at: occurredAt,
    metadata,
    ...(parsedObject && Array.isArray(parsedObject["contexts"])
      ? { contexts: parsedObject["contexts"] }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnContent(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, "content");
}

/**
 * Record drain failure outside the main transaction.
 * Spec §1.6.2 failure handling: increment drain_attempts,
 * quarantine when threshold exceeded.
 */
function recordDrainFailure(
  db: Database,
  seq: number,
  error: string
): void {
  db.run(
    `UPDATE observe_outbox
     SET drain_attempts = drain_attempts + 1,
         drain_error = ?,
         drain_quarantined_at = CASE
           WHEN drain_attempts + 1 > ? THEN datetime('now')
           ELSE drain_quarantined_at
         END
     WHERE seq = ?`,
    [error, QUARANTINE_THRESHOLD, seq]
  );
}

/**
 * Quarantine an outbox row on the FIRST drain attempt, bypassing the
 * QUARANTINE_THRESHOLD retry count. Used for deterministic-reject cases like
 * the Self-Consumption guard where no retry can change the outcome.
 */
function quarantineImmediately(
  db: Database,
  seq: number,
  error: string
): void {
  db.run(
    `UPDATE observe_outbox
     SET drain_attempts = drain_attempts + 1,
         drain_error = ?,
         drain_quarantined_at = datetime('now')
     WHERE seq = ?`,
    [error, seq]
  );
}

/**
 * Self-Consumption check (debate 007 Lock 5): reject URIs pointing at the
 * Compost wiki export directory. The match is deliberately narrow -- a user's
 * personal `~/notes/wiki/foo.md` is NOT blocked; only paths under
 * `<data-dir>/wiki/` (current home-based default `~/.compost/wiki/` and
 * the test-override `$COMPOST_DATA_DIR/wiki/`) match.
 *
 * Exported for unit tests so the regex lives in one place.
 */
export function isWikiSelfConsumption(sourceUri: string): boolean {
  if (!sourceUri.startsWith("file://")) return false;
  const path = sourceUri.slice("file://".length);
  // Home-based default: ~/.compost/wiki/*.md
  if (/\/\.compost\/wiki\/[^/]+\.md$/.test(path)) return true;
  // Test/custom data dir: $COMPOST_DATA_DIR ends in something, wiki child
  const overrideDir = process.env["COMPOST_DATA_DIR"];
  if (overrideDir) {
    const prefix = overrideDir.endsWith("/") ? overrideDir : `${overrideDir}/`;
    if (path.startsWith(`${prefix}wiki/`) && /\.md$/.test(path)) return true;
  }
  return false;
}

/**
 * Merge contexts array into payload JSON. The outbox table stores
 * a single payload column that is the complete ObserveEvent envelope
 * including contexts (spec §1.6: "JSON ObserveEvent envelope").
 */
function mergeContextsIntoPayload(
  payload: string,
  contexts?: string[]
): string {
  if (!contexts || contexts.length === 0) return payload;
  try {
    const obj = JSON.parse(payload);
    obj.contexts = contexts;
    return JSON.stringify(obj);
  } catch {
    return payload;
  }
}

function computeHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}
