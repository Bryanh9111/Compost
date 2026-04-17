# Compost

A self-evolving personal knowledge base. Ingests local files, web URLs, and AI tool events into a structured memory layer with hybrid semantic + keyword search, time-aware ranking, and LLM-powered synthesis.

## What it does

Compost watches what you read, write, and discuss across tools (Claude Code, local files, web pages), extracts structured facts, and makes them queryable with decay-based ranking. Knowledge fades like biological memory -- frequently accessed facts stay strong, unused ones decay.

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

# Start the daemon (MCP server + drain loop + reflect + freshness loop)
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
          +-------+-------+-------+
          |       |               |
      local file  web URL    Claude Code hook
          |       |               |
          v       v               v
    +-----+-------+-------+------+
    |       observe_outbox        |  <- single DB transaction boundary
    +-------------+---------------+
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
| **L3** | Wiki synthesis | Markdown on disk + wiki_pages table | 2 |
| **L4** | Evolution daemon | Freshness loop, reflect, future: curiosity agent | 2+ |

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
  compost-cli/             # CLI: add, query, doctor, hook, reflect, drain
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

| Phase | Capability | Status |
|-------|-----------|--------|
| **0** | Encoding + Storage | **Done** -- ledger, drain, queue, reflect, hook, CLI |
| **1** | Semantic retrieval | **Done** -- LanceDB embeddings, real query results, ranking |
| **2** | Hybrid search + web + LLM | **Done** -- BM25+ANN, temporal decay, web ingest, wiki synthesis, compost.ask |
| **3** | Consolidation | **Done** -- contradiction arbitration, wiki rebuild+versioning, LLM fact extraction, multi-query expansion |
| 4 | Active learning | Curiosity agent, gap tracker, autonomous crawl |
| 5 | Multi-host | Cross-machine sync, HTTP transport |
| 6 | Ecosystem | More adapters, PDF/code/video ingest |

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
- `docs/ROADMAP.md` — Phase 4 (shipped) → Phase 5 S4 (write path shipped) → S5 (read path next) → 6-8
- `docs/engram-integration-contract.md` — cross-repo contract with Engram (sibling project)
- `docs/phase-5-open-questions.md`, `docs/phase-5-user-model-design.md` — Phase 5 pre-work
- `examples/01-local-markdown-ingest/`, `examples/02-web-url-ingest/`, `examples/03-mcp-integration/`
- Full v2 spec: `docs/compost-v2-spec.md`
- Debate records: `debates/001-020/` (020 = Phase 5 S4 slicing verdict)

## Stats

- **~17K lines** of TypeScript + ~800 lines Python
- **416 tests**, 0 failures
- **15 SQL migrations** (observations, chunks, facts, wiki, outbox, fact_links, user-model schema shipped in 0015)
- **21 architecture debates** with 4 AI reviewers (`debates/001-020`)
- **3 transform policies** (local file, web content, LLM fact extraction)
- **Provenance**: 4 hashes per observation (content, raw, origin, idempotency)

## License

MIT
