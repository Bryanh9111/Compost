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

interface Outcome {
  t: number;     // timestamp ms
  ok: boolean;   // true on success, false on caught error
}

export class CircuitBreakerLLM implements LLMService {
  readonly model: string;
  private readonly windowMs: number;
  private readonly openMs: number;
  private readonly minFailures: number;
  private readonly failureRate: number;
  private readonly now: () => number;

  private state: CircuitState = "closed";
  private history: Outcome[] = [];
  private openedAt: number | null = null;
  /**
   * When `state === "half-open"`, this holds the in-flight probe promise so
   * concurrent callers block on the same request rather than all rushing the
   * wire and defeating the point of being half-open.
   */
  private probeInFlight: Promise<string> | null = null;

  constructor(
    private readonly inner: LLMService,
    private readonly siteKey: string,
    opts: CircuitBreakerOpts = {}
  ) {
    this.model = inner.model;
    this.windowMs = opts.windowMs ?? CIRCUIT_BREAKER_WINDOW_MS;
    this.openMs = opts.openMs ?? CIRCUIT_BREAKER_OPEN_MS;
    this.minFailures = opts.minFailures ?? CIRCUIT_BREAKER_MIN_FAILURES;
    this.failureRate = opts.failureRate ?? CIRCUIT_BREAKER_FAILURE_RATE;
    this.now = opts.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    this.maybeTransition();
    return this.state;
  }

  async generate(prompt: string, opts?: LLMGenerateOptions): Promise<string> {
    this.maybeTransition();

    if (this.state === "open") {
      throw new CircuitOpenError(this.siteKey);
    }

    if (this.state === "half-open") {
      // Concurrent half-open: share the single in-flight probe.
      if (this.probeInFlight) return this.probeInFlight;
      this.probeInFlight = this.runProbe(prompt, opts);
      try {
        return await this.probeInFlight;
      } finally {
        this.probeInFlight = null;
      }
    }

    // closed
    try {
      const result = await this.inner.generate(prompt, opts);
      this.record({ t: this.now(), ok: true });
      return result;
    } catch (err) {
      this.record({ t: this.now(), ok: false });
      throw err;
    }
  }

  private async runProbe(
    prompt: string,
    opts?: LLMGenerateOptions
  ): Promise<string> {
    try {
      const result = await this.inner.generate(prompt, opts);
      // Success closes the breaker and clears history.
      this.state = "closed";
      this.openedAt = null;
      this.history = [];
      return result;
    } catch (err) {
      // Probe failed -- re-open and restart the clock.
      this.state = "open";
      this.openedAt = this.now();
      throw err;
    }
  }

  private record(outcome: Outcome): void {
    this.history.push(outcome);
    this.prune(outcome.t);
    if (this.shouldTrip()) {
      this.state = "open";
      this.openedAt = outcome.t;
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.history.length > 0 && this.history[0]!.t < cutoff) {
      this.history.shift();
    }
  }

  private shouldTrip(): boolean {
    if (this.state !== "closed") return false;
    const failures = this.history.filter((o) => !o.ok).length;
    if (failures < this.minFailures) return false;
    const total = this.history.length;
    return failures / total > this.failureRate;
  }

  private maybeTransition(): void {
    if (this.state === "open" && this.openedAt !== null) {
      if (this.now() - this.openedAt >= this.openMs) {
        this.state = "half-open";
      }
    }
  }
}
