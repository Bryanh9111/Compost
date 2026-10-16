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

/**
 * The active-run key of idx_derivation_run_active (0002_debate3_fixes.sql)
 * for the L2 ingest path: one running/succeeded run per observation+policy.
 */
const ACTIVE_INGEST_RUN = `observe_id = ?
       AND layer = 'L2'
       AND transform_policy = ?
       AND model_id = ''
       AND coalesce(context_scope_id, '') = ''
       AND coalesce(extraction_profile, '') = ''`;

export function hasSucceededIngestDerivation(
  db: Database,
  observeId: string,
  policyId: string
): boolean {
  const row = db
    .query(`SELECT 1 FROM derivation_run WHERE ${ACTIVE_INGEST_RUN} AND status = 'succeeded' LIMIT 1`)
    .get(observeId, policyId);
  return row !== null;
}

/**
 * Open a `running` derivation for a claimed queue row. A run left `running`
 * by a worker that died (or whose lease expired mid-extraction) is marked
 * failed first, so the unique active-run index never rejects the re-claim.
 * Returns the number of superseded runs.
 */
export function beginDerivation(
  db: Database,
  input: { derivationId: string; observeId: string; policyId: string }
): number {
  const superseded = db.run(
    `UPDATE derivation_run
     SET status = 'failed', finished_at = datetime('now'), error = 'superseded by re-claim'
     WHERE ${ACTIVE_INGEST_RUN} AND status = 'running'`,
    [input.observeId, input.policyId]
  ).changes;
  db.run(
    `INSERT INTO derivation_run (derivation_id, observe_id, layer, transform_policy, status)
     VALUES (?, ?, 'L2', ?, 'running')`,
    [input.derivationId, input.observeId, input.policyId]
  );
  return superseded;
}

/** Mark a still-running derivation failed; a no-op once it reached a terminal state. */
export function failDerivation(db: Database, derivationId: string, error: string): boolean {
  return (
    db.run(
      `UPDATE derivation_run
       SET status = 'failed', finished_at = datetime('now'), error = ?
       WHERE derivation_id = ? AND status = 'running'`,
      [error, derivationId]
    ).changes > 0
  );
}

export interface PersistExtractionResult {
  factIds: string[];
  chunkIds: string[];
  /** Rows left by an earlier attempt that this derivation replaced (facts are archived, chunks deleted). */
  replacedFacts: number;
  replacedChunks: number;
  /** True when the observation's previous vectors were queued for deletion. */
  vectorGcQueued: boolean;
}

const DEFAULT_HALF_LIFE_SEC = 2_592_000; // 30 days (spec §2 tp-2026-04)

export function sha256Hex(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * Rewrite extractor-local chunk ids (c0, c1, ...) that a pre-0028 writer
 * stored as the global id. Migration 0028 does this once; a daemon still
 * running the old code after the migration writes more, so the daemon boot,
 * the manifest backfill and doctor call this idempotent sweep again.
 * Returns the number of rows renamed.
 */
export function namespaceLegacyChunkIds(db: Database): number {
  const legacy = (
    db
      .query("SELECT count(*) AS n FROM chunks WHERE chunk_id GLOB 'c[0-9]*' AND chunk_id NOT GLOB '*-*' AND chunk_id NOT GLOB '*:*'")
      .get() as { n: number }
  ).n;
  if (legacy > 0) {
    db.run(
      `UPDATE chunks SET chunk_id = observe_id || ':' || chunk_id
       WHERE chunk_id GLOB 'c[0-9]*' AND chunk_id NOT GLOB '*-*' AND chunk_id NOT GLOB '*:*'`
    );
  }
  return legacy;
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
    // A derivation replaces whatever an earlier attempt left behind. The
    // pre-0028 pipeline committed facts and chunks before embedding, so a
    // retry after an embedding failure would otherwise collide on chunk ids
    // and duplicate facts. Leftover facts are archived, not deleted: other
    // facts may reference them (superseded_by, replaced_by_fact_id) and the
    // archive keeps those identities. Facts of a run that did succeed under
    // an older policy stay active; chunks are always re-derived.
    const priorRuns = (
      db
        .query("SELECT count(*) AS n FROM derivation_run WHERE observe_id = ? AND derivation_id != ?")
        .get(observeId, derivationId) as { n: number }
    ).n;
    const priorSuccess =
      db
        .query("SELECT 1 FROM derivation_run WHERE observe_id = ? AND layer = 'L2' AND status = 'succeeded' LIMIT 1")
        .get(observeId) !== null;
    // Counted with SELECT: bun:sqlite's `changes` also counts the rows the
    // FTS triggers touch.
    const replacedFacts = priorSuccess
      ? 0
      : (db.query("SELECT count(*) AS n FROM facts WHERE observe_id = ? AND archived_at IS NULL").get(observeId) as { n: number }).n;
    if (replacedFacts > 0) {
      db.run(
        `UPDATE facts SET archived_at = datetime('now'), archive_reason = 'superseded'
         WHERE observe_id = ? AND archived_at IS NULL`,
        [observeId]
      );
    }
    const replacedChunks = (
      db.query("SELECT count(*) AS n FROM chunks WHERE observe_id = ?").get(observeId) as { n: number }
    ).n;
    db.run("DELETE FROM chunks WHERE observe_id = ?", [observeId]);
    // Any earlier run may have embedded vectors (pre-0028 even without
    // manifest rows); queue their removal durably, drained before embedding.
    const vectorGcQueued = priorRuns > 0 || replacedChunks > 0 || replacedFacts > 0;
    if (vectorGcQueued) db.run("INSERT OR IGNORE INTO vector_gc_queue (observe_id) VALUES (?)", [observeId]);

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
    return { factIds, chunkIds, replacedFacts, replacedChunks, vectorGcQueued };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
