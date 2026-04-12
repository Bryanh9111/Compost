import type { EmbeddingService, EmbeddingServiceConfig } from "./types";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text:v1.5";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 64;

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

export class OllamaEmbeddingService implements EmbeddingService {
  readonly model: string;
  readonly dim = 768;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  constructor(config: EmbeddingServiceConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Ollama embed failed (${res.status}): ${body.slice(0, 200)}`
        );
      }

      const data = (await res.json()) as OllamaEmbedResponse;

      if (!data.embeddings || data.embeddings.length !== texts.length) {
        throw new Error(
          `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs`
        );
      }

      return data.embeddings.map((vec) => {
        if (vec.length !== this.dim) {
          throw new Error(
            `Expected dim=${this.dim}, got ${vec.length} from ${this.model}`
          );
        }
        return new Float32Array(vec);
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
