import type { Database } from "bun:sqlite";
import { v7 as uuidv7 } from "uuid";

/** JSON contract of `python -m compost_ingest extract` (schema.py). */
export interface ExtractionChunk {
  chunk_id: string;
  text: string;
  metadata?: { char_start?: number; char_end?: number; [k: string]: unknown };
}

export interface ExtractionFact {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  importance?: number;
  source_chunk_ids?: string[];
}

export interface ExtractionOutput {
  observe_id: string;
  extractor_version: string;
  transform_policy: string;
  chunks: ExtractionChunk[];
  facts: ExtractionFact[];
  normalized_content: string;
  content_hash_raw: string;
  content_hash_normalized: string;
  warnings?: string[];
}

export interface PersistExtractionInput {
  observeId: string;
  derivationId: string;
  policyId: string;
  output: ExtractionOutput;
  /** The claimed ingest_queue row; completion is lease-guarded. */
  queue: { id: number; leaseToken: string };
}

export interface PersistExtractionResult {
  factIds: string[];
  chunkIds: string[];
}

const DEFAULT_HALF_LIFE_SEC = 2_592_000; // 30 days (spec §2 tp-2026-04)

export function sha256Hex(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * Extractors emit document-local chunk ids (c0, c1, ...). chunks.chunk_id is
 * a global primary key, so every id is namespaced by its observation before
 * it reaches the ledger or LanceDB. Idempotent for ids already namespaced.
 */
export function namespaceExtractionOutput(
  output: ExtractionOutput,
  observeId: string
): ExtractionOutput {
  const prefix = `${observeId}:`;
  const scoped = (id: string) => (id.startsWith(prefix) ? id : prefix + id);
  return {
    ...output,
    chunks: output.chunks.map((chunk) => ({ ...chunk, chunk_id: scoped(chunk.chunk_id) })),
    facts: output.facts.map((fact) => ({
      ...fact,
      source_chunk_ids: fact.source_chunk_ids?.map(scoped),
    })),
  };
}

/**
 * Persist one extraction in a single BEGIN IMMEDIATE transaction: facts,
 * chunks (with their fact mapping, not yet embedded), the derivation's
 * `running -> succeeded` transition and the lease-guarded queue completion.
 * Any mismatch (derivation superseded, lease stolen) rolls everything back
 * and throws, so a retry never finds half-written rows.
 *
 * Embedding is a separate, idempotent step (see embed-pending.ts); facts are
 * searchable through BM25 as soon as this commits.
 */
export function persistExtraction(
  db: Database,
  input: PersistExtractionInput
): PersistExtractionResult {
  const { observeId, derivationId, policyId } = input;
  const output = namespaceExtractionOutput(input.output, observeId);

  const insertFact = db.prepare(
    `INSERT INTO facts (fact_id, subject, predicate, object, confidence, importance, observe_id, last_reinforced_at_unix_sec, half_life_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertChunk = db.prepare(
    `INSERT INTO chunks (chunk_id, observe_id, derivation_id, chunk_index, text_content, content_hash, char_start, char_end, transform_policy, fact_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const nowUnixSec = Math.floor(Date.now() / 1000);

  db.exec("BEGIN IMMEDIATE");
  try {
    const factIds: string[] = [];
    const chunkToFact = new Map<string, string>();
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
        DEFAULT_HALF_LIFE_SEC
      );
      factIds.push(factId);
      for (const chunkId of fact.source_chunk_ids ?? []) {
        // First fact wins when several facts cite the same chunk.
        if (!chunkToFact.has(chunkId)) chunkToFact.set(chunkId, factId);
      }
    }

    const fallbackFact = factIds[0] ?? null;
    const chunkIds: string[] = [];
    output.chunks.forEach((chunk, index) => {
      insertChunk.run(
        chunk.chunk_id,
        observeId,
        derivationId,
        index,
        chunk.text,
        sha256Hex(chunk.text),
        chunk.metadata?.char_start ?? 0,
        chunk.metadata?.char_end ?? chunk.text.length,
        policyId,
        chunkToFact.get(chunk.chunk_id) ?? fallbackFact
      );
      chunkIds.push(chunk.chunk_id);
    });

    const run = db.run(
      `UPDATE derivation_run
       SET status = 'succeeded', finished_at = datetime('now'), artifact_ref = ?
       WHERE derivation_id = ? AND status = 'running'`,
      [JSON.stringify({ chunks: chunkIds.length, facts: factIds.length }), derivationId]
    );
    if (run.changes !== 1) {
      throw new Error(`derivation ${derivationId} is no longer running (superseded or already finished)`);
    }

    const done = db.run(
      `UPDATE ingest_queue
       SET completed_at = datetime('now'),
           lease_owner = NULL,
           lease_token = NULL,
           lease_expires_at = NULL
       WHERE id = ? AND lease_token = ?`,
      [input.queue.id, input.queue.leaseToken]
    );
    if (done.changes !== 1) {
      throw new Error(`ingest_queue row ${input.queue.id} lease was lost before completion`);
    }

    db.exec("COMMIT");
    return { factIds, chunkIds };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
