# Codex — Round 1 (technical implementation perspective)

## Stance: a — move gap logging into `ask()`, but gate it on successful LLM synthesis or true no-evidence cases; defer audit/event work

## Answers to Q1-Q4
### Q1 threshold ownership
`0.4` should live in core as `DEFAULT_GAP_THRESHOLD`, with `AskOptions.gapThreshold?: number | null` for override/disable. That matches the existing pattern where policy defaults live in core but callers can opt out. MCP should stop owning the threshold because the current transport-level constant in `mcp-server.ts:35-42` is exactly the abstraction leak causing the blind spot.

### Q2 BM25 fallback semantics — concrete flag implementation
Opus’s conclusion to skip gap logging on LLM-failure fallback is directionally fine, but his reason is wrong. `hits[0].confidence` is not a retrieval score; it is fact confidence copied from `facts.confidence` in `search.ts:220,277-285`, and `ask()` returns the same `queryResult.hits` on both paths in `ask.ts:216-225,229-235`. There is no existing synthesized/not-synthesized flag in `ask.ts`. `llmOrRegistry instanceof BreakerRegistry` at `ask.ts:84-91` only selects call sites; it does not tell you whether this specific answer came from fallback, and raw `LLMService` callers can also fail.

Minimal implementation: add a local boolean, not a new public field. Example shape: `let synthesizedViaLlm = false;` before `answerLLM.generate`; set it to `true` only after the `await` succeeds; leave it `false` in the catch path. Then log gaps only when `(queryResult.hits.length === 0 && wikiContexts.length === 0) || synthesizedViaLlm`. That preserves the line-215 fallback, avoids schema/API churn, and keeps breaker tests stable.

### Q3 audit coupling
Do not couple this slice to `decision_audit`. This is stronger than “YAGNI”: it is not minimal. `AuditKind` does not include `"ask"` in `audit.ts:15-19`, and migration `0010_phase4_myco_integration.sql:43-58` hard-checks the allowed kinds. So “ask audit” is not a side tweak; it is a schema + type-union expansion. That is outside the narrow fix. If replay is needed later, that should be a dedicated instrumentation change.

### Q4 Phase 7 L5 scope impact
Reuse `ask()`; do not fork an L5-only ask API. But L5 internal reasoning calls should pass `gapThreshold: null`. Internal hypothesis probes are not user-facing “brain failed to answer” events, and feeding them into `open_problems` would contaminate Curiosity with self-generated noise. A nullable threshold is enough to enforce that boundary without duplicating the ask pipeline.

## Cross-critique of Opus r001_claude.md
`r001_claude.md:34-36` is technically wrong: it claims fallback confidence is a retrieval/BM25 score and normal-path confidence is LLM self-report. The code disagrees. `AskResult.hits` always come from `queryResult.hits` (`ask.ts:229-235`), and `QueryHit.confidence` is populated from `facts.confidence` (`search.ts:220,277-285`). There is no LLM confidence field anywhere in `AskResult`.

`r001_claude.md:56` says the current audit kind is only `wiki_rebuild`. That misses `contradiction_arbitration`, which is part of `AuditKind` in `audit.ts:15-19`, explicitly documented as an active writer in `audit.ts:103-105`, and exercised in `cross-p0-integration.test.ts:326-329`.

`r001_claude.md:96-99` points to `ask.test.ts`, but the live breaker/fallback invariants are actually in `packages/compost-core/test/cross-p0-integration.test.ts:148-229,236-270`. Any patch plan should target those tests, not a nonexistent file.

## Concrete patch sketch
- `packages/compost-core/src/query/ask.ts`: add `DEFAULT_GAP_THRESHOLD`; extend `AskOptions` with `gapThreshold?: number | null`; import `logGap`; add local `synthesizedViaLlm` flag around `answerLLM.generate`; after answer construction, non-fatally `try/catch` `logGap()` using the same threshold semantics currently in `mcp-server.ts`.
- `packages/compost-daemon/src/mcp-server.ts`: delete `GAP_CONFIDENCE_THRESHOLD` and remove the `logGap` block at `257-271`; keep handler transport-only.
- `packages/compost-core/test/cross-p0-integration.test.ts`: add assertions that breaker-open fallback still returns `[LLM unavailable]` and does not create/open a gap, while true no-evidence or low-confidence synthesized answers do.
- `packages/compost-cli/src/commands/ask.ts` plus `packages/compost-cli/src/main.ts`: add `compost ask` as a first-class caller of `ask()` so local CLI usage also feeds L4 by default.

## Recommendation
Take `(a)`, but implement it as provenance-gated core logging, not “skip fallback because confidence scales differ.” Use a local boolean in `ask.ts`; do not add a new result field; do not touch audit in this slice.
