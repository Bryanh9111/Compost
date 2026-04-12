/**
 * Web URL ingest pipeline.
 * Fetches URL content, detects HTML, routes through existing ingest pipeline
 * with web-specific adapter and transform_policy.
 */
import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";
import { appendToOutbox, drainOne } from "../ledger/outbox";
import type { OutboxEvent } from "../ledger/outbox";
import { claimOne, complete, fail } from "../queue/lease";
import { validatePolicyExists } from "../policies/registry";
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
  dataDir: string,
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
  const mimeType = contentType.split(";")[0].trim();

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

  // Drain + process
  const drainResult = drainOne(db);
  if (!drainResult) {
    return { ok: true, observe_id: undefined, status_code: res.status, content_type: mimeType };
  }

  const observeId = drainResult.observe_id;
  const workerId = `web-ingest:${process.pid}`;
  const claimed = claimOne(db, workerId);
  if (!claimed) {
    return { ok: true, observe_id: observeId, status_code: res.status, content_type: mimeType };
  }

  // Run Python extraction
  const derivationId = uuidv7();
  db.run(
    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
     VALUES (?, ?, 'L2', ?, 'running')`,
    [derivationId, observeId, policyId]
  );

  try {
    const { resolve, existsSync } = await import("fs");
    const { join } = await import("path");

    const ingestPkgDir = join(import.meta.dir, "../../..", "compost-ingest");
    const venvPython = join(ingestPkgDir, ".venv/bin/python");

    let cmd: string[];
    if (existsSync(venvPython)) {
      cmd = [venvPython, "-m", "compost_ingest", "extract"];
    } else {
      cmd = ["uv", "run", "--project", ingestPkgDir, "python", "-m", "compost_ingest", "extract"];
    }

    const extractionInput = JSON.stringify({
      observe_id: observeId,
      source_uri: url,
      mime_type: mimeType,
      content_ref: "inline",
      content,
      transform_policy: policyId,
    });

    const proc = Bun.spawn(cmd, {
      stdin: new Blob([extractionInput]),
      stdout: "pipe",
      stderr: "pipe",
      cwd: ingestPkgDir,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      throw new Error(`extraction failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }

    const output = JSON.parse(stdout);

    // Write facts + chunks (reuse ingest logic pattern)
    const insertFact = db.prepare(
      `INSERT OR IGNORE INTO facts (fact_id, subject, predicate, object, confidence, importance, observe_id, last_reinforced_at_unix_sec, half_life_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertChunk = db.prepare(
      `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const nowUnixSec = Math.floor(Date.now() / 1000);

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const fact of output.facts) {
        insertFact.run(uuidv7(), fact.subject, fact.predicate, fact.object,
          fact.confidence ?? 0.8, fact.importance ?? 0.5, observeId, nowUnixSec, 2592000);
      }
      for (let i = 0; i < output.chunks.length; i++) {
        const chunk = output.chunks[i];
        insertChunk.run(chunk.chunk_id, observeId, derivationId, i, chunk.text,
          computeHash(chunk.text), 0, chunk.text.length, policyId);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    // Embeddings
    let embeddedCount = 0;
    if (opts.embeddingService && opts.vectorStore && output.chunks.length > 0) {
      const vectors = await opts.embeddingService.embed(output.chunks.map((c: { text: string }) => c.text));
      const factRows = db.query("SELECT fact_id FROM facts WHERE observe_id = ? ORDER BY created_at").all(observeId) as { fact_id: string }[];

      const chunkToFactId = new Map<string, string>();
      for (let fi = 0; fi < output.facts.length; fi++) {
        const fact = output.facts[fi];
        const factId = factRows[fi]?.fact_id;
        if (factId && fact.source_chunk_ids) {
          for (const cid of fact.source_chunk_ids) {
            if (!chunkToFactId.has(cid)) chunkToFactId.set(cid, factId);
          }
        }
      }

      const chunkVectors = output.chunks.map((chunk: { chunk_id: string }, i: number) => ({
        chunk_id: chunk.chunk_id,
        fact_id: chunkToFactId.get(chunk.chunk_id) ?? (factRows[0]?.fact_id ?? `orphan:${observeId}:${i}`),
        observe_id: observeId,
        vector: vectors[i],
      }));

      await opts.vectorStore.add(chunkVectors);
      const updateEmbedded = db.prepare("UPDATE chunks SET embedded_at = datetime('now') WHERE chunk_id = ?");
      for (const cv of chunkVectors) updateEmbedded.run(cv.chunk_id);
      embeddedCount = chunkVectors.length;
    }

    db.run(
      `UPDATE derivation_run SET status = 'succeeded', finished_at = datetime('now'), artifact_ref = ? WHERE derivation_id = ?`,
      [JSON.stringify({ chunks: output.chunks.length, facts: output.facts.length, embedded: embeddedCount }), derivationId]
    );
    complete(db, claimed.id, claimed.lease_token);

    return {
      ok: true, observe_id: observeId, derivation_id: derivationId,
      status_code: res.status, content_type: mimeType,
      chunks_count: output.chunks.length, facts_count: output.facts.length, embedded_count: embeddedCount,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    db.run(`UPDATE derivation_run SET status = 'failed', finished_at = datetime('now'), error = ? WHERE derivation_id = ?`, [errorMsg, derivationId]);
    fail(db, claimed.id, claimed.lease_token, errorMsg);
    return { ok: false, observe_id: observeId, derivation_id: derivationId, error: errorMsg };
  }
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
