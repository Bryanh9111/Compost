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

export interface IngestResult {
  ok: boolean;
  observe_id?: string;
  derivation_id?: string;
  chunks_count?: number;
  facts_count?: number;
  embedded_count?: number;
  error?: string;
}

export interface IngestOptions {
  embeddingService?: EmbeddingService;
  vectorStore?: VectorStore;
}

interface ExtractionOutput {
  observe_id: string;
  extractor_version: string;
  transform_policy: string;
  chunks: Array<{ chunk_id: string; text: string; metadata?: { char_start?: number; char_end?: number; [k: string]: unknown } }>;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    importance?: number;
    source_chunk_ids?: string[];
  }>;
  normalized_content: string;
  content_hash_raw: string;
  content_hash_normalized: string;
  warnings: string[];
}

function computeHash(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

function detectMimeType(filePath: string): string {
  if (filePath.endsWith(".md") || filePath.endsWith(".markdown"))
    return "text/markdown";
  if (filePath.endsWith(".txt")) return "text/plain";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".html") || filePath.endsWith(".htm"))
    return "text/html";
  return "text/plain";
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
  dataDir: string,
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

  const sourceId = absPath;
  const idempotencyKey = computeHash(`local-file:${absPath}:${content}`);
  const now = new Date().toISOString();

  // Step 1: Append to outbox
  const event: OutboxEvent = {
    adapter: "local-file",
    source_id: sourceId,
    source_kind: "local-file",
    source_uri: `file://${absPath}`,
    idempotency_key: idempotencyKey,
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

  // Step 2: Drain (observation + queue entry)
  const drainResult = drainOne(db);
  if (!drainResult) {
    return { ok: false, error: "drain returned null (possibly already drained)" };
  }

  const observeId = drainResult.observe_id;

  // Step 3: Claim from queue
  const workerId = `add-cli:${process.pid}`;
  const claimed = claimOne(db, workerId);
  if (!claimed) {
    // Already processed or no queue entry
    return {
      ok: true,
      observe_id: observeId,
      derivation_id: undefined,
      chunks_count: 0,
      facts_count: 0,
    };
  }

  // Step 4: Run Python extraction subprocess
  const derivationId = uuidv7();

  // Record derivation_run as running
  db.run(
    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
     VALUES (?, ?, 'L2', ?, 'running')`,
    [derivationId, observeId, policy.id]
  );

  try {
    const extractionInput = JSON.stringify({
      observe_id: observeId,
      source_uri: `file://${absPath}`,
      mime_type: mimeType,
      content_ref: "inline",
      content,
      transform_policy: policy.id,
    });

    // Find the compost-ingest package directory relative to this module
    const ingestPkgDir = resolve(import.meta.dir, "../../..", "compost-ingest");
    const venvPython = resolve(ingestPkgDir, ".venv/bin/python");

    // Prefer venv python, then uv run, then system python3
    let cmd: string[];
    if (existsSync(venvPython)) {
      cmd = [venvPython, "-m", "compost_ingest", "extract"];
    } else {
      cmd = ["uv", "run", "--project", ingestPkgDir, "python", "-m", "compost_ingest", "extract"];
    }

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
      throw new Error(
        `extraction failed (exit ${exitCode}): ${stderr.slice(0, 500)}`
      );
    }

    let output: ExtractionOutput;
    try {
      output = JSON.parse(stdout);
    } catch {
      throw new Error(
        `extraction output is not valid JSON: ${stdout.slice(0, 200)}`
      );
    }

    // Step 5: Write facts to SQLite (L2) + chunks to chunks table
    const insertFact = db.prepare(
      `INSERT OR IGNORE INTO facts (fact_id, subject, predicate, object, confidence, importance, observe_id, last_reinforced_at_unix_sec, half_life_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertChunk = db.prepare(
      `INSERT OR IGNORE INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const nowUnixSec = Math.floor(Date.now() / 1000);
    const defaultHalfLife = 2592000; // 30 days (from spec §2 tp-2026-04)

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const fact of output.facts) {
        const factId = uuidv7();
        insertFact.run(
          factId,
          fact.subject,
          fact.predicate,
          fact.object,
          fact.confidence ?? 0.8,
          fact.importance ?? 0.5,
          observeId,
          nowUnixSec,
          defaultHalfLife
        );
      }

      for (let i = 0; i < output.chunks.length; i++) {
        const chunk = output.chunks[i];
        const chunkHash = computeHash(chunk.text);
        insertChunk.run(
          chunk.chunk_id,
          observeId,
          derivationId,
          i,
          chunk.text,
          chunkHash,
          chunk.metadata?.char_start ?? 0,
          chunk.metadata?.char_end ?? chunk.text.length,
          policy.id
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    // Step 6: Generate embeddings + write to LanceDB (if services available)
    let embeddedCount = 0;
    if (opts.embeddingService && opts.vectorStore && output.chunks.length > 0) {
      const chunkTexts = output.chunks.map((c) => c.text);
      const vectors = await opts.embeddingService.embed(chunkTexts);

      // Build chunk_id → fact_id mapping from extractor output
      // Each fact has source_chunk_ids linking it to the chunks it was extracted from
      const chunkToFactId = new Map<string, string>();
      const factRows = db
        .query("SELECT fact_id FROM facts WHERE observe_id = ? ORDER BY created_at")
        .all(observeId) as { fact_id: string }[];

      for (let fi = 0; fi < output.facts.length; fi++) {
        const fact = output.facts[fi];
        const factId = factRows[fi]?.fact_id;
        if (factId && fact.source_chunk_ids) {
          for (const cid of fact.source_chunk_ids) {
            // First fact wins if multiple facts claim the same chunk
            if (!chunkToFactId.has(cid)) {
              chunkToFactId.set(cid, factId);
            }
          }
        }
      }

      const chunkVectors = output.chunks.map((chunk, i) => ({
        chunk_id: chunk.chunk_id,
        fact_id: chunkToFactId.get(chunk.chunk_id)
          ?? (factRows.length > 0 ? factRows[0].fact_id : `orphan:${observeId}:${i}`),
        observe_id: observeId,
        vector: vectors[i],
      }));

      await opts.vectorStore.add(chunkVectors);

      // Update chunks.embedded_at
      const updateEmbedded = db.prepare(
        "UPDATE chunks SET embedded_at = datetime('now') WHERE chunk_id = ?"
      );
      for (const cv of chunkVectors) {
        updateEmbedded.run(cv.chunk_id);
      }
      embeddedCount = chunkVectors.length;
    }

    // Step 7: Mark derivation as succeeded
    db.run(
      `UPDATE derivation_run
       SET status = 'succeeded', finished_at = datetime('now'),
           artifact_ref = ?
       WHERE derivation_id = ?`,
      [
        JSON.stringify({
          chunks: output.chunks.length,
          facts: output.facts.length,
          embedded: embeddedCount,
        }),
        derivationId,
      ]
    );

    // Step 8: Complete queue item
    complete(db, claimed.id, claimed.lease_token);

    return {
      ok: true,
      observe_id: observeId,
      derivation_id: derivationId,
      chunks_count: output.chunks.length,
      facts_count: output.facts.length,
      embedded_count: embeddedCount,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Mark derivation as failed
    db.run(
      `UPDATE derivation_run
       SET status = 'failed', finished_at = datetime('now'), error = ?
       WHERE derivation_id = ?`,
      [errorMsg, derivationId]
    );

    // Release queue lease
    fail(db, claimed.id, claimed.lease_token, errorMsg);

    return {
      ok: false,
      observe_id: observeId,
      derivation_id: derivationId,
      error: errorMsg,
    };
  }
}
