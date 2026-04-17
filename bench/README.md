# Bench harness

Layered performance benches for Compost. Design per debate 017 (Codex):
measure each layer **independently** so mixed-noise (WAL checkpoint, ANN
fetch, Ollama roundtrip) doesn't contaminate signal.

## Running benches

```bash
# All local benches (SQLite only — ~5 seconds):
bun run bench

# Specific bench:
bun bench/sqlite-reflect.bench.ts
bun bench/sqlite-query.bench.ts

# Include network-dependent benches (needs Ollama running):
COMPOST_BENCH_NETWORK=true bun run bench

# Include the 100k fixture size (slow; ~30s per large bench):
COMPOST_BENCH_LARGE=true bun run bench
```

Output is one JSON line per `(bench, fixture_size)` — stream to `jq`
or a CI comparator.

## Layers

| Layer | File | Gate | Measures |
|-------|------|------|----------|
| SQLite reflect | `sqlite-reflect.bench.ts` | default | `reflect()` at 1k / 10k obs (sensory-GC DELETE + FTS5 trigger fanout) |
| SQLite BM25 | `sqlite-query.bench.ts` | default | `query()` BM25-only, no vectorStore (FTS5 + Stage-2 rerank) |
| LanceDB ANN | `lancedb-ann.bench.ts` | `COMPOST_BENCH_NETWORK=true` | Stub — full impl deferred to Phase 5 |
| LLM latency | `llm-latency.bench.ts` | `COMPOST_BENCH_NETWORK=true` | Ollama roundtrip p50 / p95 |

## Sample output (Apple Silicon, local)

```json
{"name":"sqlite-reflect-1000","p50_ms":9.78,"p95_ms":10.72,"mean_ms":9.84,"fixture_size":1000}
{"name":"sqlite-reflect-10000","p50_ms":77.66,"p95_ms":81.75,"mean_ms":78.02,"fixture_size":10000}
{"name":"sqlite-query-bm25-1000","p50_ms":1.01,"p95_ms":3.71,"p99_ms":8.12,"fixture_size":1000}
{"name":"sqlite-query-bm25-10000","p50_ms":3.02,"p95_ms":5.94,"fixture_size":10000}
```

## CI regression gate

`.github/workflows/bench.yml` (when present) runs the default suite on
every PR and compares p95 ratios against `bench/baseline.json`. Ratio
above **1.5×** (50% regression) fails the build. Baselines are
committed; they update only via an explicit PR.

Use `bench/lib/runner.ts::checkRegression()` for the comparison helper.

## Fixture determinism

All fixtures come from `bench/lib/gen.ts`. The generator is **seeded
from row index**, so successive runs produce byte-identical data — runs
are directly comparable. Content is synthetic lorem that cannot trip
the PII redactor (no real CC numbers, no real tokens, no real paths).

## Adding a new bench

1. Import `runBench`, `formatResultLine` from `bench/lib/runner.ts`
2. Use fixtures from `bench/lib/gen.ts` (or add new ones there)
3. Emit one JSON line per `(name, fixture_size)` for stdout
4. If the bench needs network (Ollama / LanceDB), gate on
   `process.env.COMPOST_BENCH_NETWORK === "true"` and emit a
   `{skipped: true, reason}` line otherwise

## Known limitations (per debate 016 Codex I3)

- Warm-cache only — `<50ms p95` numbers are warm-cache. Cold-cache p99
  can be 3-5× worse on first run after machine boot (SQLite page cache
  empty, filesystem cache cold).
- Background noise is the dominant source of `p99 > p95` variance on
  laptops. CI on dedicated runners reduces this.
- `sqlite-reflect` seeds ~10% facts density; higher fact density scales
  reflect near-linearly because of the FK CASCADE fan-out.
