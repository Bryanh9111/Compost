# Gemini — Round 1 (strategic / ecosystem perspective)

## Stance: (a) Core Sinking — Gap tracking is a native "Brain" reflex, not a transport-layer side effect.

## Answers to Q1-Q4 (architectural reasoning)

### Q1 threshold ownership
The `DEFAULT_GAP_THRESHOLD = 0.4` must be anchored in `packages/compost-core/src/query/ask.ts`. From an ecosystem perspective, "what the system doesn't know" is a core ontological fact, not a configuration preference of the MCP or CLI. It must be overridable in `AskOptions` to allow Phase 7 L5 to programmatically adjust the "curiosity aperture" during autonomous reasoning, but the default "social contract" of the brain’s ignorance belongs in core.

### Q2 BM25 fallback semantics
**Log as Gap (Strongly Disagree with Opus).** If the LLM synthesis path fails (breaker open or expansion failure) and we fall back to BM25, the system has fundamentally failed its primary mission of "answering." This is the highest-value gap signal we have. Opus's concern regarding "dimension mismatch" is a implementation detail; we should simply log these as `confidence: 0.0` or a reserved `null` to signify a "Total Synthesis Failure." Silencing these gaps blinds the Curiosity engine exactly when the system is under the most stress.

### Q3 audit coupling (decision_audit kind='ask')
**Selective "Ask-Gap" Audit.** I propose a middle path: do not audit every `ask()`, but *do* audit every `logGap()` event within the core. A gap is not just a missing result; it is a "Decision to admit ignorance," which qualifies for `decision_audit` (e.g., `kind='ask_gap'`). This provides Phase 7 L5 with a high-fidelity diagnostic trace of system failures without the storage bloat of logging successful retrievals.

### Q4 Phase 7 L5 scope impact
L5 internal reasoning must utilize `gapThreshold: null` to prevent recursive signal pollution. However, we should anticipate "Exploratory Asks" where L5 *wants* to flag gaps it discovers during autonomous research. By putting the logic in Core (a), we enable L5 to selectively weaponize the gap tracker to "summon" more information from the crawl queue or human-in-the-loop, rather than just being a passive consumer of user-generated gaps.

## Cross-critique of Opus r001_claude.md

Opus's recommendation to skip gap logging on BM25 fallbacks (Q2) is a strategic error that prioritizes "clean metrics" over "system utility." In a production environment, the period when the Breaker is open is exactly when we need the L4/L5 layers to be most aggressive in identifying missing information. Silencing the signal during fallbacks creates a "dead zone" in our curiosity clusters. Opus's fear of "fake gaps" assumes that BM25 results are "good enough" to not be gaps; I argue that any question forced into the fallback path is, by definition, a failure of the current fact-graph to support synthesis.

Furthermore, Opus’s rejection of `decision_audit` integration (Q3) ignores the "Observability Debt" we are carrying into Phase 7. While I agree that auditing *every* ask is overkill, auditing the *gaps* provides the necessary forensic evidence for L5 to perform "Root Cause Analysis" on why the brain is failing. Opus’s YAGNI stance here will lead to a "blind-flying" L5 that can see gaps but has no audited context of the synthesis attempt that produced them.

## Recommendation
Implement **(a) Core Sinking** with the addition of a `kind='ask_gap'` entry in `decision_audit`. Ensure the `ask()` internal logic logs a gap on *all* fallback paths (forcing confidence to 0) to ensure L5 remains aware of system-level synthesis failures. This transforms the Gap Tracker from a passive log into a proactive "Signal Factory" for the analytical partner.
