/**
 * LLMService — pluggable provider interface for text generation.
 * Parallel design to EmbeddingService.
 * Phase 2: Ollama adapter (local, zero cost).
 * Phase 3+: API providers (Anthropic, OpenAI) via config.
 */
export interface LLMService {
  readonly model: string;

  /**
   * Generate text from a prompt.
   * Returns the generated text string.
   */
  generate(prompt: string, opts?: LLMGenerateOptions): Promise<string>;
}

export interface LLMGenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface LLMServiceConfig {
  baseUrl?: string;
  model?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  timeoutMs?: number;
}
