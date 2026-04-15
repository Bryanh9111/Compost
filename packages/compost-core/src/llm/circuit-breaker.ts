import type { LLMService, LLMGenerateOptions } from "./types";

/**
 * P0-6 Circuit Breaker — parameters locked in debate 007 Pre-Week-3 Lock 4.
 *
 * Design (rolling window):
 *   - Window: 60 seconds of recent outcomes held in a ring buffer.
 *   - Open trip: failure rate > 50% AND at least 3 failures within the window.
 *   - Open duration: 30 seconds; all calls route to fallback in this period.
 *   - Half-open: after the open duration elapses, the NEXT call becomes the
 *     single probe. A `halfOpenLock` ensures concurrent callers do not all
 *     pass through at once (Codex R1 concurrent-probe race fix).
 *       - If the probe succeeds -> state returns to closed, buffer cleared.
 *       - If the probe fails    -> state returns to open, timer restarts.
 *
 * The constants below are the freeze-dried decision from debate 007. If a
 * future audit proposes changing them, update this file AND the JSDoc block
 * so the decision is traceable.
 *
 * **Not persisted**: the breaker state lives in memory. Daemon restart
 * resets to closed. Debate 007 Risk 2 accepted this trade-off — the first
 * post-restart call may incur one extra fail before the window reopens.
 *
 * **Not global**: each registry entry (see `breaker-registry.ts`) holds its
 * own breaker. Share state across call sites only via the registry, never
 * via a module-level singleton — tests must be able to `new` a fresh one.
 */

export const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
export const CIRCUIT_BREAKER_OPEN_MS = 30_000;
export const CIRCUIT_BREAKER_MIN_FAILURES = 3;
export const CIRCUIT_BREAKER_FAILURE_RATE = 0.5;

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOpts {
  /** Exposed for test injection; defaults to module constants. */
  windowMs?: number;
  openMs?: number;
  minFailures?: number;
  failureRate?: number;
  now?: () => number; // injected clock for deterministic tests
}

/**
 * Wrap an `LLMService` with rolling-window circuit-breaker semantics.
 * When the breaker is open, `generate` throws `CircuitOpenError` without
 * touching the underlying service -- callers MUST catch this and fall back
 * per their site's strategy (see `docs/ARCHITECTURE.md` LLM call sites table).
 *
 * Stub: P0-6 Week 3 will implement. The class and constants are exported
 * now so callers, tests, and the registry can reference stable shapes.
 */
export class CircuitOpenError extends Error {
  constructor(siteKey: string) {
    super(`circuit open for ${siteKey}`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreakerLLM implements LLMService {
  constructor(
    _inner: LLMService,
    _siteKey: string,
    _opts: CircuitBreakerOpts = {}
  ) {
    void _inner;
    void _siteKey;
    void _opts;
  }

  async generate(_prompt: string, _opts?: LLMGenerateOptions): Promise<string> {
    // TODO(P0-6 Week 3): implement rolling-window state machine + fallback
    void _prompt;
    void _opts;
    throw new Error("CircuitBreakerLLM.generate not implemented (P0-6 stub)");
  }

  /** Exposed for testing state transitions; not part of the LLMService contract. */
  getState(): CircuitState {
    return "closed";
  }
}
