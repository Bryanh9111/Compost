# Compost examples

Three end-to-end walkthroughs covering the main ingest modes. Each example
directory is self-contained — it has its own `README.md` and any fixture
content it needs. Run them in order the first time.

| # | Directory | Covers | Needs network |
|---|-----------|--------|---------------|
| 01 | `01-local-markdown-ingest/` | `compost add <file>` → `query` → `ask` on a local markdown file | No |
| 02 | `02-web-url-ingest/` | `compost add <url>` with ETag / Last-Modified freshness re-check | Yes (any public URL) |
| 03 | `03-mcp-integration/` | Wire Claude Code hooks → Compost via the hook-shim MCP adapter, then use Compost's analysis-partner surface (`ask`, `triage`, `doctor`) | No (Claude Code only) |

## Prerequisites

- `bun >= 1.3`
- `uv` (Python) — installed automatically by `scripts/install.sh`
- `ollama` running locally with `nomic-embed-text:v1.5` pulled
- Compost installed (`./scripts/install.sh` from the repo root)

If you are reading this on a fresh clone, run the install script first:

```bash
./scripts/install.sh
ollama pull nomic-embed-text:v1.5
```

Each example prints the commands it runs. Nothing is hidden in wrapper
scripts — copy-paste to your shell and you get the same result.
