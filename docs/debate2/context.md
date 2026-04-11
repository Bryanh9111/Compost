# Debate #2: D3 runtime + transform_policy convention

**Debate ID**: 002-d3-policy
**Priority**: Maintainability (inherited from debate #1)
**Rounds**: 1 (focused final pass)
**Context**: This is a follow-up to debate #1 (`001-kb-fusion-architecture`). Core architecture already agreed. Project name decided as `Compost`. Only these two items remain open.

## Background

A self-evolving knowledge fusion memory system called **Compost**. Absorbs user-provided sources + passive host sniff + autonomous crawl. Layered architecture (L0 ledger → L1 vector → L2 facts → L3 wiki → L4 daemon). MCP server for consumer agents. `~/.compost/` portable data dir.

**Architecture already decided (don't re-debate these):**
- stdio MCP + adapter-local `observe_outbox` for durability
- Local markdown week 1 → web URL week 2 (both via claude-code adapter)
- `Compost` as project name
- L0 stores raw_bytes + transform_policy + derivations table
- "Complete" reframed as "Auditable Coverage" SLO
- Dual deployment: Daemon mode (long-running) + Embedded mode (imported into host process)
- Context-based partitioning (multi-valued contexts[] on facts)

## Open Question #1: D3 — Hybrid vs Pure Node/Bun

Debate #1 result: 3-1 for hybrid.

**Majority position (Codex R2 conceded, Sonnet R1+R2, Opus R1):**
- Node/Bun owns Core, MCP server, adapters, query, L4 scheduler, LanceDB, SQLite access
- Python owns `compost-ingest/` ONLY as a subprocess CLI called from Node
- Hard boundary: one sentence ownership rule, JSON over stdin/stdout contract
- Guardrails: `uv.lock` committed, schema contract test on every Python dep bump, `install.sh` runs both `bun install` and `uv sync`
- Rationale: Python's extraction ecosystem (docling, unstructured, tree-sitter bindings, trafilatura) is materially better today than Node's. Subprocess boundary is a clean process boundary, same pattern as calling ffmpeg/ripgrep from Node

**Minority position (Gemini R2 doubled down):**
- Pure Node/Bun. Single-binary distribution story is the most strategic asset.
- Python's packaging (pip/venv/conda) is "three horsemen of developer friction"
- Forking Node + Python doubles support surface and halves activation rate
- WASM/Rust-backed modules (`pdf.js`, tree-sitter Node bindings, Rust extractors) will catch up by 2031
- User will have to troubleshoot `libpoppler` compile failures just to ingest a web page — lost the maintainability battle

**The user's actual constraints:**
- Personal system, 1-3 machines, solo maintainer
- Must clone to new machine and keep working (cross-machine portability)
- Priority: maintainability over everything else
- Maintainer already has Python + Node/Bun environments set up
- Must ship soon (Phase 0 is one week)
- Current state (2026-04): docling/unstructured are the only production PDF/mixed-format extractors; pdf.js is a renderer not structural parser; tree-sitter has good Node bindings

**Your task (all four participants):**
State a firm position: hybrid or pure Node/Bun. If hybrid, define the exact boundary. If pure Node, name specific current-state replacements for docling (PDFs with tables/formulas), unstructured (mixed docs), trafilatura (web boilerplate removal). "WASM will solve it" is not an answer for code that ships next week. No mealy-mouthed "it depends."

## Open Question #2: transform_policy Version Convention

Background: every L0 observation row is tagged with a `transform_policy` identifier. A transform_policy encapsulates chunk size/overlap, embedding model ID, fact extraction prompt version, wiki synthesis prompt version, dedup thresholds, and normalization rules. Policies are immutable — a schema change requires a new policy entry, never a mutation of an existing one. The policy registry lives in `packages/compost-core/src/policies/registry.ts`.

**Current spec default (§2 of phase0-spec.md):**
- Format: `tp-YYYY-MM[-NN]` where NN is in-month revision counter
- Examples: `tp-2026-04`, `tp-2026-04-02`, `tp-2026-05`
- Rationale: date-stamp communicates "these are different configurations active in a time range" without implying "newer is better"
- Immutable once shipped; ingested rows reference specific policy and use it on replay

**Alternatives to consider:**
- **Semver**: `tp-1.0.0`, `tp-1.1.0`, `tp-2.0.0`. Communicates compatibility (major bump = incompatible rebuild required, minor = backward-compat). But what does "backward-compat" even mean for a policy that's consumed by a replay engine? Arguably nothing.
- **Git SHA**: `tp-a3f8b21`. Exact reproducibility, no naming convention to maintain. But cryptic in daily ops, and a policy is conceptually a config not code — it lives in a JSON/TS registry, not in the git history of any single file.
- **Date-stamp**: current recommendation. Honest about intent, easy to read, works for solo dev.
- **Other**: propose if you have a better idea.

**Your task:**
Pick one. Argue for it. One paragraph max per participant.

## Output Format

Each participant writes to their own file under `rounds/`. Max 400 words total (both questions combined). No preamble, no "it depends," no "multiple considerations." Take positions.
