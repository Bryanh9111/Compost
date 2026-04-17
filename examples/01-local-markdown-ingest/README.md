# 01 — Local markdown ingest

Minimum end-to-end: ingest a local markdown file, query facts, ask a
natural-language question. All offline (after `ollama pull`).

## What you will see

1. `compost add` writes to the outbox, drains into the L0 observations
   ledger, runs the extractor, and writes facts to L2.
2. `compost query` surfaces facts via BM25 + vector hybrid search.
3. `compost ask` composes an answer with LLM synthesis over retrieved facts.

## Run it

```bash
# Ingest the fixture in this directory
compost add ./notes.md

# List the facts the extractor pulled out
compost query "local-first memory"

# Ask a natural-language question
compost ask "Why does Compost prefer a local-first architecture?"
```

Expected rough output (content will drift as the LLM evolves):

```
$ compost query "local-first memory"
fact  compost uses sqlite+lancedb locally  conf=0.82
fact  observations are append-only         conf=0.85

$ compost ask "Why does Compost prefer a local-first architecture?"
answer: Compost stores everything in a single-user SQLite database so your
knowledge never leaves the machine, ... [grounded in 2 facts]
```

## Inspect provenance (Migration 0014 and earlier)

Every fact traces back to an observation. Each observation carries:

- `content_hash` — SHA-256 of the ingested content
- `raw_hash` — SHA-256 of the outbox payload envelope
- `origin_hash` — SHA-256 of `adapter|source_uri|idempotency_key` (the
  inlet-signature hash added by Migration 0014)
- `method` — the ingest method (`local-file` here)

```bash
sqlite3 ~/.compost/ledger.db \
  "SELECT observe_id, method, substr(origin_hash,1,12) AS origin12
   FROM observations ORDER BY captured_at DESC LIMIT 5"
```

## Files

- `notes.md` — synthetic fixture content. PII-safe: no real paths, no real
  credentials, nothing that would trip `compost doctor --check-pii`.
