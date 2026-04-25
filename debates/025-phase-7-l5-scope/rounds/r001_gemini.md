# Round 1 — Gemini — Debate 025

Compost stands at a crossroads between being a "very smart search engine" and a true "analytical partner." As we enter Phase 7, the architectural choices we make for Level 5 (L5) will define whether Compost has a "brain" or just a more complex "retrieval pipeline." My perspective is rooted in **Architectural Integrity** and **Product Identity**: L5 must be the layer where Compost transitions from *finding* information to *constructing* logic.

---

## Q1 (Architecture): (a) Graph-first

**Choice**: **(a) Graph-first**

**Reasoning**: L5's identity is "Synthesized Logic." If we choose Embedding-first (b) or RRF merge (c), we are effectively doubling down on L1-L3 retrieval paradigms. While ANN/FTS are powerful for recall, they are inherently "vibe-based" and lack the structural accountability required for reasoning. 

A "Graph-first" approach follows the `fact_links` (recursive CTE) to traverse logical relationships (contradiction, superseded, and the coming L5 `derived_from` links). This allows the system to provide a **traceable provenance chain** by construction. The "Con" listed in `context.md`—that link density is currently low—is actually a signal that L5's first job is to *populate* the graph with "semantic links" or "virtual links" derived from similarity. We don't solve a lack of logic by using more math (embeddings); we solve it by explicitly modeling the logic. This is the only path that supports the "Brain" identity.

## Q2 (MVP Slice): (α) Cross-fact reasoning

**Choice**: **(α) Cross-fact reasoning**

**Reasoning**: This is the "Architecture Proof." Pattern detection (β) is low-hanging fruit (as the `user_patterns` schema is already in `docs/phase-5-user-model-design.md`), but clustering facts by theme is a feature, not a reasoning shift. Hypothesis generation (γ) is too speculative without the engine. 

By starting with **Cross-fact reasoning**, we prove the L5 internal `ask()` loop and the graph traversal logic. It forces us to define what a "chain" looks like. If we can't prove that "Fact A + Fact B → Inference C" works structurally, the other sub-capabilities will be built on sand. (α) is the architectural anchor.

## Q3 (Storage / output shape): 选项 B — `reasoning_chains` table

**Choice**: **选项 B — 新 `reasoning_chains` 表**

**Reasoning**: This is a Conway’s Law decision. Where the output lands determines who "owns" it. 
- **(A)** Storing inferences in `facts` with `kind='hypothesis'` is a category error. A fact is a grounded observation; a hypothesis is a derived possibility. Mixing them will pollute the L1-L4 retrieval path with low-confidence noise. 
- **(C)** `decision_audit` is for *system events* (like `wiki_rebuild`), not for synthesis results. 
- **(D)** Writing to Engram as a first-class store for internal Compost logic is an architectural leak. Engram is the "sink"; Compost is the "thinker."

**Option B** establishes a dedicated schema (`chain_id`, `seed_fact_id`, `derived_facts JSON`, `llm_trace`). This allows L5 to own its invalidation logic. When a seed fact is updated, we can easily find and invalidate all `reasoning_chains` downstream. It preserves the sanctity of the "Ground Truth" ledger while allowing for a rich, queryable "Reasoning" layer.

## Q4 (Triggering): (r) Hybrid

**Choice**: **(r) Hybrid**

**Reasoning**: An "analytical partner" is proactive. If Compost only reasons when I ask it to, it’s just an on-demand tool (L3). The `r` model allows the **reflect daemon** to identify high-value "gaps" (e.g., clusters with high `ask_count` from `packages/compost-core/src/cognitive/gap-tracker.ts`) and run background reasoning. 

This creates the "partner" experience: I open Compost, and it says "I noticed you've been asking about X, so I synthesized a possible connection to Y." On-demand (q) is too passive; pure scheduled (p) is too expensive. Hybrid is the only model that balances product proactivity with the HC-2 (Zero-LLM cost) constraints for the hot path.

## Q5 (L5 internal ask 信号语义): 选项 Z — 新增 `kind='ask_gap'` 写 `decision_audit`

**Choice**: **选项 Z — 新增 `kind='ask_gap'` 写 `decision_audit`**

**Reasoning**: I am re-asserting my deferred position from Debate 023. L5 reasoning is the highest-level "decision" the system makes. If L5 runs an internal `ask()` and hits a gap, we need to know *why* the reasoning failed. 

Using **Option Z** (Migration 0018) to expand `AuditKind` is the right long-term move. It provides a structured audit trail for "What did the brain look for and fail to find?" This is different from a user ask; it's a **Reasoning Audit**. While Codex (Debate 023) argued this was too much for a P0 slice, we are now in the Phase 7 "Entry Gate." We should not build the reasoning engine without a paper trail. It's time to pay the "schema debt" to get the right telemetry.

---

## Cross-critique: Against Codex's likely "Minimalist Storage" pick

I anticipate Codex (and possibly Sonnet) will argue for **Option A** (putting hypotheses in the `facts` table) or **Option X** (muting L5 gaps) to minimize schema churn. 

**Attack**: This is a classic "YAGNI Trap" that leads to long-term architectural rot. 
1.  **Pollution**: If we put hypotheses in `facts` (`context.md:Q3-A`), we force every L1-L4 query to filter out `kind='hypothesis'`. It turns our "Ground Truth" ledger into a "Messy Guess Ledger." 
2.  **Telemetry Blackout**: If we choose **Option X** for Q5 (muting internal asks), we lose the most valuable signal for the "Curiosity" loop. If the L5 engine tries to connect Fact A and Fact B but finds a missing link, *that missing link is the highest-priority target for future ingestion*. Muting it (as proposed in `ask.ts:168`) is like a brain that forgets it's curious.

Minimalism in Phase 7 is actually "Architecture Avoidance." We are building an analytical partner; it needs its own space to think (Q3-B) and its own way to record its struggles (Q5-Z).

---

## The "Sixth Option": Virtual Semantic Links (The Link Populator)

The `context.md` notes that `fact_links` density is low. Instead of just picking (a) or (b), the true L5 MVP should include a **Link Populator**. This is a background task that identifies "Semantic Links" (similarities > 0.8) and writes them into `fact_links` with `kind='semantic_bridge'`. 

This solves the Q1 Graph-first "Con" by *building* the graph that the reasoning engine needs to traverse. It bridges the gap between ANN-vibe-retrieval and structural-graph-reasoning.

---

## TL;DR (3 lines)
- **Architecture**: **(a) Graph-first** reasoning over a dedicated **(B) `reasoning_chains`** table to ensure logic is traceable and isolated from ground-truth facts.
- **Implementation**: MVP with **(α) Cross-fact reasoning** using a **(r) Hybrid** trigger to prove the "proactive analytical partner" identity.
- **Telemetry**: Pay the schema debt now—add **(Z) `ask_gap` audit** to record reasoning failures; traceability is the prerequisite for trust.
