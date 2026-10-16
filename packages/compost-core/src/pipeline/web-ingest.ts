/**
 * Web URL ingest pipeline.
 * Fetches URL content, detects HTML, routes through existing ingest pipeline
 * with web-specific adapter and transform_policy.
 */
import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";
import { appendToOutbox, drainOne } from "../ledger/outbox";
import type { OutboxEvent } from "../ledger/outbox";
import { claimOne, fail } from "../queue/lease";
import { policies as policyRegistry, validatePolicyExists } from "../policies/registry";
import {
  beginDerivation,
  failDerivation,
  persistExtraction,
  type ExtractionOutput,
} from "./persist-extraction";
import { extractionTimeoutMs, runExtractor } from "./extractor";
import { embedObservationChunks } from "./embed-observation";
import type { EmbeddingService } from "../embedding/types";
import type { VectorStore } from "../storage/lancedb";

export interface WebIngestResult {
  ok: boolean;
  observe_id?: string;
  derivation_id?: string;
  status_code?: number;
  content_type?: string;
  chunks_count?: number;
  facts_count?: number;
  embedded_count?: number;
  embedding_error?: string;
  skipped_304?: boolean;
  error?: string;
}

export interface WebIngestOptions {
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
  policyId?: string;
}

function computeHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * Fetch a URL and ingest its content into the knowledge base.
 * Supports conditional requests (ETag/Last-Modified) for freshness re-checks.
 */
export async function ingestUrl(
  db: Database,
  url: string,
  _dataDir: string,
  opts: WebIngestOptions = {}
): Promise<WebIngestResult> {
  const policyId = opts.policyId ?? "tp-2026-04-02";

  try {
    validatePolicyExists(db, policyId);
  } catch {
    return { ok: false, error: `policy ${policyId} not registered` };
  }

  // Check for existing fetch state (conditional request headers)
  const fetchState = db
    .query("SELECT etag, last_modified FROM web_fetch_state WHERE source_id = ?")
    .get(url) as { etag: string | null; last_modified: string | null } | null;

  const headers: Record<string, string> = {
    "User-Agent": "compost/0.2.0 (knowledge-base; +https://github.com/Bryanh9111/Compost)",
  };
  if (fetchState?.etag) {
    headers["If-None-Match"] = fetchState.etag;
  }
  if (fetchState?.last_modified) {
    headers["If-Modified-Since"] = fetchState.last_modified;
  }

  // Fetch
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Update failure state
    updateFetchState(db, url, { error: errorMsg });
    return { ok: false, error: `fetch failed: ${errorMsg}` };
  }

  // Handle 304 Not Modified
  if (res.status === 304) {
    updateFetchState(db, url, { statusCode: 304 });
    return { ok: true, skipped_304: true, status_code: 304 };
  }

  if (!res.ok) {
    const errorMsg = `HTTP ${res.status}`;
    updateFetchState(db, url, { error: errorMsg, statusCode: res.status });
    return { ok: false, status_code: res.status, error: errorMsg };
  }

  const content = await res.text();
  const contentType = res.headers.get("content-type") ?? "text/html";
  const mimeType = contentType.split(";")[0]?.trim() ?? "text/html";

  // Update fetch state with response headers
  updateFetchState(db, url, {
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    statusCode: res.status,
  });

  // Route through existing ingest pipeline via outbox
  const idempotencyKey = computeHash(`web:${url}:${content}`);
  const now = new Date().toISOString();

  const event: OutboxEvent = {
    adapter: "web-url",
    source_id: url,
    source_kind: "web",
    source_uri: url,
    idempotency_key: idempotencyKey,
    trust_tier: "web",
    transform_policy: policyId,
    payload: JSON.stringify({
      content,
      mime_type: mimeType,
      occurred_at: now,
      metadata: {
        url,
        content_type: contentType,
        fetched_at: now,
      },
    }),
    contexts: [],
  };

  appendToOutbox(db, event);

  // Drain + process. The freshness loop runs inside the daemon, so only this
  // adapter's rows are drained and only this observation's queue row claimed.
  const drainResult = drainOne(db, "web-url");
  if (!drainResult) {
    return { ok: true, observe_id: undefined, status_code: res.status, content_type: mimeType };
  }

  const observeId = drainResult.observe_id;
  const policy = policyRegistry[policyId as keyof typeof policyRegistry];
  const maxRetries = policy?.extraction.maxRetries;
  const claimed = claimOne(db, `web-ingest:${process.pid}`, { observeId, maxRetries });
  if (!claimed) {
    return { ok: true, observe_id: observeId, status_code: res.status, content_type: mimeType };
  }

  const derivationId = uuidv7();
  let output: ExtractionOutput;
  try {
    beginDerivation(db, { derivationId, observeId, policyId });
    output = await runExtractor(
      {
        observe_id: observeId,
        source_uri: url,
        mime_type: mimeType,
        content_ref: "inline",
        content,
        transform_policy: policyId,
      },
      { timeoutMs: extractionTimeoutMs(policy?.extraction.timeoutSec ?? 0) }
    );
    persistExtraction(db, {
      observeId,
      derivationId,
      policyId,
      output,
      queue: { id: claimed.id, leaseToken: claimed.lease_token },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    failDerivation(db, derivationId, errorMsg);
    fail(db, claimed.id, claimed.lease_token, errorMsg, { maxRetries });
    return { ok: false, observe_id: observeId, derivation_id: derivationId, error: errorMsg };
  }

  const embedding = await embedObservationChunks(db, observeId, opts);
  return {
    ok: true,
    observe_id: observeId,
    derivation_id: derivationId,
    status_code: res.status,
    content_type: mimeType,
    chunks_count: output.chunks.length,
    facts_count: output.facts.length,
    embedded_count: embedding.embedded,
    ...(embedding.error ? { embedding_error: embedding.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// web_fetch_state helpers
// ---------------------------------------------------------------------------

function updateFetchState(
  db: Database,
  sourceId: string,
  update: {
    etag?: string | null;
    lastModified?: string | null;
    statusCode?: number;
    error?: string;
  }
): void {
  const now = Math.floor(Date.now() / 1000);

  // Ensure source row exists (drain auto-registers, but we may call this before drain)
  db.run(
    `INSERT OR IGNORE INTO source (id, uri, kind, trust_tier, refresh_sec)
     VALUES (?, ?, 'web', 'web', 3600)`,
    [sourceId, sourceId]
  );

  // Get refresh_sec from source table (default 3600 = 1 hour)
  const sourceRow = db
    .query("SELECT refresh_sec FROM source WHERE id = ?")
    .get(sourceId) as { refresh_sec: number | null } | null;
  const refreshSec = sourceRow?.refresh_sec ?? 3600;

  if (update.error) {
    // Increment failure counter + exponential backoff
    db.run(
      `INSERT INTO web_fetch_state (source_id, last_fetched_at_unix_sec, next_check_at_unix_sec, consecutive_failures, last_status_code, last_error)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         last_fetched_at_unix_sec = ?,
         consecutive_failures = consecutive_failures + 1,
         backoff_until_unix_sec = ? + (60 * MIN(1440, POWER(2, consecutive_failures))),
         next_check_at_unix_sec = ? + ?,
         last_status_code = ?,
         last_error = ?`,
      [sourceId, now, now + refreshSec, update.statusCode ?? 0, update.error,
       now, now, now, refreshSec, update.statusCode ?? 0, update.error]
    );
  } else {
    db.run(
      `INSERT INTO web_fetch_state (source_id, etag, last_modified, last_fetched_at_unix_sec, next_check_at_unix_sec, consecutive_failures, last_status_code)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         etag = ?,
         last_modified = ?,
         last_fetched_at_unix_sec = ?,
         next_check_at_unix_sec = ? + ?,
         consecutive_failures = 0,
         backoff_until_unix_sec = NULL,
         last_status_code = ?,
         last_error = NULL`,
      [sourceId, update.etag ?? null, update.lastModified ?? null, now, now + refreshSec, update.statusCode ?? 200,
       update.etag ?? null, update.lastModified ?? null, now, now, refreshSec, update.statusCode ?? 200]
    );
  }
}
