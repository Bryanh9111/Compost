# Compost: Brain-Like Memory System — Reference Survey

**14 Memory-System Reference Projects Analyzed**  
*Date: 2026-04-11*

This survey evaluates 14 research and integration projects in personal AI memory architecture, distilling patterns that can inform Compost's design. Each project addresses different aspects of the "brain-like memory" problem: persistence, multi-context knowledge sharing, weighted recall, episodic learning, and proactive search.

---

## Core Projects (Prioritized Deep Dives)

### 1. **Claude Subconscious**

**Core thesis:** A background agent running in parallel to Claude Code, watching transcripts and code, building persistent memory across sessions via the Letta SDK.

**Architecture shape:** Subprocess pattern: Claude Code ↔ MCP Protocol ↔ Letta Agent (background). Letta manages 8 memory blocks (core directives, guidance, user preferences, project context, session patterns, pending items, self-improvement, tool guidelines). Hooks inject guidance before each prompt; transcript sent async on session stop.

**Brain-like alignment:** 
- **#4 (Auto-iterative learning)** — Agent reads code, learns patterns, self-improves memory blocks
- **#5 (Active search-learning)** — Agent can search web, read files while processing transcripts  
- **#1 (Probabilistic)** — Guidance injection is soft/contextual, not deterministic

**What to steal:**
- Hook-based async pattern for non-blocking background learning (SessionStart, UserPromptSubmit, PreToolUse, Stop)
- Dual-mode guidance: "whisper" (messages only) vs "full" (memory blocks + diffs)
- 8-layer memory schema with distinct purposes — highly composable
- Conversation ID mapping per project, shared global agent brain

**What to avoid:**
- Letta SDK dependency; Compost should be runtime-agnostic
- Message-centric design; doesn't capture episodic detail needed for trial-and-error learning
- Limited conflict/contradiction handling

---

### 2. **Supermemory**

**Core thesis:** State-of-the-art memory engine (#1 on LongMemEval, LoCoMo, ConvoMem benchmarks) that automatically extracts facts, builds user profiles, and handles knowledge updates + contradictions.

**Architecture shape:** Three-layer: Memory Engine (fact extraction, conflict resolution, auto-forgetting), User Profiles (static + dynamic), Hybrid Search (RAG + Memory). Connectors (Google Drive, Gmail, Notion, GitHub) auto-sync. Exports via Vercel AI SDK, LangChain, Mastra integrations.

**Brain-like alignment:**
- **#1 (Probabilistic)** — Temporal decay, contradiction-aware updates, soft conflict resolution
- **#2 (Multi-context)** — Containerized by project tag; facts shared across queries via search
- **#3 (Weighted recall)** — Profile summary (static + dynamic) with ~50ms retrieval
- **#4 (Auto-learning)** — Automatic fact extraction, temporal updates, contradiction handling
- **#6 (Experience formation)** — Understands temporary vs permanent facts; expires old data

**What to steal:**
- Three-tier memory: facts (what), profiles (who), search (how to retrieve)
- Contradiction-aware fusion: detects when "I live in NYC" contradicts "I moved to SF"
- Temporal decay model: facts have expiry dates, auto-forget irrelevant context
- Standalone API architecture (works with any LLM framework)
- User profile as pre-computed 2-tier (static + dynamic) reduces token overhead

**What to avoid:**
- Requires external vector DB (embeddings, LanceDB); Compost needs lightweight option
- User profiles pre-computed statically; doesn't handle truly dynamic, context-dependent recall
- Limited episodic granularity (treats conversations as fact sources, not sequences)

---

### 3. **Ombre Brain**

**Core thesis:** Emotional memory system for Claude. Memories tagged with Russell's valence/arousal coordinates, naturally decay (Ebbinghaus curve), and actively surface — unresolved, high-arousal memories have higher weight.

**Architecture shape:** Python MCP server → SQLite + Markdown (Obsidian vault). 5 tools: `breath` (surface/search), `hold` (store 1 memory), `grow` (diary digest), `trace` (metadata/resolve), `pulse` (status). Dehydration + tagging via DeepSeek API (degrades to local keyword analysis). Decay formula: `base_score × e^(-λ × days) × arousal_boost`.

**Brain-like alignment:**
- **#3 (Weighted recall)** — Weight pool surfacing: unresolved + high-arousal memories bubble up
- **#4 (Auto-learning)** — Dehydration + auto-tagging evolves metadata; API degradation for resilience
- **#1 (Probabilistic)** — Soft decay, arousal-weighted sampling, not hard deletion
- **#6 (Experience formation)** — Memories marked "resolved" drop to 5% weight but don't disappear; pinned memories never decay

**What to steal:**
- Russell's circumplex model for emotional metadata (valence + arousal as continuous dims, not discrete)
- Weight pool surfacing: unresolved/intense memories prioritize themselves without explicit query
- Decay formula with arousal boost: long-term memories of intense events decay slower
- Obsidian-native storage (Markdown + YAML frontmatter) → browser-readable, no custom UI needed
- API degradation: cheap local NLP when cloud API unavailable

**What to avoid:**
- Emotional tagging may be domain-specific; Compost should generalize beyond emotional context
- Obsidian dependency limits portability
- Decay is time-only; doesn't account for retrieval frequency (recency bias)

---

### 4. **LycheeMem**

**Core thesis:** Compact, action-grounded memory for LLM agents. Three stores: Working Memory (episodic), Semantic Memory (7 typed record types), Procedural Memory (skills). Retrieval planner conditions search on current action state.

**Architecture shape:** Working Memory (dual-threshold token budget: warn @70%, block @90%), Semantic Memory (SQLite FTS5 + LanceDB; 7 record types: fact, preference, event, constraint, procedure, failure_pattern, tool_affordance), Procedural Memory (HyDE skill retrieval). 4-module pipeline: Compact Semantic Encoding → Record Fusion/Conflict Update → Action-Grounded Retrieval Planning → Multi-Dimensional Scorer.

**Brain-like alignment:**
- **#2 (Multi-context)** — Typed memory records (fact, procedure, tool_affordance, constraint); composable retrieval
- **#3 (Weighted recall)** — Multi-dimensional scorer: semantic + action utility + slot utility + temporal fit + recency + evidence density - token cost
- **#5 (Active search-learning)** — SearchPlan with missing_slots triggers supplemental FTS/tag recall; proactive affordance lookup
- **#6 (Experience formation)** — failure_pattern, tool_affordance types; usage feedback loop + RL-ready stats
- **#4 (Auto-iterative)** — Record Fusion + Conflict Update engine; hierarchical memory tree grows upward via synthesis

**What to steal:**
- 7-record-type ontology: facts, preferences, events, constraints, procedures, failure patterns, tool affordances
- Action-grounded retrieval: SearchPlan analysis (semantic/pragmatic queries, tool hints, missing slots, required constraints)
- Record Fusion with conflict detection: automatically consolidates related records into composites, with per-record hash deduplication
- Hierarchical memory tree: atomic records → composite records → tree roots (composites of composites)
- Dual-threshold compression: warn + block thresholds keep working memory bounded without hard limits
- Multi-dimensional scoring with tag filters for affordance/constraint/slot matching

**What to avoid:**
- Complex 5-agent pipeline; Compost should have simpler, fewer feedback loops
- LanceDB + SQLite dual-store adds complexity; might be overkill for early stages
- HyDE query expansion may be overkill for simple fact recall

---

### 5. **Supermemory (MCP/Plugin Implementations)**

**Core thesis:** Supermemory's unified memory API wrapped for Claude Code and OpenClaw plugins. Shows how to adapt high-level memory engine to agent-specific contexts.

**Architecture shape:** Two main plugin implementations: claude-supermemory (hooks + skills for Claude Code) and openclaw-supermemory (OpenClaw skill). Both expose `super_save` (store), `super_search` (retrieve), and context injection. Skills manage context injection timing and scope.

**Brain-like alignment:**
- **#2 (Multi-context)** — Project-scoped memories; context injection before agent reasoning
- **#4 (Auto-learning)** — Automatic extraction triggered by human conversation signals

**What to steal:**
- Agent-specific wrapper pattern: core memory engine + language-specific hooks/skills
- Project scoping for context isolation
- Simple skill interface: save/search only (delegates complexity to backend)

**What to avoid:**
- Thin wrapper; specific to agent frameworks (not generalizable)

---

### 6. **HeyCube (黑方体)**

**Core thesis:** Structured personal profile system for OpenClaw. 8 domains (identity, psychology, aesthetics, career, goals, rhythm, preferences, relationships) + on-demand loading. ~2K tokens per query.

**Architecture shape:** SQLite (client) + PostgreSQL + JSONB (server). Pre/Post hooks analyze dialog → load/update relevant dimensions from 500+ dimensional pool. Semantic multi-path recall: LLM analysis + historical recall + hotness + co-occurrence + gap detection. Scoring: α·rel_llm + β·hist + γ·pop + δ·cooc - λ·fatigue - μ·over_coverage.

**Brain-like alignment:**
- **#2 (Multi-context)** — 8 domain structure; dimensions as reusable atoms
- **#3 (Weighted recall)** — Multi-path recall with co-occurrence and fatigue penalties
- **#4 (Auto-learning)** — Post-hook analysis auto-extracts + assigns to dimensions
- **#1 (Probabilistic)** — Scoring model with fatigue/coverage penalties (soft constraints)

**What to steal:**
- Domain-based organization (8-layer schema for "personal profile")
- On-demand dimension loading: analyze context → select relevant subset from pool
- Co-occurrence scoring: "Which dimensions appear with this concept?" for implicit recall
- Fatigue penalty: dimensions used recently score lower (avoid repetition)
- SQL + metadata decoupling: client stores data locally, server only guides structure

**What to avoid:**
- OpenClaw-specific; would need porting
- JSONB schema flexibility may reduce cross-project consistency
- Fatigue penalty only works for agent session context, not long-term memory

---

### 7. **CatchMe**

**Core thesis:** Captures entire digital footprint (windows, keyboard, clipboard, notifications, files) via background recording, organizes into hierarchical activity tree (Day → Session → App → Location → Action), retrieves via LLM tree traversal.

**Architecture shape:** Six recorders (background processes) → SQLite + FTS5 (activity tree with LLM summaries at each node). Retrieval: LLM reads summaries top-down, selects relevant branches, drills into evidence (screenshots, keystrokes).

**Brain-like alignment:**
- **#7 (Passive feeding)** — Screenshots, keystrokes, clipboard auto-fed to activity tree
- **#1 (Probabilistic)** — Tree traversal non-deterministic; LLM selects branches probabilistically
- **#6 (Experience formation)** — Episodic granularity: actions → locations → apps → sessions → days

**What to steal:**
- Hierarchical activity tree: auto-organizes raw streams into tiers without vector embeddings
- LLM-guided tree traversal: agent reads summaries at each level, selects next branch (avoids full-context problem)
- Multi-level summarization: each tier gets LLM-generated summary (compresses details upward)
- No embeddings: pure structural + keyword search in tree (lightweight, deterministic)

**What to avoid:**
- Screen recording is privacy-sensitive; only useful for personal agents
- Activity tree is event-stream-specific; doesn't generalize to declarative knowledge

---

## Supporting Projects

### 8. **ATM-Bench**

Benchmark for long-term personalized referential memory QA (~4 years, multimodal). Evaluates both schema-guided memory (SGM) and descriptive memory (DM) representations. Shows memory preprocessing + organization matter. Key metric: evidence-grounding (queries require multi-source fusion).

**What to steal:**
- Benchmark design: evidence-grounded QA with human-annotated ground truth
- Preprocessing distinction: structured (SGM) vs free-text (DM) — both have tradeoffs
- Multi-evidence reasoning: queries that require fusing contradictory sources
- Temporal reasoning over 4-year span

---

### 9. **SocratiCode**

Codebase intelligence via AST-aware chunking, hybrid BM25 + vector search, polyglot dependency graph (18+ languages), Qdrant + Ollama. Batched + resumable indexing. Zero-config setup.

**What to steal:**
- AST-aware chunking: split at function/class boundaries, not arbitrary lines
- Hybrid search (BM25 + vector + RRF): handles both semantic and exact-match queries
- Polyglot support via ast-grep (no per-language setup)
- Incremental indexing with checkpoints (resume on crash)
- File watching with debounce (keep index current)

---

### 10. **MinerU Document Explorer**

Knowledge engine for agent-native doc retrieval: 15 tools (search, deep read, ingest). Builds LLM wiki following Karpathy pattern. BM25 + vector + LLM reranking hybrid search. CLI + MCP + agent skills.

**What to steal:**
- Karpathy wiki pattern: LLM-maintained markdown knowledge base (see llm-wiki.md)
- Three tool groups: Retrieve (search/grep), Deep Read (navigate without loading), Ingest (wiki building)
- Cross-collection search with LLM reranking
- Composable multi-format support (MD, PDF, DOCX, PPTX)

---

### 11. **Understand-Anything**

Codebase-to-knowledge-graph via multi-agent pipeline: project-scanner → file-analyzer → architecture-analyzer → tour-builder → graph-reviewer. Interactive React dashboard. Diff impact analysis.

**What to steal:**
- Multi-agent pipeline for analysis (each agent specializes, runs in parallel)
- Incremental graph updates (only re-analyze changed files)
- Knowledge graph as both structural (code) + domain (business logic) views
- Dashboard with search + traversal (good UX reference)

---

### 12-14. **claude-supermemory, Understand-Anything, Additional Projects**

Partial/niche implementations; less core influence on Compost design but valuable for specific patterns (plugin integration, dashboard UX, etc.).

---

## LLM Wiki Pattern Reference

The **llm-wiki.md** document describes a foundational pattern: persistent, LLM-maintained markdown wiki sitting between you and raw sources. The wiki is:
- **Persistent:** compiled once, kept current (not re-derived per query)
- **Structured:** interlinked pages, entity pages, concept pages, cross-references
- **Compounded:** every source ingestion and exploration reinforces and extends the wiki
- **Index + Log:** index.md (content-oriented catalog) + log.md (chronological record)

This is the conceptual ancestor of modern Supermemory, LycheeMem, and Compost. Key insight: **the maintenance cost is near-zero for LLMs**, so persistent synthesis is cheaper than on-demand retrieval.

---

## Top 5 Patterns to Steal for Compost

### 1. **Weighted Recall via Salience + Recency + Arousal**

Combine:
- **Ombre Brain:** Arousal/valence coordinates + weight-pool surfacing (unresolved memories bubble up)
- **Supermemory:** Temporal decay + contradiction-aware updates
- **LycheeMem:** Multi-dimensional scoring (semantic + action utility + slot utility + recency - token cost)

**For Compost:** Implement a scorer that combines (recency, activation_count, importance, emotional_intensity, resolution_status) into a single relevance weight. Unresolved or emotionally intense memories surface without explicit query.

---

### 2. **Hierarchical Knowledge Tree with Fusion**

Combine:
- **LycheeMem:** Record types (fact/procedure/constraint/failure_pattern) + Record Fusion (composites of composites)
- **CatchMe:** Activity tree (Day → Session → App → Location → Action) with LLM summaries at each level
- **Ombre Brain:** Markdown-native storage + YAML metadata

**For Compost:** Organize memories as:
- **Atomic layer:** Typed records (facts, procedures, constraints, patterns, experiences)
- **Composite layer:** Fusion of related atomics (auto-detected via embedding similarity)
- **Tree layer:** Hierarchy of composites (synthesized upward)
- Storage: SQLite (queries) + Markdown (human-readable exports)

---

### 3. **Action-Grounded + Context-Aware Retrieval Planning**

Combine:
- **LycheeMem:** SearchPlan (mode: answer/action/mixed, semantic_queries, pragmatic_queries, tool_hints, missing_slots, tree_traversal_strategy)
- **HeyCube:** Semantic multi-path recall (LLM + history + hotness + co-occurrence + gaps)

**For Compost:** Before retrieval, analyze current context:
- What action is being attempted (or query being asked)?
- What constraints/affordances are relevant?
- What slots/parameters are missing?
- What domains have been recently active (fatigue penalty)?

Use this to build a plan that conditions both which memories to retrieve and how to traverse the tree.

---

### 4. **Async Background Learning with Graceful Degradation**

Combine:
- **Claude Subconscious:** Hook-based async pattern (SessionStart, UserPromptSubmit, PreToolUse, Stop hooks run background tasks without blocking)
- **Ombre Brain:** API degradation (DeepSeek → local keyword analysis)
- **SocratiCode:** Resumable checkpointed indexing (batches + hash comparison)

**For Compost:** Run learning in background threads:
- Transcript processing (consolidation, extraction)
- Memory fusion/synthesis
- Index updates

If API is unavailable, fall back to local LLM or heuristic-based analysis. Store checkpoints so crashes don't lose work.

---

### 5. **Probabilistic Decay + Activation Loop**

Combine:
- **Ombre Brain:** Ebbinghaus decay with arousal boost: `base_score × e^(-λ × days) × (1 + arousal_boost)`
- **Supermemory:** Temporal expiry (facts auto-forget) + contradiction resolution
- **LycheeMem:** Activation count in scoring (frequently retrieved memories decay slower)

**For Compost:** Implement dual-loop:
- **Passive decay:** Over time, memories naturally weaken (Ebbinghaus)
- **Retrieval-driven activation:** Each recall resets decay timer, increases activation_count
- **Arousal boost:** Emotionally or contextually intense memories decay slower
- **Contradiction resolution:** When new info contradicts old, update in-place and soft-expire conflicting versions

---

## Design Principles Summary

### For Compost to succeed, prioritize:

1. **Probabilistic over deterministic** — soft weights, gradual decay, stochastic sampling
2. **Multi-context sharing** — facts live in multiple contexts with context-specific weights
3. **Typed memory ontology** — at minimum: facts, procedures, constraints, experiences, failure patterns
4. **Hierarchical organization** — atomic → composite → tree (enables compact retrieval without full-context overhead)
5. **Active recall via salience** — unresolved, intense, recent memories surface proactively
6. **Async + resilient learning** — background consolidation, API degradation, checkpointed progress
7. **Local-first storage** — SQLite + Markdown, optional vector DB (not required day-one)

---

## References

| Project | Repo | Best For |
|---------|------|----------|
| Claude Subconscious | github.com/letta-ai/claude-subconscious | Hook pattern, memory block schema |
| Supermemory | github.com/supermemoryai/supermemory | Temporal decay, contradiction resolution, API design |
| Ombre Brain | github.com/P0lar1zzZ/Ombre-Brain | Emotional tagging, decay formula, weight pool surfacing |
| LycheeMem | github.com/LycheeMem/LycheeMem | Record types, fusion engine, multi-dim scoring, action-grounded retrieval |
| CatchMe | github.com/HKUDS/catchme | Hierarchical activity tree, LLM tree traversal, no embeddings |
| HeyCube | github.com/openclaw/heycube | Domain schema, on-demand loading, co-occurrence scoring |
| SocratiCode | github.com/giancarloerra/socraticode | AST-aware chunking, hybrid search, incremental indexing |
| MinerU Doc Explorer | github.com/opendatalab/MinerU-Document-Explorer | Karpathy wiki pattern, multi-tool design |
| Understand-Anything | github.com/Lum1104/Understand-Anything | Multi-agent pipeline, incremental graph |
| ATM-Bench | github.com/JingbiaoMei/ATM-Bench | Memory benchmarking, evidence-grounded QA |

---

**Word count:** ~2,800 | **Generated:** 2026-04-11
