import type { Database } from "bun:sqlite";
import type { EmbeddingService } from "../embedding/types";
import { embedPendingChunks, type PendingVectorStore } from "./embed-pending";

export interface EmbedObservationResult {
  embedded: number;
  /** Set when the embedding service failed; the chunks stay pending for the daemon sweep. */
  error?: string;
}

/**
 * Inline embedding for the one-shot pipelines (`compost add`, web ingest):
 * drains every pending chunk of one observation when a vector store is
 * configured. Facts are already committed, so a failure here is reported,
 * not retried through the queue.
 */
export async function embedObservationChunks(
  db: Database,
  observeId: string,
  services: { embeddingService?: EmbeddingService; vectorStore?: PendingVectorStore }
): Promise<EmbedObservationResult> {
  if (!services.embeddingService || !services.vectorStore) return { embedded: 0 };
  let embedded = 0;
  try {
    for (;;) {
      const result = await embedPendingChunks(db, {
        embeddingService: services.embeddingService,
        vectorStore: services.vectorStore,
        observeId,
      });
      embedded += result.embedded;
      if (result.remaining === 0 || result.embedded === 0) return { embedded };
    }
  } catch (err) {
    return { embedded, error: err instanceof Error ? err.message : String(err) };
  }
}
