import type { Database } from "bun:sqlite";
import { EmbeddingShapeError, type EmbeddingService } from "../embedding/types";
import type { ChunkVector } from "../storage/lancedb";

/** The slice of VectorStore the sweep needs; tests substitute a recorder. */
export interface PendingVectorStore {
  upsert(rows: ChunkVector[]): Promise<void>;
  /** Optional: drop an observation's vectors before a re-derivation re-embeds it. */
  deleteByObserveIds?(observeIds: string[]): Promise<void>;
}

export interface EmbedPendingOptions {
  embeddingService: EmbeddingService;
  vectorStore: PendingVectorStore;
  /** Restrict the sweep to one observation (the inline fast path). */
  observeId?: string;
  /** Chunks per call. Default 64, the Ollama batch size. */
  limit?: number;
}

export interface EmbedPendingResult {
  embedded: number;
  /** Chunks the service answered for but with the wrong shape; isolated via embed_error. */
  failed: number;
  /** Chunks still pending after this call (same observeId scope). */
  remaining: number;
}

export interface PendingChunkCounts {
  pending: number;
  failed: number;
}

interface PendingChunk {
  chunk_id: string;
  observe_id: string;
  chunk_index: number;
  text_content: string;
  fact_id: string | null;
}

const DEFAULT_LIMIT = 64;

/** Counts behind daemon status and doctor: pending excludes isolated chunks. */
export function countPendingChunks(db: Database, observeId?: string): PendingChunkCounts {
  const scope = observeId ?? null;
  const row = db
    .query(
      `SELECT
         SUM(CASE WHEN embedded_at IS NULL AND embed_error IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN embed_error IS NOT NULL THEN 1 ELSE 0 END) AS failed
       FROM chunks
       WHERE (? IS NULL OR observe_id = ?)`
    )
    .get(scope, scope) as { pending: number | null; failed: number | null };
  return { pending: Number(row.pending ?? 0), failed: Number(row.failed ?? 0) };
}

/**
 * Embed chunks whose vectors are missing and upsert them into LanceDB.
 * Idempotent by construction: it reads `embedded_at IS NULL`, upserts by
 * chunk_id and marks rows only after the store accepted them.
 *
 * A service outage (embed() throws) propagates so the caller can back off.
 * A wrong-shaped answer (EmbeddingShapeError from the adapter, or a
 * malformed return value from a lenient service) is a poison input, not an
 * outage: the batch is retried one chunk at a time and the offenders are
 * isolated through chunks.embed_error so the sweep never loops on them.
 */
export async function embedPendingChunks(
  db: Database,
  opts: EmbedPendingOptions
): Promise<EmbedPendingResult> {
  const scope = opts.observeId ?? null;
  const rows = db
    .query(
      `SELECT chunk_id, observe_id, chunk_index, text_content, fact_id
       FROM chunks
       WHERE embedded_at IS NULL AND embed_error IS NULL
         AND (? IS NULL OR observe_id = ?)
       ORDER BY created_at, chunk_index
       LIMIT ?`
    )
    .all(scope, scope, opts.limit ?? DEFAULT_LIMIT) as PendingChunk[];
  if (rows.length === 0) return { embedded: 0, failed: 0, remaining: 0 };

  const dim = opts.embeddingService.dim;
  const wellFormed = (vector: Float32Array | undefined): boolean =>
    vector instanceof Float32Array && vector.length === dim;

  const good: ChunkVector[] = [];
  const bad: Array<{ chunk: PendingChunk; reason: string }> = [];
  const shapeProblem = (vector: Float32Array | undefined) =>
    vector ? `returned a vector of dim ${vector.length} (expected ${dim})` : `returned no vector (expected dim ${dim})`;

  let vectors: Float32Array[] | null = null;
  try {
    vectors = await opts.embeddingService.embed(rows.map((r) => r.text_content));
  } catch (err) {
    if (!(err instanceof EmbeddingShapeError)) throw err;
  }
  if (vectors && vectors.length === rows.length && vectors.every((v) => wellFormed(v))) {
    for (const [i, chunk] of rows.entries()) good.push(toChunkVector(db, chunk, vectors[i]!));
  } else {
    for (const chunk of rows) {
      try {
        const [vector] = await opts.embeddingService.embed([chunk.text_content]);
        if (vector && wellFormed(vector)) good.push(toChunkVector(db, chunk, vector));
        else bad.push({ chunk, reason: `embedding service ${shapeProblem(vector)}` });
      } catch (err) {
        if (!(err instanceof EmbeddingShapeError)) throw err;
        bad.push({ chunk, reason: err.message });
      }
    }
  }

  if (good.length > 0) await opts.vectorStore.upsert(good);

  const markEmbedded = db.prepare(
    "UPDATE chunks SET embedded_at = datetime('now'), embed_error = NULL WHERE chunk_id = ?"
  );
  const markFailed = db.prepare("UPDATE chunks SET embed_error = ? WHERE chunk_id = ?");
  db.transaction(() => {
    for (const row of good) markEmbedded.run(row.chunk_id);
    for (const { chunk, reason } of bad) markFailed.run(reason, chunk.chunk_id);
  })();

  return {
    embedded: good.length,
    failed: bad.length,
    remaining: countPendingChunks(db, opts.observeId).pending,
  };
}

function toChunkVector(db: Database, chunk: PendingChunk, vector: Float32Array): ChunkVector {
  return {
    chunk_id: chunk.chunk_id,
    observe_id: chunk.observe_id,
    fact_id: chunk.fact_id ?? fallbackFactId(db, chunk),
    vector,
  };
}

/** Rows written before 0028 (and engram adapter rows) carry no fact_id. */
function fallbackFactId(db: Database, chunk: PendingChunk): string {
  const fact = db
    .query(
      `SELECT fact_id FROM facts
       WHERE observe_id = ? AND archived_at IS NULL
       ORDER BY created_at LIMIT 1`
    )
    .get(chunk.observe_id) as { fact_id: string } | null;
  return fact?.fact_id ?? `orphan:${chunk.observe_id}:${chunk.chunk_index}`;
}
