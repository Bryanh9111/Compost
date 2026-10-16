/**
 * LanceDB wrapper for L1 vector storage.
 * Manages a single "chunks" table with 768-dim vectors.
 * Single-user personal-KB scope: no cross-process locking — YAGNI (same
 * rationale as audit log TTL, ROADMAP:591). Daemon is single-writer; CLI
 * one-shots read from the same on-disk table without conflicting.
 */
import * as lancedb from "@lancedb/lancedb";
import type { EmbeddingService } from "../embedding/types";

const LANCE_TABLE_NAME = "chunk_vectors";
const DELETE_BATCH_SIZE = 500;

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface ChunkVector {
  chunk_id: string;
  fact_id: string;
  observe_id: string;
  vector: Float32Array;
}

export interface SearchHit {
  chunk_id: string;
  fact_id: string;
  observe_id: string;
  score: number; // cosine similarity (higher = more similar)
}

export class VectorStore {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private readonly dataDir: string;
  private readonly embeddingService: EmbeddingService;

  constructor(dataDir: string, embeddingService: EmbeddingService) {
    this.dataDir = dataDir;
    this.embeddingService = embeddingService;
  }

  async connect(): Promise<void> {
    this.db = await lancedb.connect(this.dataDir);
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(LANCE_TABLE_NAME)) {
      this.table = await this.db.openTable(LANCE_TABLE_NAME);
    }
  }

  async close(): Promise<void> {
    this.db = null;
    this.table = null;
  }

  /**
   * Add chunk vectors to the store. Creates the table if it doesn't exist.
   */
  async add(chunks: ChunkVector[]): Promise<void> {
    if (chunks.length === 0) return;
    if (!this.db) throw new Error("VectorStore not connected");

    const rows = chunks.map((c) => ({
      chunk_id: c.chunk_id,
      fact_id: c.fact_id,
      observe_id: c.observe_id,
      vector: Array.from(c.vector),
    }));

    if (!this.table) {
      this.table = await this.db.createTable(LANCE_TABLE_NAME, rows);
    } else {
      await this.table.add(rows);
    }
  }

  /**
   * Insert or replace vectors keyed by chunk_id (globally unique since
   * migration 0028). Idempotent: a retry or a re-embed overwrites the row
   * instead of appending a duplicate.
   */
  async upsert(chunks: ChunkVector[]): Promise<void> {
    if (chunks.length === 0) return;
    if (!this.db) throw new Error("VectorStore not connected");

    const rows = chunks.map((c) => ({
      chunk_id: c.chunk_id,
      fact_id: c.fact_id,
      observe_id: c.observe_id,
      vector: Array.from(c.vector),
    }));

    if (!this.table) {
      this.table = await this.db.createTable(LANCE_TABLE_NAME, rows);
      return;
    }
    await this.table
      .mergeInsert("chunk_id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  /**
   * Delete every vector of the given observations (reflect GC, re-embeds).
   * Batched so the predicate stays small on large sweeps.
   */
  async deleteByObserveIds(observeIds: string[]): Promise<void> {
    if (!this.table) return;
    for (let i = 0; i < observeIds.length; i += DELETE_BATCH_SIZE) {
      const list = observeIds
        .slice(i, i + DELETE_BATCH_SIZE)
        .map(quoteLiteral)
        .join(", ");
      await this.table.delete(`observe_id IN (${list})`);
    }
  }

  /** Row count, optionally filtered by a LanceDB predicate. */
  async countRows(filter?: string): Promise<number> {
    if (!this.table) return 0;
    return this.table.countRows(filter);
  }

  /**
   * Compact fragments and prune old versions. Every write creates a new
   * fragment and version, so an unoptimised table degrades scan speed and
   * disk use steadily; the daemon calls this from its daily backup tick.
   */
  async optimize(options: { cleanupOlderThan?: Date } = {}): Promise<void> {
    if (!this.table) return;
    await this.table.optimize(options);
  }

  /**
   * Search for similar chunks by query text.
   * Returns top-K results with cosine similarity scores.
   */
  async search(queryText: string, topK: number = 200, signal?:AbortSignal): Promise<SearchHit[]> {
    if (!this.table) return [];

    const [queryVec] = await this.embeddingService.embed([queryText],signal);
    signal?.throwIfAborted();
    if (!queryVec) return [];

    const results = await (this.table.search(Array.from(queryVec)) as unknown as {
      distanceType(type: string): { limit(n: number): { toArray(): Promise<unknown[]> } };
    })
      .distanceType("cosine")
      .limit(topK)
      .toArray();

    return results.map((row) => {
      const r = row as Record<string, unknown>;
      return {
      chunk_id: r.chunk_id as string,
      fact_id: r.fact_id as string,
      observe_id: r.observe_id as string,
      // LanceDB returns _distance (lower = more similar for cosine)
      // Convert to similarity: 1 - distance
      score: 1 - (r._distance as number),
      };
    });
  }

  /**
   * Search by pre-computed vector (for is_noteworthy gate 4).
   */
  async searchByVector(
    vector: Float32Array,
    topK: number = 5
  ): Promise<SearchHit[]> {
    if (!this.table) return [];

    const results = await (this.table.search(Array.from(vector)) as unknown as {
      distanceType(type: string): { limit(n: number): { toArray(): Promise<unknown[]> } };
    })
      .distanceType("cosine")
      .limit(topK)
      .toArray();

    return results.map((row) => {
      const r = row as Record<string, unknown>;
      return {
      chunk_id: r.chunk_id as string,
      fact_id: r.fact_id as string,
      observe_id: r.observe_id as string,
      score: 1 - (r._distance as number),
      };
    });
  }

  /**
   * Delete all vectors for a given observe_id (for reflect GC).
   */
  async deleteByObserveId(observeId: string): Promise<void> {
    await this.deleteByObserveIds([observeId]);
  }

  /**
   * Drop and recreate the table (for doctor --rebuild L1).
   */
  async dropTable(): Promise<void> {
    if (!this.db) throw new Error("VectorStore not connected");
    try {
      await this.db.dropTable(LANCE_TABLE_NAME);
    } catch {
      // Table might not exist
    }
    this.table = null;
  }

  /** Check if the vector store has any data */
  async isEmpty(): Promise<boolean> {
    if (!this.table) return true;
    const count = await this.table.countRows();
    return count === 0;
  }

  get connected(): boolean {
    return this.db !== null;
  }
}
