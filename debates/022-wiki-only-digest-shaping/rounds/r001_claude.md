# Claude (Opus) Analysis — Round 1

## Stance: (a), with a deferred follow-up to a specific variant of (d)

## Reading of the three advisors

- 🟡 **Gemini → (d) meta-fact anchor**: persist the digest event itself as a new row in `facts`, use that fact_id in `compost_fact_ids`.
- 🔴 **Codex → (a)** with deliberate implementation: change default floor 0.85 → 0.75 in BOTH `digest.ts` (buildDigest default) AND `compost-cli/src/commands/digest.ts` (CLI option default — currently hardcoded 0.85), keep `--confidence-floor` as override, update help text to distinguish digest ("noteworthy changes" filter) from arbitration semantics. Identifies that the correct (d) is NOT `wiki_page_observe` but `decision_audit.evidence_refs_json` where `kind=wiki_rebuild` already records `input_fact_ids` (`packages/compost-core/src/cognitive/wiki.ts:190`).
- 🟠 **Sonnet → (d) via JOIN `wiki_page_observe → observations → facts(observe_id)`**; conditioned on facts.observe_id existing (it does, `packages/compost-core/src/schema/0001_init.sql:97`).

## Why (a) wins for this cut

1. **Failure-attribution rule** (user's stated constraint #4). Round B is specifically meant to exercise the S6-2 MCP write transport on live stack. (a) leaves `digest.ts` → `EngramWriter.writeInsight()` → `StdioEngramMcpClient` code path byte-identical except for a constant. If push fails, the blame lands in transport/Engram, not in a new provenance-derivation path authored the same hour.

2. **(b) is not excusable**. `compost_fact_ids` is not a free-form "provenance" field. It's:
   - the UUIDv5 seed for `computeRootInsightId()` (`packages/compost-engram-adapter/src/splitter.ts:40-47`) — so idempotency of re-synthesis depends on real fact_ids being stable, not hash strings tied to a path that may rename;
   - the invalidation target for `EngramWriter.invalidateFacts()` — synthetic ids silently no-op;
   - zod `min(1)` guard (`writer.ts:15`) would become a fake-guard.

3. **Gemini's meta-fact (d) has a schema smell**. Inserting a new row into `facts` for every digest run pollutes the L2 tier with derived meta-records that don't match the subject/predicate/object ontology. Would need a new kind column or convention to distinguish from real facts. Non-trivial scope creep for Round B.

4. **Sonnet's (d) via `wiki_page_observe`** is feasible but Codex's find is strictly better: `decision_audit` with `kind='wiki_rebuild'` ALREADY stores `input_fact_ids` as JSON in `evidence_refs_json` (wiki.ts:190, confirmed in audit.ts:50). A `wiki_pages` ⋈ `decision_audit` JOIN with `JSON.parse(evidence_refs_json).input_fact_ids` yields the real contributing facts with zero schema changes and zero extra hops. But this is still a new code path for Round B — same failure-attribution concern as Gemini's variant.

5. **Codex correctly flags that (a) is NOT a 1-line change**: both `digest.ts` default (currently `CONFIDENCE_FLOORS.instance`) and CLI option default (currently hardcoded `0.85` in `packages/compost-cli/src/commands/digest.ts:42`) need to move together, else `programmatic callers vs CLI callers` diverge silently. Worth an explicit test.

## Answers to the 4 sub-questions

1. **Q1 (b) excused by scope=meta?** No. Contract is on the real-row semantics of `compost_fact_ids`, not just zod shape. Idempotency and invalidation routes both break silently under fake ids.

2. **Q2 (a) keep --confidence-floor + help update?** Yes. Option override stays; help text should say: "Digest uses confidence as a noteworthiness filter, not as the arbitration trust floor. Default `exploration = 0.75` captures typical personal-KB ingest; raise to `0.85` (instance) only if you want arbitration-grade confidence gating."

3. **Q3 option (d)?** Yes, a real one exists: JOIN `wiki_pages.path` → `decision_audit.target_id WHERE kind='wiki_rebuild'` → JSON.parse(evidence_refs_json).input_fact_ids. Zero schema change. Defer to **slice 3** after Round B dogfood proves the transport.

4. **Q4 attribution complexity?** (a) minimizes it — no new query paths in the dogfood cut. (d)-via-audit is a clean architectural upgrade but widens the failure surface; Gemini's meta-fact (d) widens both schema and query surfaces.

## Recommendation

**Round B = (a)**:
- `packages/compost-core/src/cognitive/digest.ts` — change default `confidenceFloor` from `CONFIDENCE_FLOORS.instance` to `CONFIDENCE_FLOORS.exploration` (0.75).
- `packages/compost-cli/src/commands/digest.ts:42` — change hardcoded CLI default `0.85` to `0.75`, match string in help.
- Update help text per Q2.
- Add one test asserting default floor = 0.75.
- Then wire `--push`.

**Slice 3 (post-dogfood)** = (d) via `decision_audit.evidence_refs_json`:
- Extend `selectWikiRebuilds` to also return `contributing_fact_ids` pulled from decision_audit.
- `digestInsightInput` merges wiki contributing_fact_ids into the Set.
- wiki-only digests gain real provenance → can push without touching the floor knob.

**Fallback behavior kept**: if post-(a) a digest still has no facts/resolved_gaps (and slice 3 hasn't landed yet), `digestInsightInput() === null` still causes Round B to print "no insight-worthy content" and skip push. This is correct, not a bug.
