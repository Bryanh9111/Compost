# Sonnet — Debate 025 Round 1

**Perspective**: ship-this-week pragmatist. Smallest slice that breaks earliest if the architecture is wrong.

---

## Q1 Reasoning Architecture — **(b) Embedding-first**

Pick **(b)**: ANN k-NN as primary retrieval; graph as post-hoc explanation/provenance.

The `fact_links` table was built for contradiction/superseded chains (`0011_*.sql`). Context.md says "(a) graph-first: `fact_links` link density for 'thematic relevance' is low" — this is the key admission. A graph-first traversal over a graph that is mostly contradiction + superseded edges will return noise, not thematic clusters. You'd be doing N hops only to discover you needed the embeddings anyway for the final rerank step.

(b) vs (c): Parallel+RRF (c) doubles retrieval cost per reasoning call. For a single-user cost-sensitive deployment (HC-6), that is not free. Cross-fact reasoning may be called many times per session. (c) is right when you don't know which signal is better — but we DO know ANN dominates for thematic recall when graph link density is low. Use graph traversal only when a seed fact has >0 explicit `fact_links` rows to trace provenance; make it opportunistic, not mandatory.

Concretely: `reason(seedFactId)` → ANN k-NN (existing LanceDB ANN, `query/search.ts`) → filter/rerank by confidence → optionally trace `fact_links` on result set for chain explanation output. No new retrieval infrastructure.

---

## Q2 MVP Slice — **(α) Cross-fact reasoning**

Pick **(α)**: no new schema, no new storage, pure retrieval + LLM synthesis over existing facts.

This is the correct fail-fast slice because:
1. It exercises the actual L5 reasoning path (ANN → LLM synthesis) without touching `user_patterns` (schema locked, no reschema allowed per HC-8).
2. If the reasoning outputs are garbage, you find out before you've committed to a storage shape for `user_patterns`.
3. Pattern detection (β) is clustering, not reasoning — it exercises the populator path but doesn't validate the chain-of-thought quality that defines L5.
4. Hypothesis generation (γ) needs new storage; reflection prompts (δ) have no evaluable output — both burn cost without proving the core reasoning loop.

(α) output contract: `ReasoningResult { seed_fact_id, related_facts: QueryHit[], chain: string, confidence: number }` — pure in-memory, no migration required.

---

## Q3 Storage Shape — **(B) New `reasoning_chains` table**

Pick **(B)**: new dedicated table `reasoning_chains(chain_id, seed_fact_id, derived_facts JSON, llm_trace, confidence, kind)`.

Ruling out each alternative:

- **(A) `kind='hypothesis'` in `facts`**: Facts table carries semantic weight. A low-confidence hypothesis is not a fact. Mixing them breaks `digest.ts` selectors (lines 101-135 already filter `archived_at IS NULL AND superseded_by IS NULL AND confidence >= floor`) — a flood of 0.3-confidence hypotheses will poison every digest unless you add hypothesis-exclusion logic everywhere `facts` is queried. That's a cascade of L4 module changes, violating HC-7.
- **(C) Reuse `decision_audit`**: `AuditKind` TS union at `audit.ts:15-19` is hardcoded to 4 values; `migration 0010` SQL CHECK is locked. Adding `reasoning_chain`/`hypothesis` kinds is a schema migration + TS union change — context.md HC-4 explicitly names this as non-zero-cost. Option (C) is wishful thinking about "reuse."
- **(D) Write to Engram as `kind=insight`**: Engram is for synthesized cross-project insights, not intermediate reasoning chains. Dumping raw reasoning traces into Engram violates the "Engram = hippocampus, Compost = substrate" split from `docs/phase-5-user-model-design.md:5-9`. Also, you cannot query reasoning chains back from Engram for invalidation — Engram has no `fact_links`-aware traversal.

(B) gives clean separation, clear invalidation path (cascade on `seed_fact_id` delete), and doesn't pollute any existing L4 query path. One new migration (0018 or wherever the sequence lands), no existing module changes.

---

## Q4 Triggering — **(q) On-demand only**

Pick **(q)**: `compost reason <seed>` user-triggered, MCP-exposed as `compost.reason`.

HC-6 is dispositive: single-user dogfood, LLM background spend is not free. Scheduled reasoning (p) would fire the LLM every N hours against the full fact corpus. Even with a "high-value chain only" filter (r), defining "high-value" before you've seen any L5 outputs is premature optimization.

The reflect daemon already runs on a schedule for L4 (digest, curiosity, gap tracker). L5 cross-fact reasoning is not the same cadence — it's a depth operation, not a sweep operation. Running it on the same reflect schedule conflates two different compute profiles.

On-demand also gives the simplest CI contract: `compost reason --seed <fact_id> --dry-run` returns a deterministic snapshot (seeded LLM, or golden fixture). This satisfies HC-5 ("must have CI-assertable output") without the complexity of scheduling fixtures.

(r) hybrid is the right eventual answer but YAGNI until you've established what "high-value" means from real usage data.

---

## Q5 L5-Internal Ask Semantics — **(X) `gapThreshold: null`**

Pick **(X)**: silent gap suppression for L5-internal asks.

Debate 023 synthesis is unambiguous (synthesis.md lines 20-21): "Q4 L5 internal 4/4 consensus: L5 cross-fact reasoning internal ask MUST pass `gapThreshold: null` to prevent self-contamination." This was 4/4 — not a split decision. The API is already designed for this (`ask.ts:44-46`, comment explicitly says "L5 internal asks").

(Y) `gapSource` tag requires schema change (gaps table new column or new enum). Context.md deferred this as "Sonnet Q4 deferred" — it was deferred precisely because there was no L5 code to justify the column yet. Adding the column now, before a single L5 ask fires in production, is YAGNI by definition.

(Z) `kind='ask_gap'` in `decision_audit`: HC-4 kills this. `audit.ts:15-19` TS union is 4 kinds, `migration 0010` SQL CHECK is locked. Debate 023 synthesis explicitly ruled this out (synthesis.md lines 47-52): "adds `audit.ts:15-19` TS union + migration 0018 — not a small change." Same constraint applies here.

When L5 produces enough real output to justify routing gaps by source, open a new debate. `gapThreshold: null` costs zero lines of new code.

---

## Cross-Critique

### Context.md Q3 Option C — `decision_audit` reuse claim is misleading without its own cost annotation

Context.md §Q3 option C says: "directly reuse `decision_audit` (kind='reasoning_chain'/'hypothesis') + evidence_refs_json." This is presented as a viable low-cost option. It is not.

Evidence: `packages/compost-core/src/cognitive/audit.ts:15-19` — `AuditKind` TS union is exactly 4 values with no extension path. Any addition requires: (1) changing the TS union, (2) adding a migration to extend the SQL CHECK constraint. Context.md §硬约束 HC-4 states "decision_audit kind freeze: current 4 kinds are locked by SQL CHECK (`audit.ts:15-19` TS union + migration 0010), extending kind is schema migration (not zero-cost)." So context.md itself contains this constraint in HC-4 but then presents option C in Q3 without annotating that it *directly violates HC-4*. This is an internal inconsistency in context.md: option C should have been marked "(violates HC-4, requires migration + TS union change)" to prevent advisors from picking it without understanding the cost.

Predicted pick: Gemini may select (C) on the basis that `decision_audit` already has `evidence_refs_json` and the pattern is established. The file evidence at `audit.ts:15-19` makes this untenable without a migration.

### Context.md Q2 (β) framing — pattern detection is not L5 reasoning

Context.md §Q2 says β "has a clear user-visible product (`compost user-model list`)." True, but it also says β "is fundamentally clustering, not reasoning." Selecting β as the L5 MVP means your first shipped L5 capability is actually a statistics operation over observations, not reasoning over facts. If the hypothesis is wrong — that L5 can produce non-trivial reasoning chains — you will not discover it from β. The β slice proves the `user_patterns` populator path, not the reasoning engine. Advisors who select β are optimizing for user-visible output over architecture validation.

---

## TL;DR

1. (b)+(α)+(B)+(q)+(X): embedding-first ANN, cross-fact slice first, new `reasoning_chains` table, on-demand trigger, null gap threshold — zero schema violations, earliest architecture failure signal.
2. Option C (`decision_audit` reuse) violates HC-4 — `audit.ts:15-19` is a 4-kind TS union locked by `migration 0010`; context.md presents C without annotating this cost.
3. β pattern detection proves the populator, not the reasoner — pick α if you want to know whether L5 reasoning is actually worth building.
