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

## 5. Daemon (recommended for self-evolving use)

The daemon runs seven schedulers (drain / ingest / reflect / freshness /
reasoning / backup / graph-health). On macOS the supported pattern is a
launchd plist that survives reboots and crashes:

```bash
ln -sf "$(pwd)/scripts/com.zion.compost-daemon.plist" \
       ~/Library/LaunchAgents/com.zion.compost-daemon.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.zion.compost-daemon.plist
```

Verify health (note `[running]` per scheduler — not just `pid + uptime`):

```bash
compost daemon status
# pid: 12345  uptime: 60s
# schedulers:
#   drain        [running] last_tick=...        errors=0
#   ingest       [running] last_tick=...        errors=0
#   reflect      [running] last_tick=never      errors=0
#   ... (7 total)
```

Restart after code changes (skips the 60s ThrottleInterval):

```bash
launchctl kickstart -k gui/$(id -u)/com.zion.compost-daemon
```

Without the daemon, `compost add` still works — the outbox is drained
inside the add command itself, but reasoning / reflect / wiki synthesis
won't fire.

## 6. Reasoning + dogfood (Phase 7 L5)

The reasoning scheduler runs every 6h, picks recently-active subjects,
and writes cross-fact chains to `reasoning_chains`. The chain quality
gate is steered by **your verdict feedback** — without it, the
scheduler has no signal to throttle on quality regression.

```bash
compost reason list --limit 10                # see new chains (truncated id)
compost reason list --limit 10 --json | jq    # full UUIDs
compost reason verdict <chain_id> confirmed --note "..."
compost reason verdict <chain_id> rejected --note "why wrong"
compost reason stats                          # cumulative verdict signal
compost reason scheduler status               # scheduler state + recent window
```

Dogfood routine (5 min/day):

1. `compost reason list --limit 5` — scan new chains
2. For each: `compost reason verdict <id> confirmed/refined/rejected --note "..."`
3. That's it. Don't tune POLICY_VERSION mid-dogfood (invalidates old chains).

Suggested zsh aliases (paste into `~/.zshrc`):

```bash
alias cchains='cd /path/to/Compost && bun packages/compost-cli/src/main.ts reason list --json --limit 10 | jq -r ".[] | select(.user_verdict == null) | \"\(.chain_id)  conf=\(.confidence)\n    \(.seed_id // .seed_kind | .[0:80])\""'
alias cstats='cd /path/to/Compost && bun packages/compost-cli/src/main.ts reason stats'
```

## 7. Health checks

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
