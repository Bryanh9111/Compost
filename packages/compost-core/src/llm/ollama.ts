import type { LLMService, LLMGenerateOptions, LLMServiceConfig } from "./types";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "gemma4:31b";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_TIMEOUT_MS = 120_000;

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

export class OllamaLLMService implements LLMService {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;
  private readonly timeoutMs: number;

  constructor(config: LLMServiceConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    this.defaultTemperature = config.defaultTemperature ?? DEFAULT_TEMPERATURE;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generate(prompt: string, opts: LLMGenerateOptions = {}): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? this.timeoutMs
    );

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        prompt,
        stream: false,
        options: {
          num_predict: opts.maxTokens ?? this.defaultMaxTokens,
          temperature: opts.temperature ?? this.defaultTemperature,
        },
      };

      if (opts.systemPrompt) {
        body.system = opts.systemPrompt;
      }

      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ollama generate failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      return data.response;
    } finally {
      clearTimeout(timer);
    }
  }
}
