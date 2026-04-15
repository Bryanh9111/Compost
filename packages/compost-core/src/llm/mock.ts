import type { LLMService, LLMGenerateOptions } from "./types";

/**
 * P0-6 Mock LLM — exercises the five failure modes locked in debate 007:
 *   - `happy`:   returns `response` immediately
 *   - `timeout`: throws an "LLM timeout" Error after `delay` ms
 *   - `error`:   throws `errorMessage` (default: "LLM 5xx") immediately
 *   - `garbage`: returns `response` but with mode's own "garbage-response"
 *                string if none provided (non-parseable text)
 *   - `hang`:    returns a promise that never resolves (for half-open test
 *                infinite-wait behavior). Callers should use `timeoutMs` or
 *                an external AbortSignal in real integrations.
 *
 * Constructor accepts a `sequence` of modes for sequential calls so a single
 * test can drive the breaker through closed -> open -> half-open -> closed
 * by varying the response per call.
 *
 * Each instance owns its own state. Never share a MockLLMService across
 * tests -- the circuit breaker wrapping it would carry state between them.
 */

export type MockMode = "happy" | "timeout" | "error" | "garbage" | "hang";

export interface MockLLMServiceOpts {
  /**
   * Mode for every call (shorthand). Ignored if `sequence` is provided.
   */
  mode?: MockMode;
  /**
   * Pre-planned sequence of modes; element `i` governs the `i`-th call.
   * When exhausted, falls back to the last element (or `happy` if empty).
   */
  sequence?: MockMode[];
  delay?: number; // milliseconds; default 0 for non-hang modes
  response?: string; // returned on `happy`; garbage returns this if set
  errorMessage?: string; // thrown on `error` / `timeout`
  model?: string;
}

export class MockLLMService implements LLMService {
  readonly model: string;
  private callCount = 0;

  constructor(private readonly opts: MockLLMServiceOpts = {}) {
    this.model = opts.model ?? "mock-llm-v1";
  }

  getCallCount(): number {
    return this.callCount;
  }

  async generate(_prompt: string, _opts?: LLMGenerateOptions): Promise<string> {
    void _opts;
    const callIndex = this.callCount;
    this.callCount += 1;

    const seq = this.opts.sequence;
    const mode: MockMode =
      seq && seq.length > 0
        ? seq[Math.min(callIndex, seq.length - 1)]!
        : (this.opts.mode ?? "happy");

    const delay = this.opts.delay ?? 0;
    if (delay > 0 && mode !== "hang") {
      await new Promise((r) => setTimeout(r, delay));
    }

    switch (mode) {
      case "happy":
        return this.opts.response ?? `[mock] response to: ${_prompt.slice(0, 60)}`;
      case "timeout":
        throw new Error(this.opts.errorMessage ?? "LLM timeout");
      case "error":
        throw new Error(this.opts.errorMessage ?? "LLM 5xx");
      case "garbage":
        return this.opts.response ?? "<<garbage>>not-json-and-not-markdown";
      case "hang":
        // Resolves only when the process exits. Use only for half-open
        // probe-blocking scenarios with an external AbortSignal.
        return new Promise<string>(() => {});
      default:
        throw new Error(`unknown MockLLMService mode: ${String(mode)}`);
    }
  }
}
