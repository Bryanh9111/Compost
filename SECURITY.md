# Security

Compost is designed for single-user local use. Your knowledge base never leaves your machine.

## Data locality

- All data (observations, facts, embeddings, wiki) is stored locally in `~/.compost/` (or the path you configure)
- No telemetry, no cloud sync, no central service
- LLM calls go to your configured local model (Ollama by default) — no API keys sent anywhere by the core
- If you point Compost at a cloud LLM (OpenAI, Anthropic), only the synthesis requests go there; your raw observations stay local

## PII protection

The hook-shim (Phase 4 P1) includes a regex-based PII redactor that filters:

- Credit card numbers
- SSH keys and private key blocks
- API tokens (`sk-*`, `ghp_*`, `github_pat_*`, `AKIA*`, `AIza*`)
- `.env` file patterns (`KEY=value` with sensitive keys)
- Explicit password-like strings

**The redactor is conservative (may over-redact) but cannot catch everything.** If you use Compost in contexts where confidential data flows through Claude Code hooks, review the `packages/compost-hook-shim/` regex list and add patterns for your own sensitive strings.

## Local disk only — no cloud sync

`~/.compost/` **must not** live in a cloud-synced folder (Dropbox / iCloud / OneDrive / NFS). SQLite WAL and LanceDB manifests will silently corrupt when multiple writers appear across sync boundaries.

`install.sh` checks for known sync service paths and refuses to proceed. For cross-machine use, use `compost export` + `compost import` (Phase 8 roadmap) rather than folder sync.

## Reporting vulnerabilities

This is a personal project without a formal security response process. If you find a vulnerability:

- **Low severity**: Open a GitHub issue with a clear description
- **High severity (RCE, data exfiltration, PII leak)**: Email the repo owner directly (see GitHub profile)

We don't guarantee response timelines. Your fork should maintain its own security posture if you deploy Compost anywhere beyond a personal laptop.

## Known limitations

- PII redactor uses regex — will miss novel patterns, unicode bypasses, non-English sensitive data
- LLM output (wiki synthesis) is not re-scanned for PII — if your source content had PII that slipped through the hook-shim redactor, it can surface in wiki pages
- Backup files (`~/.compost/backups/`) contain the full DB including any PII — protect them the same as your main DB

## Philosophy

Compost's primary security assumption is **the machine running it is trusted by you**. If your machine is compromised, Compost's local data is compromised. We do not protect against:

- Root/admin access to your machine
- Malicious code running as your user
- Physical access to unlocked machine with Compost running

For higher-security contexts, run Compost in a dedicated VM or encrypted volume.
