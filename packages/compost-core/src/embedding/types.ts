/**
 * EmbeddingService — pluggable provider interface.
 * Phase 1: Ollama adapter only.
 * Phase 3+: ONNX fallback, remote API adapters.
 */
export interface EmbeddingService {
  /** Model identifier (e.g. "nomic-embed-text-v1.5") */
  readonly model: string;
  /** Vector dimension (e.g. 768) */
  readonly dim: number;
  /**
   * Generate embeddings for a batch of texts.
   * Returns one Float32Array per input text, each of length `dim`.
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface EmbeddingServiceConfig {
  /** Ollama API base URL. Default: http://localhost:11434 */
  baseUrl?: string;
  /** Model name to use. Default: nomic-embed-text:v1.5 */
  model?: string;
  /** Request timeout in ms. Default: 180000 */
  timeoutMs?: number;
  /** Max texts per batch request. Default: 64 */
  batchSize?: number;
}
