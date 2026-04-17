# Debate 016: Engram×Compost Roadmap Revalidation

**Mode**: adversarial
**Participants**: claude-opus, claude-sonnet, gemini, codex
**Rounds**: 2
**Date**: 2026-04-16

## Trigger

Debate 015 produced 4/4 consensus on:
1. Kill Engram v4-v7 (LLM compile / multi-path / embedding / graph → all go to Compost)
2. v3.3: recall_miss log + tiered kind-lint + WAL/FTS5 audit (~100 LoC)
3. v3.4: Engram→Compost suggest_ingest (outbox async, signature forbids await, ~50 LoC)
4. v3.5: Compost→Engram async writeback (independent worker + idempotent key + TTL + source_hash invalidate, ~150 LoC)
5. Hard constraints: schema forbids embedding column + CONTRIBUTING + CI rules (~30 LoC)

User requests adversarial revalidation considering **full end-state vision** (not just incremental roadmap).

## End-State Vision

### Compost (library / deep KB)
- LLM-driven multi-layer synthesis (L0 ledger → L2 facts → wiki)
- 10K+ facts per project, p95 3-10s queries
- Compost is "图书馆" — look up when needed

**Use cases**:
1. AI coding session cold-start elimination
2. Cross-conversation decision continuity
3. Hallucination suppression (source_fact_ids traceable)
4. Personal knowledge composting (auto wiki rewrite, decay)
5. Engram's LLM cache medium (v3.5 new role)

### Engram (notebook / working memory)
- Zero-LLM FTS5+SQLite, <50ms p95
- ~500 memories per project, injected before every LLM call
- Engram is "便条夹" — reach for it every turn

**Use cases**:
1. Prevent AI from repeating pitfalls (guardrail proactive)
2. Cross-project experience reuse (唯一护城河)
3. SessionStart context injection (hook-driven)
4. User discipline enforcement (CLAUDE.md as proactive recalls)
5. Compost answer materialization cache (v3.5)

## 5 Assertions for Adversarial Challenge

Any assertion rejected by ≥3/4 triggers redesign.

### Q1: Positioning granularity paradox
"Compost = library, Engram = notepad". But Engram entries ~200 chars vs Compost facts 1-5 sentences.
Compost facts are SMALLER but DEEPER; Engram records are LARGER but SHALLOWER.
**Is this counterintuitive? Is the granularity split coherent?**

### Q2: v3.5 compiled-origin trust risk
Compost writes back to Engram as "LLM cache medium".
Does this break Engram's zero-LLM promise?
Can the user distinguish deterministic FTS5 results from Compost-cached LLM artifacts at recall time?
**Does the trust model collapse?**

### Q3: Cross-project moat authenticity
"Project A experience → auto-apply to Project B" is Engram's claimed core value.
But guardrails/constraints are strongly project-scoped (e.g., "~/.compost forbids iCloud").
**Is cross-project reuse hit rate actually far lower than claimed? Is the moat illusory?**

### Q4: v3.4 suggest_ingest marginal value
Engram detects recall_miss → async notifies Compost to ingest.
But Compost already has observe hook + file watch + web fetch (3 input paths).
**What's the marginal value of Engram's miss signal? Would the ~50 LoC be better spent on v3.3 WAL audit?**

### Q5: Dual-stack user cost vs benefit
User maintains 2 DBs, 2 MCP servers, 2 CLIs, 2 CI rule sets.
**Is the debt higher than the benefit? Should Compost just absorb Engram's working memory role (unified stack)?**

## Participant Focus Areas

- **Opus**: Long-term maintenance cost (10-year horizon)
- **Codex**: Implementation boundaries (SQLite/FTS5/WAL details)
- **Sonnet**: User mental model (trust signals, UX coherence)
- **Gemini**: Ecosystem position (vs LycheeMem / GBrain / Letta)

## Output Contract

Each participant must give **SUPPORT / REJECT / MODIFY** verdict per question, with:
- Reasoning (特别 focus to their area)
- If REJECT/MODIFY: concrete alternative

Round 2: each rebuts the strongest counter-argument from Round 1.

Final synthesis: tally votes, if ≥3 questions challenged → produce revised roadmap v2.
