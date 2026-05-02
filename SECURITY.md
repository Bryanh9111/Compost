# Security

Compost is designed for single-user local use. Your knowledge base never leaves your machine.

## Data locality

- All data (observations, facts, embeddings, wiki) is stored locally in `~/.compost/` (or the path you configure)
- No telemetry, no cloud sync, no central service
- LLM calls go to your configured local model (Ollama by default) — no API keys sent anywhere by the core
- If you point Compost at a cloud LLM (OpenAI, Anthropic), only the synthesis requests go there; your raw observations stay local

## PII protection

The hook-shim includes a regex-based PII redactor (`packages/compost-hook-shim/src/pii.ts`) that runs automatically before every envelope is written to `observe_outbox`. It redacts:

- Credit card numbers (Luhn-validated; 13-19 digits)
- SSH/PGP private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- API tokens (`sk-ant-*`, `sk-*`, `ghp_*`, `github_pat_*`, `AKIA*`, `AIza*`, `xox[baprs]-*`)
- Bearer authorization tokens (`Bearer <token>`)
- `.env`-style assignments for sensitive keys (`SECRET=`, `PASSWORD=`, `TOKEN=`, `APIKEY=`, `ACCESS_KEY=`, `PRIVATE_KEY=`, `CLIENT_SECRET=`)
- `password: xxx` / `password=xxx` forms (case-insensitive)

Replacements use distinguishable placeholders (`[REDACTED_CC]`, `[REDACTED_TOKEN]`, `[REDACTED_PRIVATE_KEY]`, `[REDACTED]`) so audits can tell which pattern triggered.

### Strict mode (opt-in)

Set `COMPOST_PII_STRICT=true` in the hook environment to also redact any raw 13-19 digit sequence that fails Luhn validation. This catches non-CC tabular leaks (support IDs, order numbers that happen to look like cards) at the cost of higher false-positive rate.

### Auditing existing data

Two doctor commands expose the PII / integrity posture of an already-running Compost instance:

```bash
# Scan existing observe_outbox rows for PII patterns (report only, no mutation)
compost doctor --check-pii

# One-shot schema integrity audit (orphan observations, dangling fact_links,
# stale wiki_pages, unknown transform_policy references)
compost doctor --check-integrity
```

Both emit JSON to stdout. Neither modifies the database — remediation (purge rows, re-ingest with strict mode, manual migration) is user-driven based on the report.

### Limitations (documented)

- Regex-based redactor cannot defend against homograph attacks (e.g. Cyrillic `о` vs Latin `o`)
- Novel token formats not in the blocklist are missed — add patterns for your own sensitive strings in `packages/compost-hook-shim/src/pii.ts`
- LLM-generated wiki synthesis output is not re-scanned for PII — if source content had PII that slipped through the hook-shim, it can surface in wiki pages
- Backup files (`~/.compost/backups/`) contain the full DB including any PII — protect them the same as your main DB

**The redactor is a defense-in-depth layer, not a guarantee.** Review your hook envelopes periodically if you handle confidential data.

## Local disk only — no cloud sync

`~/.compost/` **must not** live in a cloud-synced folder (Dropbox / iCloud / OneDrive / NFS). SQLite WAL and LanceDB manifests will silently corrupt when multiple writers appear across sync boundaries.

`install.sh` checks for known sync service paths and refuses to proceed. For cross-machine use, use `compost export` + `compost import` (Phase 8 roadmap) rather than folder sync.

## Public-artifact hygiene (MIT fork-template policy)

Compost ships as an MIT fork-template — anyone can `git clone` and grow their own. To keep the public artifact clean across forks:

### Path conventions in tracked docs

- **Tilde paths (`~/.compost/`, `~/.engram/`, `~/.claude/`) are accepted** — they are standard Unix shorthand, portable across users, and match the convention this codebase already uses.
- **Absolute `/Users/<username>/` paths are forbidden** in tracked files. They leak the maintainer's username and home structure to every fork.
- When referencing the maintainer's local files (e.g. plans, scratchpads) in tracked docs, use phrases like "maintainer's local plan file (kept outside this repo)" rather than the absolute path.

### Locally-only directories (gitignored)

Some directories contain personal context (multi-AI debate transcripts, scratch plans, machine-specific configs) that don't belong in the public artifact:

- `debates/` — multi-AI debate session transcripts. Each fork keeps its own locally; the maintainer's are not committed.
- `scripts/com.<username>.*.plist` — personal launchd plists. The public template lives at `scripts/com.example.*.plist` with placeholder paths.
- `bench/baseline-*.json` outside the published baselines — local experiment baselines stay local.

The `.gitignore` enforces this. If you fork Compost, your own debates/ stays private to your fork by default.

### What still needs hand-review before any push

Even with `.gitignore` and PII redactor in place, hand-review every commit for:
- Absolute `/Users/<your-username>/` or `/home/<you>/` paths that snuck into docs or test fixtures
- Email addresses, real phone numbers, real account ids
- Project-specific names from your private projects that aren't part of Compost
- Backup paths that disclose your machine's directory structure

Run `git grep "/Users/$(whoami)\|/home/$(whoami)\|<your-email>" -- ':!bench/baseline*.json'` before committing if you're paranoid; it should return zero hits.

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
