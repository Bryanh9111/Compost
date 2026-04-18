# Sonnet — Round 1 (pragmatic implementer)

## Stance: (a) sink logGap into ask() — minimal, no new flag, answer-string as LLM-path discriminator

The code already tells you how to detect BM25 fallback: `ask.ts:223` unconditionally prefixes the answer string with `[LLM unavailable` on catch. That string is the existing contract, visible in `cross-p0-integration.test.ts:210` assertions. No `synthesized_via_llm` flag needed — we just check `answer.startsWith("[LLM unavailable")` before calling logGap. Zero new AskResult fields, zero schema change.

## Answers to Q1-Q4 (implementation-level)

### Q1 threshold ownership

Core constant + per-caller nullable override. Exact shape matching `CONFIDENCE_FLOORS` pattern from `digest.ts`:

```typescript
// ask.ts (new)
export const DEFAULT_GAP_THRESHOLD = 0.4;

export interface AskOptions extends QueryOptions {
  maxAnswerTokens?: number;
  expandQueries?: boolean;
  gapThreshold?: number | null;  // null = disable logging entirely
}
```

`mcp-server.ts:41` `GAP_CONFIDENCE_THRESHOLD` constant deleted. MCP handler passes no override (picks up default). The constant was untested magic — moving it to core forces an assertion test as part of this change.

### Q2 BM25 fallback semantics

**Skip gap logging on BM25 fallback.** The implementation is simpler than Opus proposes: no new field on AskResult needed. The existing fallback path at `ask.ts:209-226` always sets `answer` to a string starting with `[LLM unavailable`. Use that as the sentinel:

```typescript
// ask.ts tail, after answer assignment
const llmDidAnswer = !answer.startsWith("[LLM unavailable");
if (
  llmDidAnswer &&
  opts.gapThreshold !== null
) {
  const thresh = opts.gapThreshold ?? DEFAULT_GAP_THRESHOLD;
  const topConf = queryResult.hits[0]?.confidence ?? 0;
  if (queryResult.hits.length === 0 || topConf < thresh) {
    logGap(db, question, { confidence: topConf });
  }
}
```

This is 8 lines, reuses the existing `[LLM unavailable` contract already tested in `cross-p0-integration.test.ts:210`, and does not introduce a new interface field. The `hits.length === 0 && wikiContexts.length === 0` early-return path at `ask.ts:197` sets a non-LLM-unavailable answer ("I don't have enough...") and `hits.length === 0` will correctly trigger logGap — that is the highest-value gap case (zero knowledge).

Opus's `synthesized_via_llm` flag approach is correct in spirit but over-engineers: it requires touching `AskResult` interface (shared contract) and all downstream consumers. String-prefix sentinel is already the test contract — use it.

### Q3 audit coupling

Do not write `decision_audit` on ask. Opus is right on the law but slightly wrong on the reason. The real reason: `decision_audit` entries are currently keyed by `target_id` which expects a stable resource identifier (fact ID, wiki page). A question string has no stable ID before it becomes a gap (the `problem_id` is only assigned by `logGap`). If you want ask-trace replay later, the `open_problems` table already records `question`, `first_asked_at`, `ask_count`, `last_answer_confidence` — that is your audit trail for gap events. Only write audit when the gap record is first created (i.e., `logGap` upsert hits the INSERT branch), not on every ask. This keeps the audit table scoped to "decisions that changed system state irreversibly" per its Phase 0-2 charter. No schema change needed.

### Q4 Phase 7 L5 scope impact

`gapThreshold: null` is the L5 escape hatch. No dedicated L5 ask entry-point needed — that would fork the API surface, and debate 022's lesson on `compost_fact_ids` contract applies directly. The JSDoc on `ask()` must state this contract at patch time, not as a later TODO.

One edge case Opus's r001 does not address: L5 may want to observe *which* cross-fact queries returned low confidence as a reasoning-quality signal without it polluting user-facing gaps. The `gapThreshold: null` option loses that signal entirely. A cleaner long-term option is a `gapSource?: "user" | "l5-internal"` tag passed through to `logGap`'s `opts.tags`. The `tags` column already exists on `open_problems` (gap-tracker.ts:31). This costs one extra field in `AskOptions` but zero schema migration. Recommend adding it to the L5 debate scope, not here — YAGNI until L5 is actually being built.

## Cross-critique of Opus r001_claude.md

**The `synthesized_via_llm` flag proposal is the weakest part.** Opus proposes adding a flag to signal the LLM-synthesis path (`ask.ts`), but the existing answer-string contract at `ask.ts:223` already encodes this information and is tested by three scenarios in `cross-p0-integration.test.ts` (lines 210, 269, 342). Adding a new field to `AskResult` widens the public interface unnecessarily, requires all downstream consumers to be updated, and creates a parallel representation of state already deterministically recoverable from the answer string. When you are implementing at 2am, "check a field you might have forgotten to set" fails silently; "check a string prefix that the test suite asserts" fails loudly. The string-prefix sentinel is simpler and already battle-tested.

Opus is right that this is **(a)-minimal** and right on Q3 (no audit write). The Q4 `gapThreshold: null` escape hatch is correct. The weakness is implementation specificity on Q2 — Opus reaches for a new abstraction where none is needed.

## Effort estimate + file list

**Estimated time: 45-60 minutes** (not 60+ as Opus says — no new AskResult field simplifies the work).

Files that change:
1. `packages/compost-core/src/query/ask.ts` — add `DEFAULT_GAP_THRESHOLD`, extend `AskOptions`, add `logGap` import + 8-line tail block
2. `packages/compost-daemon/src/mcp-server.ts` — delete `GAP_CONFIDENCE_THRESHOLD` const + the try/catch logGap block (lines 261-271), handler becomes pure transport
3. `packages/compost-core/test/cross-p0-integration.test.ts` — add gap assertions to existing BM25 fallback scenario (Scenario B, line 148); confirm gap NOT logged when answer starts with `[LLM unavailable`
4. `packages/compost-core/test/gap-tracker.test.ts` — new tests: gap logged on empty hits, gap logged on low conf, gap NOT logged on BM25 fallback, gap NOT logged when `gapThreshold: null`, `DEFAULT_GAP_THRESHOLD === 0.4`

Optional (Opus's recommendation, I agree):
5. `packages/compost-cli/src/commands/ask.ts` — new `compost ask <question>` CLI subcommand

Files that do NOT change: `gap-tracker.ts` (logGap signature stable per constraint 1), `search.ts`, migration files.

## Recommendation

Go with (a), implement the BM25-fallback guard via the existing `answer.startsWith("[LLM unavailable")` sentinel rather than a new AskResult field — this reuses a tested contract and keeps the interface clean. Add `gapThreshold?: number | null` to `AskOptions` immediately; add `gapSource` tag for L5 in the Phase 7 debate scope. Ship the CLI subcommand in the same slice so local dogfood starts generating signal before Phase 7 kicks off — without it, MCP-only sourcing was the root cause of total_asks=0 and we will repeat the same problem.
