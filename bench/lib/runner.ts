/**
 * Bench runner primitives.
 *
 * Design per debate 017 (Codex): benches must be layered — SQLite /
 * LanceDB / LLM measured independently so mixed-noise (WAL checkpoint,
 * ANN fetch, Ollama roundtrip) doesn't contaminate signal.
 *
 * This module is layer-agnostic. Each bench file composes its own
 * fixture + invocation via runBench() and emits JSON to stdout.
 */

/**
 * Nearest-rank percentile. Returns 0 on empty input.
 * Matches the standard used by compost doctor --measure-hook so bench
 * results are directly comparable.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0] ?? 0;
  if (p >= 100) return sorted[sorted.length - 1] ?? 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))] ?? 0;
}

export interface BenchResult {
  name: string;
  iters: number;
  warmup: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  mean_ms: number;
  min_ms: number;
  max_ms: number;
  total_ms: number;
  samples_ms: number[];
}

export interface BenchOpts {
  name: string;
  iters: number;
  warmup?: number;
  setup?: () => Promise<void> | void;
  run: () => Promise<unknown> | unknown;
  teardown?: () => Promise<void> | void;
}

/**
 * Run a bench. Warmup iterations are executed but not timed. Measured
 * iterations invoke setup() → time(run()) → teardown() to isolate the
 * measured call from fixture churn.
 */
export async function runBench(opts: BenchOpts): Promise<BenchResult> {
  const warmup = opts.warmup ?? 3;

  // Warmup: run both setup + run, but do not time. This primes JIT, fills
  // caches, warms SQLite page cache, etc.
  for (let i = 0; i < warmup; i++) {
    if (opts.setup) await opts.setup();
    await opts.run();
    if (opts.teardown) await opts.teardown();
  }

  const samples: number[] = [];
  for (let i = 0; i < opts.iters; i++) {
    if (opts.setup) await opts.setup();
    const t0 = performance.now();
    await opts.run();
    const elapsed = performance.now() - t0;
    samples.push(elapsed);
    if (opts.teardown) await opts.teardown();
  }

  const total = samples.reduce((a, b) => a + b, 0);
  return {
    name: opts.name,
    iters: opts.iters,
    warmup,
    p50_ms: round(percentile(samples, 50)),
    p95_ms: round(percentile(samples, 95)),
    p99_ms: round(percentile(samples, 99)),
    mean_ms: round(total / samples.length),
    min_ms: round(Math.min(...samples)),
    max_ms: round(Math.max(...samples)),
    total_ms: round(total),
    samples_ms: samples.map(round),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format a BenchResult as one-line JSON for stdout. Bench runners print
 * this so a downstream tool (CI, baseline comparator) can consume with
 * `bun run bench/... | jq`.
 */
export function formatResultLine(
  result: BenchResult,
  extras: Record<string, unknown> = {}
): string {
  const { samples_ms, ...summary } = result;
  return JSON.stringify({
    ...summary,
    ts: new Date().toISOString(),
    ...extras,
  });
}

/**
 * Compare current result against a baseline. Returns regression ratio
 * (current.p95 / baseline.p95). Ratio > threshold (default 1.5 = 50%
 * regression) means the bench slowed down enough to fail CI.
 */
export interface RegressionCheck {
  regressed: boolean;
  ratio_p95: number;
  ratio_p50: number;
  threshold: number;
}

export function checkRegression(
  current: BenchResult,
  baseline: BenchResult,
  threshold: number = 1.5
): RegressionCheck {
  const ratio_p95 =
    baseline.p95_ms > 0 ? current.p95_ms / baseline.p95_ms : 1;
  const ratio_p50 =
    baseline.p50_ms > 0 ? current.p50_ms / baseline.p50_ms : 1;
  return {
    regressed: ratio_p95 > threshold,
    ratio_p95: round(ratio_p95),
    ratio_p50: round(ratio_p50),
    threshold,
  };
}
