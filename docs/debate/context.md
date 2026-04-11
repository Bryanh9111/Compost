# Debate: Self-evolving Knowledge Fusion Reasoning System

**Debate ID**: 001-kb-fusion-architecture
**Rounds**: 2 (initial positions + cross-critique rebuttal)
**Style**: cross-critique, adversarial tone
**Advisors**: gemini, codex, sonnet, claude-opus
**Goal**: Make technical decision on 3 options + architecture go/no-go
**Priority**: Maintainability (long-term reliability, portability, evolvability)

## System Goal

A single cross-context knowledge base that:
1. Absorbs knowledge from user-provided sources (active push)
2. Passively captures from host-agent conversations (Claude Code, OpenClaw, Hermes, airi)
3. Autonomously crawls subscribed sources to stay current (no user input required)
4. Serves other agents via MCP for daily reasoning/retrieval
5. Must guarantee: FRESH, TRUSTWORTHY, COMPLETE knowledge

## Three Pending Decisions

### Decision 1: Host Adapter ↔ Core transport (Daemon mode)
- (a) stdio MCP — reuses existing ecosystem, adapter-as-MCP-server, native Claude Code
- (b) Unix domain socket + custom JSON protocol — faster locally, bespoke
- (c) HTTP + SSE — cross-machine, heaviest

Context: Embedded mode uses direct function calls, transport only matters for Daemon.

### Decision 2: Phase 1+3 first deliverable
- (a) local markdown + claude-code adapter (passive sniff) — fastest closed loop
- (b) web URL + claude-code — validates freshness/crawl earlier
- (c) local markdown + generic MCP — defers real adapter work

### Decision 3: Core runtime language
- (a) Node/Bun — native to claude-code ecosystem, LanceDB bindings, Bun single-binary
- (b) Python — richer ML/extraction toolchain (docling, unstructured, tree-sitter, haystack)
- (c) Hybrid — Python for ingest, Node for Core+MCP

## Proposed Architecture

**Layers:**
- L0: Provenance Ledger (SQLite append-only, source of truth, rebuild anchor)
- L1: Vector+BM25 (LanceDB) — coarse recall
- L2: Facts graph (SQLite triples with contexts[], confidence, freshness, provenance_id)
- L3: LLM-maintained markdown wiki — human-readable synthesis
- L4: Evolution Daemon — TTL refetch, contradiction arbitration, coverage audit, autonomous crawl
- Reasoning synthesis layer — multi-path fusion, returns answers with provenance+confidence+freshness

**Three ingest paths (one write pipeline):**
1. Active push: `kb add`, `kb watch`
2. Passive sniff: Host Adapters → `kb.observe` events
3. Autonomous crawl: L4 daemon scheduled refetch + gap-fill

**Two deployment modes (one kb-core library):**
- Mode A Daemon: kb-core + MCP server, adapters connect via IPC
- Mode B Embedded: kb-core imported into host, direct function calls

**Partitioning:** context-based (semantic labels, multi-valued), NOT scope-based. One fact → many contexts. Queries filter/weight by context.

**Portability:** `~/.kb/` = plain files (SQLite + markdown + LanceDB dir). No absolute paths (logical vars $REPOS/$HOME). Git-clonable. `kb relearn` re-subscribes local sources on new machine.

**Quality guarantees:**
- Fresh: TTL + content-hash diff + stale marking
- Trustworthy: provenance on every fact + confidence + contradiction arbitration (newer > higher-confidence > multi-source > conflict flag)
- Complete: gap detection via query failures + coverage audit + autonomous gap-fill

## Stress-Test Questions for the Debate

1. Is L0-L4 coherent or over-engineered? Could a simpler design deliver the three guarantees?
2. Is "provenance ledger as ground truth" correct, or does it create rebuild complexity?
3. Dual-mode (Daemon + Embedded) — worth the complexity, or pick one?
4. Is context-based partitioning enough, or need another axis (trust level, temporal epoch)?
5. Is autonomous crawl realistic or hand-wavy? How does it ground itself?
6. Biggest hidden risk that kills this 6 months in?

## Debate Rules

- Each participant picks sides. Minority gets airtime.
- Challenge aggressively. No mealy-mouthed "it depends" answers.
- Force positions on all three decisions.
- End with: consensus, disagreements, recommended choice for each decision, top 3 architectural risks to mitigate before Phase 0.
