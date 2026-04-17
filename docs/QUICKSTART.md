# Quickstart

Five minutes from fresh clone to first query. For a deeper tour, see
`docs/CONCEPTS.md`. For architectural detail, see `docs/ARCHITECTURE.md`.

## 1. Install

Prerequisites:
- `bun >= 1.3`
- `uv` (Python package manager)
- `ollama` with `nomic-embed-text:v1.5` pulled

```bash
git clone https://github.com/Bryanh9111/Compost.git
cd Compost
./scripts/install.sh
ollama pull nomic-embed-text:v1.5
```

`scripts/install.sh` does: runs migrations, seeds transform policies,
builds the CLI, and wires the `compost` binary onto your PATH via
`~/.compost/bin/`. The database lives at `~/.compost/ledger.db`.

## 2. First ingest

```bash
compost add examples/01-local-markdown-ingest/notes.md
```

You will see one observation row written, one extraction subprocess
run, and a set of facts appear in L2.

## 3. First query

```bash
compost query "local-first memory"
```

Returns facts matching by BM25 + vector similarity. No LLM involved —
this is purely the zero-LLM retrieval path.

## 4. First ask

```bash
compost ask "Why does Compost prefer a local-first architecture?"
```

Retrieves candidate facts, feeds them to the local LLM (via ollama),
and returns an answer grounded in those facts. If the LLM is down or
the circuit breaker is open, `ask` falls back to BM25 and clearly
says so — no silent hallucinations.

## 5. Daemon (optional, for continuous ingest)

The daemon watches sources and drains the outbox on a schedule.
Single-user machines usually run it manually:

```bash
compost daemon start      # background service
compost daemon status     # check health
compost daemon stop
```

Without the daemon, `compost add` still works — the outbox is drained
inside the add command itself.

## 6. Health checks

```bash
compost doctor --check-pii          # scan outbox for PII leaks
compost doctor --check-integrity    # FK + fact-links + policy audit
compost doctor --check-llm          # probe local LLM + circuit breaker
```

## Next steps

- `examples/01-local-markdown-ingest/` — the example this quickstart runs
- `examples/02-web-url-ingest/` — add web pages (ETag-aware freshness)
- `examples/03-mcp-integration/` — wire Claude Code hooks for cross-session memory
- `docs/CONCEPTS.md` — L1-L6 self-evolution layers, decay, provenance model
- `docs/ARCHITECTURE.md` — write-path / storage / failure modes in depth

## When things break

| Symptom | Most likely cause |
|---|---|
| `compost add` hangs | Ollama is not running. `ollama serve &` |
| `ask` returns BM25-only output | LLM circuit breaker open. `compost doctor --check-llm` |
| "migration failed" | Stale `~/.compost/ledger.db`. Back it up and re-run `scripts/install.sh` |
| Nothing in `compost query` after add | Extraction subprocess failed. Check `compost triage` |
