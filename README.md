# Compost

A local-first personal knowledge base that ingests markdown, code context, and AI tool events into a structured memory layer with decay-based recall.

## What it does

Compost watches what you read, write, and discuss across tools (Claude Code, local files, future adapters), extracts structured facts, and makes them queryable with time-aware ranking. Knowledge decays like biological memory -- frequently accessed facts stay strong, unused ones fade.

## Architecture

```
observe -> outbox -> drain -> observations (L0)
                                  |
                           extract (Python)
                                  |
                           facts (L2) + chunks (L1)
                                  |
                           query (decay + ranking)
```

- **L0 Ledger** -- immutable observation log in SQLite (WAL mode)
- **L1 Chunks** -- text segments for vector search (Phase 1: LanceDB)
- **L2 Facts** -- structured subject-predicate-object triples with confidence and importance
- **L3 Wiki** -- synthesized knowledge pages (Phase 2+)

## Quick start

```bash
# Requirements: bun, uv (Python)
./scripts/install.sh

# Ingest a file
compost add path/to/notes.md

# Start the daemon (MCP server + drain loop + reflect scheduler)
compost daemon start

# Query (Phase 0 returns [] stub; Phase 1 enables semantic search)
compost query "how does the auth system work"

# Manual reflection (sensory GC + decay tombstone)
compost reflect

# Health check
compost doctor --reconcile
compost doctor --measure-hook
```

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

## Cognitive model

| Tier | What | Lifecycle |
|------|------|-----------|
| Sensory buffer | Raw observations < 7 days | Hard-deleted by `reflect` |
| Working memory | Recently accessed facts | Stateless decay at query time |
| Semantic memory | Extracted facts with importance | Soft-tombstoned when decayed |
| Episodic memory | Event records (Phase 3) | Append-only links |
| Procedural memory | Skills and procedures (Phase 4) | Never forgotten |

Decay formula: `score = importance * 0.5^((now - last_reinforced) / half_life)`

## Project structure

```
packages/
  compost-core/        # Pure library: schema, migrations, ledger, queue, query, reflect
  compost-daemon/      # Long-running process: MCP server, drain loop, scheduler
  compost-cli/         # User-facing CLI: add, query, doctor, hook, reflect, drain
  compost-hook-shim/   # Fast cold-start hook for Claude Code integration
  compost-ingest/      # Python extraction subprocess (markdown -> chunks + facts)
```

## Phase roadmap

| Phase | Capability | Status |
|-------|-----------|--------|
| **0** | Encoding + Storage | **Done** -- ledger, drain, queue, reflect, hook, CLI |
| 1 | Semantic retrieval | Next -- LanceDB embeddings, real query results |
| 2 | Temporal + wiki | Decay ranking, wiki synthesis, `compost ask` |
| 3 | Consolidation | Episodic links, contradiction arbitration |
| 4 | Active learning | Curiosity agent, gap tracker |

## Design decisions

Documented across 6 structured debates with multiple AI reviewers. Key choices:

- **SQLite WAL** over Postgres -- local-first, zero ops, single-file backup
- **Outbox pattern** -- crash-safe event delivery with idempotent drain
- **Stateless decay** -- computed at query time, no background jobs
- **Date-stamped policies** (`tp-YYYY-MM`) over semver -- honest about what changes mean
- **Python extraction boundary** -- separate runtime for ML/NLP, JSON stdin/stdout contract

Full spec: `docs/compost-v2-spec.md`

## License

MIT
