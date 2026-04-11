# Sonnet R1 — Pragmatic Implementer

## Decisions

**Decision 1: stdio MCP (option a)**

Unix socket is a trap. You'll spend a week on framing, reconnect logic, and pid-file management for a gain that benchmarks don't justify at kb query latencies. stdio MCP reuses the exact transport Claude Code already handles — zero bespoke server code for the adapter layer. HTTP+SSE is premature; cross-machine is a Phase 4 problem. Start with stdio, you can layer socket transport later without changing the protocol.

**Decision 2: local markdown + claude-code adapter (option a)**

Web crawl validation sounds compelling but it serializes your feedback loop. The hardest part of this system is the passive-sniff pipeline (observe event -> chunk -> embed -> deduplicate). You need that working and battle-tested before you add async HTTP fetches, rate-limit handling, and robots.txt compliance. Option (a) gives you a closed loop in days. Option (b) gives you two uncertain variables at once.

**Decision 3: Python for ingest, Node for Core+MCP (option c)**

The ingest problem is genuinely hard: PDFs via docling, HTML cleaning, code via tree-sitter. The Node ecosystem for this is embarrassing. But LanceDB's Node bindings are mature and Bun's single-binary story is real operational value for portability. Split the boundary cleanly: Python subprocess for extraction (stdin/stdout JSON), Node owns the db and MCP surface. The IPC cost is negligible; the maintainability gain is large.

---

## Stress-Test: Question 6 — Biggest hidden risk that kills this 6 months in

**The L3 wiki rot problem.**

L3 is LLM-maintained markdown. The architecture says "synthesis layer" writes to it. What actually happens: every ingest cycle, the daemon decides whether to update the wiki. After 6 months of passive sniffing from Claude Code sessions, you have 50,000 observed facts. The LLM calls to maintain the wiki cost real money and time. So you batch them. Then you get wiki-cache-miss: a query hits the reasoning layer, L1+L2 return relevant facts, but L3's synthesis is 3 weeks stale because the last batch failed silently (rate limit at 3am, logged to `/tmp`, process exited 0 via swallowed exception).

The user asks a question. The system returns an answer with `confidence: 0.87` citing L3 as a source. The answer is wrong because L3 reflects pre-update state. The provenance says "wiki/topic.md@2025-11-03". The user doesn't know the wiki is stale because `freshness` metadata on L3 nodes is only updated when the LLM write succeeds — not when a new contradicting fact lands in L2.

**Fix before you ship:** L3 freshness must be derived from `max(L2.updated_at WHERE provenance_id IN wiki_sources) > wiki.last_synthesis_at`. If that delta exceeds threshold, mark L3 node `STALE` and exclude it from synthesis or flag it in response. This is a 20-line SQL query but it has to exist on day one or you will trust wrong answers.

---

## 2am Debugging Test

LanceDB file corruption after unclean shutdown. LanceDB's on-disk format is Arrow IPC + manifest files. If the L4 daemon is mid-write when the laptop lid closes (SIGTERM not caught), you get a partial manifest. On restart, `vectordb.open()` throws `ManifestNotFound` or silently returns fewer vectors. The WAL story for LanceDB is not SQLite-level mature.

Hardest to debug: your L0 provenance ledger says 12,400 chunks ingested. LanceDB reports 11,891 vectors. Which 509 are missing? There's no built-in reconciliation. You'll be writing a `kb doctor` command at 2am that joins L0 chunk IDs against LanceDB vector IDs and re-embeds the delta.

**Mitigation:** write `kb doctor --reconcile` before you write `kb crawl`. Make L0 the authoritative count; LanceDB is always rebuildable from L0.

---

## Hidden Gotchas

1. **LanceDB concurrent writes from L4 daemon + `kb add` CLI.** LanceDB has table-level write locks. If the daemon is running a TTL refetch while you manually `kb add`, one silently blocks or errors. Add a write queue (single-writer via Node `AsyncMutex`) on day one.

2. **Passive sniff event volume.** A single Claude Code session generates 200-400 assistant turns. If you observe every turn, you'll embed 50k+ chunks/week. Deduplication via content-hash before embedding is obvious, but semantic dedup (near-duplicate paraphrases) is not. Without it, your L1 index bloats and recall precision drops as cosine scores get diluted.

3. **`kb relearn` on new machine breaks relative paths.** You said no absolute paths, logical vars `$REPOS/$HOME`. But watched paths stored in L0 as `$REPOS/myproject` silently fail if `$REPOS` isn't set in the new shell env. The re-subscribe step needs explicit env validation and clear error output, not silent no-op.

4. **SQLite WAL mode + LanceDB in the same `~/.kb/` dir over network filesystems.** If you ever sync `~/.kb/` via Dropbox or iCloud (tempting for portability), SQLite WAL and LanceDB manifest writes will corrupt. Document this as a hard constraint: `~/.kb/` must be on local disk only. Use `kb export` for cross-machine transfer.

5. **Contradiction arbitration is underspecified.** "Newer > higher-confidence > multi-source > conflict flag" — who sets confidence on ingest? If it's always 1.0 from passive sniff and 0.9 from crawl, then newer always wins and the arbitration logic is never exercised until it silently fails on a real conflict. Seed it with real confidence variance from day one or the arbitration code will be untested when you need it.
