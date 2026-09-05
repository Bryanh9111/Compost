# Compost

A local metacognitive action ledger, artifact index, coverage audit and query router for work across tools. Engram owns durable atomic knowledge; Compost records actions and points to their evidence.

## What it does

Compost captures supported tool events and explicit file/URL ingestion, keeps durable action and artifact pointers, and provides keyword and optional semantic retrieval. Its short-lived content cache can expire while action history survives. The current v4 direction freezes background reasoning, wiki and verdict production; see [ROADMAP](docs/ROADMAP.md).

Three product guarantees: **Fresh** (active freshness loop for web sources), **Trustworthy** (provenance tracking from source to fact), **Auditable Coverage** (measurable SLO, not a promise of completeness).

## Quick start

```bash
# Requirements: bun >= 1.3, uv (Python), ollama (for embeddings)
git clone https://github.com/Bryanh9111/Compost.git
cd Compost
./scripts/install.sh

# Pull embedding model
ollama pull nomic-embed-text:v1.5

# Ingest a local file (with embeddings)
compost add path/to/notes.md

# Ingest a web URL
compost add https://example.com/docs/page.html

# Hybrid query (BM25 + semantic search)
compost query "how does the auth system work"

# LLM-powered answer (retrieves facts + wiki, synthesizes via local LLM)
compost ask "what is the observe outbox pattern"

# Manual read-only metacognitive pattern report over action_log
compost patterns "this week"

# Start the daemon (drain loop + reflect + freshness loop).
# MCP clients should use `compost mcp`; `daemon start --with-mcp` is foreground-only.
compost daemon start

# Health check
compost doctor --reconcile
compost doctor --rebuild L1
```

## Architecture

```
                    +-----------+
                    |  Sources  |
                    +-----+-----+
                          |
          +-------+-------+-------------------+-------------+
          |       |          |                 |
      local file  web URL  zsh/git/Obsidian   Claude Code hook
          |       |         capture           |
          v       v             v             v
    +--------------------------------------+
    |             observe_outbox           |  <- single DB transaction boundary
    +------------------+-------------------+
                  | drain
                  v
    +-------------+---------------+
    |      observations (L0)      |  <- immutable provenance ledger
    +-------------+---------------+
                  | Python extract
                  v
    +------+------+------+--------+
    |  chunks (L1)  |  facts (L2) |  <- structured knowledge
    +------+--------+------+------+
           |               |
     LanceDB ANN      SQLite FTS5
           |               |
           +-------+-------+
                   | RRF merge
                   v
    +--------------+---------------+
    |     Stage-2 SQLite rerank    |  <- w1 semantic + w2 temporal + w3 access + w4 importance
    +--------------+---------------+
                   |
           +-------+-------+
           |               |
     compost.query    compost.ask
      (ranked hits)   (LLM synthesis)
```

### Four layers + control plane

| Layer | What | Storage | Phase |
|-------|------|---------|-------|
| **L0** | Provenance ledger | SQLite (append-only observations) | 0 |
| **L1** | Vector + keyword index | LanceDB (ANN) + SQLite FTS5 (BM25) | 1-2 |
| **L2** | Structured facts | SQLite (subject-predicate-object triples) | 1 |
| **L3** | Historical wiki synthesis | Markdown on disk + wiki_pages table; background rebuild frozen by default in v4 | 2 |
| **L4** | Metacognitive daemon | Drain, ingest, reflect, freshness, backup, graph-health; action capture expansion | 2+ |

### Hybrid retrieval (Phase 2)

- **Stage-0a**: BM25 keyword search via SQLite FTS5 (always available, zero external deps)
- **Stage-0b**: Semantic search via LanceDB ANN (optional, degrades gracefully)
- **RRF merge**: Reciprocal Rank Fusion combines both candidate sets
- **Stage-2**: SQLite rerank with multi-factor formula (semantic + temporal decay + access frequency + importance)

BM25 works independently when LanceDB is unavailable -- no single point of failure for search.

## Cognitive model

| Tier | What | Lifecycle |
|------|------|-----------|
| Sensory buffer | Raw observations < 7 days | Hard-deleted by `reflect` |
| Working memory | Recently accessed facts | Stateless decay at query time |
| Semantic memory | Extracted facts with importance | Soft-tombstoned when decayed |
| Episodic memory | Event records (Phase 3) | Append-only links |
| Procedural memory | Skills and procedures (Phase 4) | Never forgotten |

Decay formula: `score = importance * 0.5^((now - last_reinforced) / half_life)`

Computed at query time (stateless), never by background jobs.

## Claude Code integration

Compost hooks into Claude Code's event system to passively capture tool usage, session context, and conversation signals:

```json
{
  "hooks": {
    "SessionStart": [{ "command": "compost hook session-start" }],
    "PreToolUse": [{ "command": "compost hook pre-tool-use" }],
    "PostToolUse": [{ "command": "compost hook post-tool-use" }]
  }
}
```

Hook cold-start: p95 < 30ms on Apple Silicon (measured, not guessed).

## MCP tools

| Tool | Type | Phase | Description |
|------|------|-------|-------------|
| `compost.observe` | notification | 0 | Write observations (adapters use this) |
| `compost.query` | tool | 1-2 | Hybrid search with ranked results |
| `compost.ask` | tool | 2 | LLM-synthesized answers from facts + wiki |
| `compost.reflect` | tool | 0 | GC + tombstone + outbox prune |
| `compost.feedback` | tool | 1 | Mark result_selected for ranking tuning |

## Project structure

```
packages/
  compost-core/            # Pure library: schema, ledger, queue, query, ranking, embedding, storage, reflect
  compost-daemon/          # Long-running process: MCP server, drain loop, reflect/freshness scheduler
  compost-cli/             # CLI: add, query, ask, capture, cover, route, did, reconcile, doctor
  compost-hook-shim/       # Fast cold-start hook for Claude Code (< 30ms p95)
  compost-ingest/          # Python extraction (markdown + web/trafilatura -> chunks + facts)
  compost-engram-adapter/  # Bidirectional channel to Engram: splitter, pending-writes, writer (Phase 5 S4)
```

## Tech stack

- **Runtime**: Bun (TypeScript) + Python (extraction only)
- **Storage**: SQLite WAL (ledger + facts + FTS5) + LanceDB (vector index)
- **Embedding**: nomic-embed-text-v1.5 via Ollama (768 dim, local)
- **LLM**: Ollama (local, zero cost) with pluggable API fallback
- **Search**: Hybrid BM25 + ANN with RRF fusion
- **Web extraction**: trafilatura (Python)

## Phase roadmap

Post-2026-04 calibration reorganized the phases around the **self-evolution
ladder** (L1 → L6) rather than "portability / ecosystem" thinking. See
`docs/ROADMAP.md` for the product-identity anchor.

| Phase | Level | Capability | Status |
|-------|-------|-----------|--------|
| **0** | L1 | Encoding + Storage | **Done** -- ledger, drain, queue, reflect, hook, CLI |
| **1** | L1 | Semantic retrieval | **Done** -- LanceDB embeddings, real query results, ranking |
| **2** | L2 | Hybrid search + web + LLM | **Done** -- BM25+ANN, temporal decay, web ingest, wiki synthesis, compost.ask |
| **3** | L3 | Consolidation | **Done** -- contradiction arbitration, wiki rebuild+versioning, LLM fact extraction, multi-query expansion |
| **4** | L3 | Fork-ready personal brain | **Done** -- PII redactor, bench, origin-hash, user model schema |
| **5** | L3↔L4 | Bidirectional Engram loop | **Done** -- read+write MCP transports, pending queue, engram-push / engram-pull / daemon auto-wire |
| **6 P0** | L4 | Autonomous exploration | **Done** -- gap tracker, digest push, wiki provenance JOIN, curiosity-agent MVP, user-approved crawl queue |
| **7** | L5 | Analytical partner | **Historical / frozen in v4** -- entry slice + verdict signal + hybrid scheduler shipped as trial path; background chain generation and dogfood routine are frozen. On-demand `compost ask` remains active; future pattern work moves to `action_log`. |
| 8 | — | Portability (descoped) | Export / import bundles — defer-on-demand |
| 9 | — | Ecosystem (descoped) | More adapters, multimodal metadata — defer-on-demand |

## Design decisions

Documented across 8 structured 4-way debates (Opus/Sonnet/Gemini/Codex). Key choices:

- **SQLite WAL** over Postgres -- local-first, zero ops, single-file backup
- **Outbox pattern** -- crash-safe event delivery with idempotent drain
- **Stateless decay** -- computed at query time, no background jobs
- **RRF fusion** -- rank-based merge of ANN + BM25, score-agnostic
- **Date-stamped policies** (`tp-YYYY-MM`) over semver -- honest about what changes mean
- **Python extraction boundary** -- separate runtime for ML/NLP, JSON stdin/stdout contract
- **BM25 as fallback** -- search works without LanceDB (graceful degradation)
- **Local-first LLM** -- Ollama default for wiki synthesis + ask + fact extraction, zero API cost
- **Heuristic contradiction arbitration** -- no LLM in reflect loop, avoids SQLite single-writer lock contention

## Documentation

- `docs/QUICKSTART.md` — 5-minute hands-on from clone to first query
- `docs/CONCEPTS.md` — L1-L6 self-evolution, provenance, decay, Compost ↔ Engram bridge
- `docs/ARCHITECTURE.md` — data flow, storage layers, failure modes
- `docs/ROADMAP.md` — v4 metacognitive baseline: background reasoning/wiki/verdict work is frozen; action-log capture, coverage audit, artifact routing, timeline retrospectives, missing-pointer reconciliation, and read-only deterministic pattern detection over `action_log` are live
- `docs/engram-integration-contract.md` — cross-repo contract with Engram (sibling project)
- `docs/compost-engram-boundary.md` — current no-monorepo baseline, allowed coupling, and boundary checks
- `docs/phase-5-open-questions.md`, `docs/phase-5-user-model-design.md` — Phase 5 pre-work
- `examples/01-local-markdown-ingest/`, `examples/02-web-url-ingest/`, `examples/03-mcp-integration/`
- Full v2 spec: `docs/compost-v2-spec.md`
- Debate records: `debates/001-022/` (022 = wiki-only digest shaping verdict; Phase 6 P0 slice 2)

## Verification

```bash
bun run test:coverage          # full suite; line coverage must be >=90%
bun run typecheck
bun run lint
bun run check:engram-boundary
uv run --project packages/compost-ingest pytest packages/compost-ingest/tests -q
```

The quality workflow runs these gates on pushes and pull requests. The coverage
gate uses weighted LCOV covered/total lines, not the console's average per-file percentage. CLI handler
integration tests run in-process for coverage, alongside subprocess lifecycle
and real Engram integration checks. Coverage describes exercised production
modules; external services are tested with bounded local fixtures.

For safe historical recovery and lifecycle reconciliation, see
[maintenance](docs/maintenance.md). Runtime counts come from the current schema,
MCP tools/list and test output rather than static README totals.

## License

MIT

See [search indexes](docs/search-indexes.md) for multilingual recall, index health, atomic rebuild and reproducible lexical evaluation.
