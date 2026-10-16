import type { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { v7 as uuidv7 } from "uuid";
import { appendToOutbox, drainOne } from "../ledger/outbox";
import type { OutboxEvent } from "../ledger/outbox";
import { claimOne, complete, fail } from "../queue/lease";
import { getActivePolicy, validatePolicyExists } from "../policies/registry";
import type { EmbeddingService } from "../embedding/types";
import type { VectorStore } from "../storage/lancedb";
import {
  beginDerivation,
  failDerivation,
  hasSucceededIngestDerivation,
  persistExtraction,
  sha256Hex,
  type ExtractionOutput,
} from "./persist-extraction";
import { extractionTimeoutMs, runExtractor } from "./extractor";
import { embedObservationChunks } from "./embed-observation";

export interface IngestResult {
  ok: boolean;
  observe_id?: string;
  derivation_id?: string;
  chunks_count?: number;
  facts_count?: number;
  embedded_count?: number;
  /** Set when facts were persisted but the embedding service failed. */
  embedding_error?: string;
  already_drained_by_concurrent_worker?: boolean;
  error?: string;
}

export interface IngestOptions {
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
}

const ADAPTER = "local-file";
/** Upper bound on older pending rows of this adapter drained before ours. */
const MAX_DRAIN_PASSES = 10_000;

function detectMimeType(filePath: string): string {
  if (filePath.endsWith(".md") || filePath.endsWith(".markdown"))
    return "text/markdown";
  if (filePath.endsWith(".txt")) return "text/plain";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".html") || filePath.endsWith(".htm"))
    return "text/html";
  return "text/plain";
}

/** observe_id of this event's outbox row once it has been drained, else null. */
function drainedObserveId(db: Database, event: OutboxEvent): string | null {
  const row = db
    .query(
      `SELECT observe_id FROM observe_outbox
       WHERE adapter = ? AND source_id = ? AND idempotency_key = ? AND drained_at IS NOT NULL`
    )
    .get(event.adapter, event.source_id, event.idempotency_key) as {
    observe_id: string | null;
  } | null;
  return row?.observe_id ?? null;
}

function getConcurrentDrainFacts(
  db: Database,
  observeId: string
): { observe_id: string; facts_count: number; derivation_id?: string } | null {
  const observation = db
    .query("SELECT observe_id FROM observations WHERE observe_id = ?")
    .get(observeId) as { observe_id: string } | null;
  if (!observation) return null;

  const facts = db
    .query(
      `SELECT COUNT(*) AS facts_count
       FROM facts
       WHERE observe_id = ? AND archived_at IS NULL`
    )
    .get(observeId) as { facts_count: number };

  const derivation = db
    .query(
      `SELECT derivation_id
       FROM derivation_run
       WHERE observe_id = ?
       ORDER BY COALESCE(finished_at, started_at) DESC
       LIMIT 1`
    )
    .get(observeId) as { derivation_id: string } | null;

  return {
    observe_id: observeId,
    facts_count: facts.facts_count,
    derivation_id: derivation?.derivation_id,
  };
}

function countRows(db: Database, table: "facts" | "chunks", observeId: string): number {
  const row = db
    .query(`SELECT COUNT(*) AS n FROM ${table} WHERE observe_id = ?`)
    .get(observeId) as { n: number };
  return row.n;
}

/**
 * Full ingest pipeline for a local file. Spec §11 DoD:
 * writes to L0 + enqueues + claims via lease SQL + runs Python extraction + records derivation_run.
 *
 * This is the embedded-mode flow used by `compost add <file>`.
 */
export async function ingestFile(
  db: Database,
  filePath: string,
  _dataDir: string,
  opts: IngestOptions = {}
): Promise<IngestResult> {
  const absPath = resolve(filePath);

  // Step 0: Read file
  if (!existsSync(absPath)) {
    return { ok: false, error: `file not found: ${absPath}` };
  }

  const content = readFileSync(absPath, "utf-8");
  const mimeType = detectMimeType(absPath);
  const policy = getActivePolicy();

  try {
    validatePolicyExists(db, policy.id);
  } catch {
    return { ok: false, error: `policy ${policy.id} not registered` };
  }

  const now = new Date().toISOString();

  // Step 1: Append to outbox
  const event: OutboxEvent = {
    adapter: ADAPTER,
    source_id: absPath,
    source_kind: "local-file",
    source_uri: `file://${absPath}`,
    idempotency_key: sha256Hex(`local-file:${absPath}:${content}`),
    trust_tier: "user",
    transform_policy: policy.id,
    payload: JSON.stringify({
      content,
      mime_type: mimeType,
      occurred_at: now,
      metadata: { filename: basename(absPath) },
    }),
    contexts: [],
  };

  appendToOutbox(db, event);

  // Step 2: Drain (observation + queue entry). A concurrent drainer (the
  // daemon) may already have taken our row; otherwise drain this adapter's
  // backlog until ours comes through, never processing someone else's row.
  const drainedByOther = drainedObserveId(db, event);
  if (drainedByOther) {
    const concurrentDrain = getConcurrentDrainFacts(db, drainedByOther);
    if (concurrentDrain && concurrentDrain.facts_count > 0) {
      return {
        ok: true,
        observe_id: concurrentDrain.observe_id,
        derivation_id: concurrentDrain.derivation_id,
        facts_count: concurrentDrain.facts_count,
        already_drained_by_concurrent_worker: true,
      };
    }
    return {
      ok: false,
      error:
        "drain returned null and no facts found — investigate concurrent drainer or schema corruption",
    };
  }

  let observeId: string | null = null;
  for (let pass = 0; pass < MAX_DRAIN_PASSES && observeId === null; pass++) {
    if (!drainOne(db, ADAPTER)) break;
    observeId = drainedObserveId(db, event);
  }
  if (observeId === null) {
    return { ok: false, error: "outbox row was not drained (quarantined or still pending)" };
  }

  // Step 3: Claim this observation's queue row
  const maxRetries = policy.extraction.maxRetries;
  const claimed = claimOne(db, `add-cli:${process.pid}`, { observeId, maxRetries });
  if (!claimed) {
    // Another worker holds or finished it
    return {
      ok: true,
      observe_id: observeId,
      derivation_id: undefined,
      chunks_count: 0,
      facts_count: 0,
    };
  }

  if (hasSucceededIngestDerivation(db, observeId, policy.id)) {
    complete(db, claimed.id, claimed.lease_token);
    const existing = getConcurrentDrainFacts(db, observeId);
    return {
      ok: true,
      observe_id: observeId,
      derivation_id: existing?.derivation_id,
      chunks_count: countRows(db, "chunks", observeId),
      facts_count: existing?.facts_count ?? 0,
      already_drained_by_concurrent_worker: true,
    };
  }

  // Step 4-5: Extract, then persist facts + chunks + derivation + completion atomically
  const derivationId = uuidv7();
  let output: ExtractionOutput;
  try {
    beginDerivation(db, { derivationId, observeId, policyId: policy.id });
    output = await runExtractor(
      {
        observe_id: observeId,
        source_uri: `file://${absPath}`,
        mime_type: mimeType,
        content_ref: "inline",
        content,
        transform_policy: policy.id,
      },
      { timeoutMs: extractionTimeoutMs(policy.extraction.timeoutSec) }
    );
    persistExtraction(db, {
      observeId,
      derivationId,
      policyId: policy.id,
      output,
      queue: { id: claimed.id, leaseToken: claimed.lease_token },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    failDerivation(db, derivationId, errorMsg);
    fail(db, claimed.id, claimed.lease_token, errorMsg, { maxRetries });
    return {
      ok: false,
      observe_id: observeId,
      derivation_id: derivationId,
      error: errorMsg,
    };
  }

  // Step 6: Embed (if services available); facts are already searchable
  const embedding = await embedObservationChunks(db, observeId, opts);

  return {
    ok: true,
    observe_id: observeId,
    derivation_id: derivationId,
    chunks_count: output.chunks.length,
    facts_count: output.facts.length,
    embedded_count: embedding.embedded,
    ...(embedding.error ? { embedding_error: embedding.error } : {}),
  };
}
