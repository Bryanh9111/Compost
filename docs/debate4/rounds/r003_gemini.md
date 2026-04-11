I will read the R2 files and the R3 brief to synthesize my final positions for Debate #4.
**Compost v2 Architecture — Round 3: FINAL POSITIONS (Ecosystem & Strategic)**

## Final Scores & Spec Requirements

| Decision | Score | Spec Requirement for `compost-v2-spec.md` |
| :--- | :---: | :--- |
| **A (Decay)** | **3/3** | Must include **Sensory Hard-GC** (7-day TTL) via `compost reflect`. |
| **B (Ranking)** | **2/3** | Lock `ranking_components` API in Phase 0; add `was_result_opened` to `ranking_audit_log` (Phase 1) for calibration. |
| **C (Layout)** | **2/3** | **Vertical Partitioning**: Shared `memory_id` + `facts` base + kind-specific extension tables + Unified UNION View. |
| **D (Hooks)** | **3/3** | **Synchronous Local Append**: Hook binary must write to outbox before returning success. |

---

## Q1: Semantic vs. Episodic (The Classification Default)

I support **Opus’s Single-Emit-with-Promotion** rule: Default to semantic; promote to episodic *only* if temporal AND participant metadata are present.

**Strategic Rationale**: With the convergence on **Decision C (Unified UNION View)**, the "discoverability" argument for dual-emission (Sonnet) vanishes. A query against the logical surface hits both tables. Dual-emission creates redundant vectors and row-bloat for zero gain in recall. Promoting based on metadata presence is the cleanest mapping to how agents actually "perceive" events versus "learning" facts.

## Q2: Sync Outbox vs. Async-True (The Durability Attack)

I **concede to Codex’s Durability Mandate**: The hook must perform a **Synchronous Local Append** to the `outbox.db`.

**Defense of Concession**: As the strategic voice, I cannot accept an architecture where the agent (Claude Code) receives a "success" signal for a memory that has not reached durable storage. If the hook binary crashes after returning `{async: true}` but before the write, we create a "Silent Amnesia" failure mode that is impossible to debug. 

**Cold-Start Mitigation**: The 50-200ms Node latency (Opus/Sonnet) is a **packaging problem**, not an architectural one. 
1. **Phase 0**: Use a thin Node shim. 
2. **Phase 1**: Move `compost hook` to a native static binary (Rust/Go) to hit the <5ms execution target. 
Durability is a non-negotiable primitive for a "Durable Shared Ledger."

---

## Strategic Tie-Break / Closing Stance

The Compost v2 ecosystem must be **Audit-First**. 
- I accept Sonnet’s **Calibration Signal** (`was_result_opened`): We cannot tune a 7-factor ranking engine without feedback loops. 
- I demand the **Ranking Trace** in Phase 0: If an agent cannot explain *why* it remembered a specific fact (via `ranking_components`), the memory system remains a black box.

By locking the vertical storage layout (C) and the synchronous hook contract (D) now, we ensure that Phase 0 isn't just a prototype—it’s the foundation of a multi-year memory ecosystem. 

**I am ready to finalize the spec.**
