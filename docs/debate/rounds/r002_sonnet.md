# Sonnet R2 — Cross-Critique

## Defending Hybrid Against Codex's "Two Dependency Graphs" Objection

Codex calls hybrid "the worst option: two dependency graphs, two release processes, undefined ownership." This argument would land if the boundary were between two equal peers negotiating a shared API surface. It does not apply when one side is a subprocess CLI.

**New machine setup (a):** You clone the repo. You run `./install.sh`. That script does: `nvm use && bun install` for Node, `uv sync` for Python ingest. LanceDB bindings and MCP server are up. The Python subprocess is invoked as `python -m kb_ingest extract --stdin` — a single entry point with a JSON contract. Two commands. Compare this to a pure Python monolith where you also have to install Node (because the MCP SDK is TypeScript-first and you are not rewriting it), or a pure Node monolith where you ship a half-baked PDF extractor that silently drops tables from docling-quality PDFs. The "two dependency graphs" cost is one `uv sync` call. That is not a maintenance problem. It is a `Makefile` target.

**Updating Python extraction deps without breaking Node core (b):** This is the exact case where hybrid wins over a monolith. You bump `docling` from `0.9` to `1.0`. The interface is `stdin -> JSON -> stdout`. The Node side calls `spawn('python', ['-m', 'kb_ingest', 'extract'])` and reads structured output. If docling's output schema changes, the breakage is immediate and loud: JSON parse fails in Node, you get a stack trace pointing at `kb-ingest/extractor.py:42`. You fix the schema adapter. In a Python monolith, a docling bump can silently change extraction quality with no type boundary to catch the regression. The process boundary is a regression firewall, not a liability.

**Debugging a Python-subprocess crash from Node (c):** The crash happens at 2am. You see `Error: Process exited with code 1` in Node. You add `stderr: 'pipe'` to the `spawn` call if you haven't already — and you will have, because this is in your `kb doctor` implementation from day one. The stderr stream gives you the Python traceback: `ImportError: libpoppler.so.122: cannot open shared object file`. That is a system dependency issue, not a mystery. You run `uv run python -m kb_ingest extract --debug < sample.json` directly. The Python subprocess is independently testable with zero Node involvement. With a monolith, you are in an event loop debugging why an async Python coroutine swallowed a native library error.

Codex's "undefined ownership" objection is only valid if ownership IS undefined. Define it once in `ARCHITECTURE.md`: Node owns `~/.kb/`, MCP, query, scheduling, L4. Python owns `kb_ingest/` — called as a subprocess, never imported. Any file in `kb_ingest/` is Python-owned. Any file outside it is Node-owned. That is a one-sentence boundary. "Undefined" is a process failure, not an architecture failure.

## On Codex's "One Write Pipeline Will Break" Critique

Codex is right. I agreed with the one-pipeline premise too quickly in R1. Active push, passive sniff, and crawl have genuinely different contracts:

- **Passive sniff** (`kb.observe` from Claude Code): interactive latency budget, trust=user, sequence matters within a session, idempotency key = session_id + monotonic sequence.
- **Active push** (`kb add`, `kb watch`): user-initiated, synchronous ack expected, trust=user, idempotency key = content_hash.
- **Autonomous crawl**: background, trust=web, idempotency key = source_uri + etag, latency budget is minutes not milliseconds.

The fix is not three separate pipelines — that over-engineers phase 1. The fix is: `kb.observe` lands ONLY an immutable observation row in L0 (Codex's schema is correct) and enqueues a derivation job. The derivation pipeline (chunk -> embed -> fact-extract -> wiki-update) is shared, but runs asynchronously and prioritized by `source_kind`. Passive sniff jobs get priority=HIGH in the queue. Crawl jobs get priority=LOW. The queue is a single SQLite table with a `priority` column and a worker loop in Node. No cross-store transactions. L0 is always consistent. LanceDB and L2 are eventually consistent. Split-brain is acceptable because L0 is the rebuild anchor. I update my R1 position: one queue, not one synchronous pipeline.

## On Gemini's Embedding Trap and L3 Wiki Rot — Same Root Cause

Yes. These are both derivation versioning failures. The embedding trap says: if you swap `text-embedding-3-small` for `nomic-embed-text-v1.5`, your L1 vectors are invalidated. The L3 wiki rot I named says: L3 goes stale because the synthesis step (model call) runs on a schedule and can fail silently.

Both problems are solvable with the same ledger field: `transform_policy` on each L0 row, as Codex specified. Minimum schema additions for tractability:

```sql
-- L0 additions
ALTER TABLE observations ADD COLUMN transform_policy TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE observations ADD COLUMN embedding_model TEXT;

-- Derivation tracking
CREATE TABLE derivations (
  observe_id TEXT REFERENCES observations(observe_id),
  layer TEXT CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT,
  model_id TEXT,
  derived_at TEXT,
  PRIMARY KEY (observe_id, layer)
);
```

Rebuild from L0 is then: `SELECT * FROM observations WHERE observe_id NOT IN (SELECT observe_id FROM derivations WHERE layer='L1' AND embedding_model='nomic-embed-v1.5')`. That is the gap query. Same pattern for L3 staleness: `SELECT * FROM observations WHERE observe_id IN (wiki_sources) AND derived_at < observations.captured_at`. Gemini's "automated rebuild" requirement and my "L3 freshness" requirement are the same 20-line query run against the derivations table.

## D1/D2/D3 Positions

**D1 (stdio MCP):** Held. Codex's HTTP+SSE argument assumes you need server-push today. You do not. Observation is adapter-to-core, one direction. stdio handles it. Revisit at Phase 3 if cross-machine becomes real.

**D2 (local markdown first):** Held. The closed loop matters more than confronting crawl complexity in week one. But I now accept Claude's sequencing point: web URL by week two, not deferred to a later phase.

**D3 (hybrid):** Held and strengthened. Codex's objection collapses on inspection when the boundary is a subprocess with a JSON contract.

## Where Claude Opus Got It Wrong

Claude's R1 says: "the same pattern as calling `ffmpeg` or `ripgrep` from a Node tool. Nobody complains about that."

This framing undersells the real risk. Nobody complains about calling `ffmpeg` because `ffmpeg` has a 20-year-stable CLI contract. `docling`, `unstructured`, and `trafilatura` are pre-1.0 or recently 1.0 libraries with breaking changes in minor versions. The subprocess boundary is sound in principle, but Claude's analogy implies the Python side is a stable tool like `ffmpeg`. It is not. The actual mitigation is pinning Python deps hard (`uv.lock` committed) and adding an integration test that asserts the JSON output schema of `kb_ingest extract` against a fixture PDF. Claude named the right pattern but gave false confidence by picking the wrong comparator. Call the subprocess boundary what it is: correct, but fragile at the Python library layer, and requiring a schema contract test on every Python dep bump.
