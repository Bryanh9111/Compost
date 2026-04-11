# Final Synthesis — Self-Evolving Knowledge Fusion Reasoning System

**Debate**: 3 technical decisions + architecture stress-test
**Participants**: 🔴 Codex, 🟡 Gemini, 🟠 Sonnet, 🐙 Claude Opus
**Rounds**: 2 (initial + cross-critique)
**Mode**: cross-critique, adversarial tone, maintainability priority

---

## Round-by-Round Position Tracking

| | Gemini | Sonnet | Codex | Opus |
|---|---|---|---|---|
| **D1 R1** | (a) stdio MCP | (a) stdio MCP | (c) HTTP+SSE | (a) with caveats |
| **D1 R2** | doubled down | held | **conceded to (a)** | consensus |
| **D2 R1** | (a) local md | (a) local md | (b) web URL | (a) then (b) fast |
| **D2 R2** | doubled down | held, accepted sequencing | **conceded to (a)+(b) sequence** | consensus |
| **D3 R1** | (a) Node/Bun | (c) Hybrid | (b) Python | (c) Hybrid |
| **D3 R2** | doubled down strategic | held + strengthened | **conceded to (c)** | held |

Three clean convergences on D1 and D2 in Round 2. **D3 remains 3-1** — Sonnet, Codex, Opus on hybrid; Gemini on pure Node/Bun with a strategic argument.

---

## Final Recommendations

### Decision 1: **stdio MCP + adapter-local outbox**

Consensus after Codex conceded, but the concession came with a necessary addition everyone now agrees on:

- stdio MCP for the v0 transport
- Treat `kb.observe` as MCP **notification** (fire-and-forget), not request/response tool call
- **Each adapter maintains a local SQLite `observe_outbox` table** with `(seq INTEGER PRIMARY KEY, payload JSON, sent_at, acked_at)` for durability across core restarts and backpressure scenarios
- Transport is transport-neutral at the API layer — HTTP/SSE can be added later as a second binary entrypoint without changing the schema

**Rationale:** stdio MCP is cheap, native to the claude-code ecosystem, and the outbox pattern solves Codex's real concern (delivery loss on core restart) without the TLS/auth/port overhead of HTTP.

### Decision 2: **local markdown (week 1) → web URL (week 2), both on claude-code adapter**

Consensus after Codex and Sonnet both accepted Opus's sequencing fix. Not exclusive, not deferred — just ordered.

- **Week 1**: local markdown + claude-code passive sniff. Hardens the `kb.observe` schema, dedup, replay, outbox, queue priority, and L0→L1/L2 derivation.
- **Week 2**: web URL + claude-code. Forces TTL, content-hash diffing, ETag lies, canonicalization, boilerplate stripping. This is where the FRESH guarantee gets tested.

**Do not push web URL past Phase 2.** If you never test freshness machinery, the FRESH guarantee is marketing copy.

### Decision 3: **Hybrid (Python extraction subprocess, Node core/MCP/adapters)** — 3-1

Three positions held hybrid in R2. Gemini alone doubled down on pure Node/Bun with a strategic bet on WASM/Rust replacing Python's extraction ecosystem by 2031.

**Winning recommendation: hybrid, with a critical escape hatch.**

- **Node owns** `~/.kb/`, LanceDB, MCP server, query layer, L4 scheduler, adapters, all orchestration
- **Python owns** `kb_ingest/` ONLY, called as a subprocess CLI with JSON stdin/stdout contract
- Hard boundary defined in one sentence: "any file under `kb_ingest/` is Python-owned; everything else is Node-owned"
- **Mandatory guardrails** (from Sonnet's Opus critique):
  - `uv.lock` committed; Python deps pinned hard
  - Integration test on every Python dep bump: assert JSON schema of `kb_ingest extract` output against fixture PDF
  - Document `libpoppler` and other native deps in one `./install.sh` that runs both `bun install` and `uv sync`
- **Escape hatch for Gemini's long-term bet**: the extractor is invoked via a stable CLI contract (`kb-extract --mime <x> --uri <y>`), so the implementation behind it can be swapped from Python to Rust/WASM later without changing the Node caller. This preserves the distribution-story optionality.

**Why Gemini's pure-Node position lost despite being strategic:**
- `docling` (IBM) is the only production-grade PDF structural parser with table/formula/layout awareness
- `unstructured` is the only mature mixed-format extractor
- Node/Bun have zero real competitors today (`pdf.js` is a renderer, not a structural extractor)
- WASM-bundled replacements are theoretical, not shipped
- For a system the user starts depending on next week, shipping on today's reality wins over betting on 2031
- The escape hatch preserves Gemini's strategic goal without paying the tactical cost

---

## Gemini's Product Pivot — Accepted Unanimously

Codex said **"Complete is not a guarantee, it is an SLO."** Gemini extended this into a product reframe that the synthesis adopts:

> **Replace "COMPLETE" with "Auditable Coverage"**
>
> Do not promise the KB has everything. Expose a Coverage Map showing which source domains are subscribed, what their SLO targets are, current coverage ratio, known gaps, and when each was last reconciled. Turn the limitation into a trust feature: the user can see WHY the system does not know something and plug the holes themselves.

The three quality guarantees become:

| Old | New | Mechanism |
|---|---|---|
| Fresh | **Fresh** (unchanged) | TTL + content-hash diff + stale marking on queries |
| Trustworthy | **Trustworthy** (unchanged) | provenance + confidence + contradiction arbitration |
| ~~Complete~~ | **Auditable Coverage** | per-source SLO + coverage_ratio SQL + alerting + gap visualization |

Codex's concrete SLO schema (from R2) is adopted:

```sql
CREATE TABLE source (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  refresh_sec INTEGER NOT NULL,
  coverage_target REAL NOT NULL
);
CREATE TABLE expected_item (source_id, external_id, expected_at, PRIMARY KEY(source_id, external_id));
CREATE TABLE captured_item (source_id, external_id, captured_at, snapshot_id, PRIMARY KEY(source_id, external_id, captured_at));

-- Alert rule: coverage_ratio < target for 2 windows OR now - last_capture > 2 * refresh_sec
```

---

## Top 3 Architectural Risks to Mitigate Before Phase 0

### Risk 1: Derivation Versioning (the unifier for 3 separate risks)

Three participants named variants of the same problem:
- Gemini: embedding trap (swap model → all L1 vectors invalidated)
- Sonnet: L3 wiki rot (synthesis runs fail silently, L3 stays "fresh" while L2 has diverged)
- Codex: rebuild is fiction without transform policy versioning

**Root cause: the L0 ledger does not track the versioned derivation pipeline.** Facts, embeddings, and wiki pages are derivations of L0 observations, but without a derivations table tying each derivation back to its model/policy version, there is no way to know what is stale or what to re-derive on rebuild.

**Mitigation (day-one schema requirement):**

```sql
-- L0: observations must store raw bytes + versioning
CREATE TABLE observations (
  observe_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,     -- sha256 of normalized bytes
  raw_bytes BLOB,                 -- or CAS pointer
  mime_type TEXT NOT NULL,
  adapter TEXT NOT NULL,          -- e.g. "claude-code@0.3.1"
  sequence INTEGER NOT NULL,
  trust_tier TEXT NOT NULL,       -- user|first_party|web
  idempotency_key TEXT UNIQUE,
  transform_policy TEXT NOT NULL  -- "v1" etc
);

-- Derivation tracking: what layer was built from which observe_id, by which model/policy
CREATE TABLE derivations (
  observe_id TEXT REFERENCES observations(observe_id),
  layer TEXT CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT NOT NULL,
  model_id TEXT,                  -- e.g. "nomic-embed-v1.5"
  derived_at TEXT NOT NULL,
  PRIMARY KEY (observe_id, layer, model_id)
);
```

Same SQL pattern detects all three failures:
- **Embedding trap repair**: `SELECT observe_id FROM observations WHERE observe_id NOT IN (SELECT observe_id FROM derivations WHERE layer='L1' AND model_id='<new_model>')`
- **L3 wiki rot detection**: `SELECT observe_id FROM observations o JOIN derivations d ON o.observe_id=d.observe_id WHERE d.layer='L3' AND d.derived_at < o.captured_at`
- **Rebuild guarantee**: the ledger now has enough metadata to deterministically regenerate any layer

### Risk 2: Adapter Observe Outbox (Durability)

Without this, stdio MCP drops observations on core restart. The fix is trivial and was agreed upon in R2:

- Each adapter has a local SQLite outbox
- `kb.observe` events are persisted locally before sending via MCP notification
- Core acks with sequence number; adapter marks `acked_at`
- On reconnect, adapter replays unacked events from its outbox
- Cleanup old acked rows periodically

This is maybe 150 lines of code in the adapter SDK. Skipping it means data loss on process crashes.

### Risk 3: The "Noteworthy" Function for Autonomous Crawl

Opus raised this in R1 as the hand-wave in the original architecture. Codex provided a concrete algorithm in R2 that the synthesis adopts:

**A re-crawled page is noteworthy iff ANY of these hold:**

1. `raw_sha256` differs AND `norm_sha256` differs (structural change, not boilerplate)
2. `MinHash(5-shingle) estimated Jaccard < 0.98` against latest snapshot (set-similarity gate)
3. For changed pages chunked + embedded: any chunk has cosine similarity `< 0.985` against prior chunks
4. AND introduces at least one new `(entity, relation, value)` triple, named entity, date, or number

Boolean gate: `is_noteworthy = (raw_hash_diff AND norm_hash_diff) AND (jaccard < 0.98) AND (new_claims > 0 OR novel_chunk_ratio >= 0.05)`

Non-noteworthy snapshots are tombstoned (L0 records the crawl happened, but no derivation is triggered). This prevents L1 index bloat from chatty sites while preserving the ability to detect real change.

**This must exist in L4 from day one** or autonomous crawl is either spam (every comma change triggers ingest) or silent (the fallback bail-out runs too aggressively).

---

## Updated Architecture (Post-Debate)

Preserving the user's original L0-L4 + dual-mode design, with these refinements:

```
┌─────────────────────────────────────────────────────────┐
│  Consumer face: Other agents query via MCP               │
│  kb.query(q, contexts?) / kb.ask(q) / kb.describe_cov    │
└─────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────┐
│  Host Adapters (each runs its own adapter_outbox)        │
│  claude-code (first) | openclaw | hermes | airi | mcp    │
│  Every adapter: local SQLite outbox + replay on reconnect│
└─────────────────────────────────────────────────────────┘
                          ↕
     kb.observe (MCP notification) / kb.query (MCP tool)
                          ↕
┌─────────────────────────────────────────────────────────┐
│  Core (Node/Bun)                                         │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ L0 Provenance Ledger (SQLite)                      │ │
│  │   observations + derivations + source + SLO tables │ │
│  │   raw_bytes stored, transform_policy versioned     │ │
│  └────────────────────────────────────────────────────┘ │
│                     │                                    │
│                     ↓ ingest queue                       │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Ingest Queue (SQLite table, priority-ordered)      │ │
│  │   HIGH: passive sniff / active push                │ │
│  │   LOW:  crawl                                      │ │
│  │   Worker loop (single writer to LanceDB)           │ │
│  └────────────────────────────────────────────────────┘ │
│                     │                                    │
│                     ↓                                    │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Python kb_ingest subprocess (uv-managed)           │ │
│  │   docling / unstructured / tree-sitter / trafilat. │ │
│  │   JSON stdin/stdout contract                       │ │
│  └────────────────────────────────────────────────────┘ │
│                     │                                    │
│     ┌───────────────┼────────────────┐                   │
│     ↓               ↓                ↓                   │
│  L1 LanceDB    L2 facts SQLite    L3 wiki markdown       │
│  (BM25+vec)    (triples+ctxs)     (LLM-maintained)       │
│     │               │                │                   │
│     └───────────────┼────────────────┘                   │
│                     ↕                                    │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Reasoning synthesis (query path)                   │ │
│  │   Returns: answer + provenance + confidence +      │ │
│  │            freshness + coverage for topic          │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  L4 Evolution Daemon                                     │
│  ├─ freshness TTL refetch loop                          │
│  ├─ autonomous crawl (with is_noteworthy() gate)         │
│  ├─ contradiction arbitration                            │
│  ├─ coverage SLO monitoring + alerting                   │
│  └─ kb doctor --reconcile (L0 vs LanceDB drift repair)   │
└─────────────────────────────────────────────────────────┘
                          ↑
   Active push: kb add / kb watch
```

**Key changes from the original proposal:**

1. **One write pipeline → two-stage: observation + async derivation queue.** `kb.observe` only lands an immutable row in L0 and enqueues a job. Split-brain between SQLite and LanceDB is acceptable because L0 is the rebuild anchor.
2. **Provenance ledger stores raw bytes + transform_policy** (not just metadata). This is the difference between a museum and an evolvable knowledge stream.
3. **Derivations table** is mandatory day one. Solves embedding trap, wiki rot, and rebuild drift as one schema.
4. **Adapter outbox** makes stdio MCP + notifications durable.
5. **is_noteworthy() function** grounds autonomous crawl with a concrete algorithm.
6. **"Complete" → "Auditable Coverage"** with per-source SLO schema and alerting.
7. **Hybrid runtime** with a CLI escape hatch so the extraction implementation is swappable.
8. **kb doctor --reconcile** is a day-one requirement, not a later feature (Sonnet's 2am scenario).

---

## Summary of Perspectives

### 🟡 Gemini — Ecosystem & Strategic

Strongest contribution: the product-level pivot from "Complete" to "Auditable Coverage." That reframe will save the project from an infinite L4 complexity sink. Also correctly identified the embedding trap as a strategic (not just tactical) risk. Lost D3 on hybrid vs pure Node, but the strategic concern (distribution story) was preserved via the CLI escape hatch.

### 🔴 Codex — Technical Implementation

Strongest contribution: protocol-level rigor. Forced everyone to confront (1) one-pipeline write is broken, (2) rebuild needs transform_policy versioning, (3) "complete" is an SLO not a guarantee, (4) concrete `is_noteworthy` algorithm with MinHash + embedding thresholds. Conceded on all three decisions after seeing the outbox pattern and subprocess hybrid boundary. The concessions were earned, not diplomatic.

### 🟠 Sonnet — Pragmatic Implementer

Strongest contribution: concrete ops realism. Named L3 wiki rot, LanceDB manifest corruption, the `kb doctor --reconcile` day-one requirement, LanceDB concurrent writes, passive sniff event volume, and the Python dep pinning + schema contract test. Defended hybrid with specific scenarios (new machine setup, Python dep bump, subprocess crash debugging) that collapsed Codex's "two dependency graphs" objection.

### 🐙 Claude Opus — Moderator + Synthesis

Strongest contribution: the sequencing resolution on D2 (local markdown first, web URL immediately after — not either/or), the "interesting-ness function" critique for autonomous crawl that Codex then operationalized, the dual-mode constraint (Core must be pure, Daemon adds scheduler/watchers), and this synthesis. Was wrong to frame the Python subprocess boundary with the ffmpeg analogy — Sonnet correctly pointed out that docling/unstructured are pre-1.0 and the boundary is fragile without schema contract tests.

---

## Phase 0 Go/No-Go

**GO with the debated refinements.** The architecture is coherent after cross-critique. The original L0-L4 split survives the stress test because:

- L0 earns its "ground truth" status once raw bytes + transform_policy are stored
- L1-L3 are disposable views, not sources of truth (Gemini's "museum vs. living stream" reframe)
- Dual-mode works IF Core exposes pure functions and Daemon is the thin wrapper
- Context-based partitioning is sufficient as the primary axis; `trust_tier` was added as a secondary axis via the adapter schema (implicit answer to stress test #4)
- The three guarantees collapse from "FRESH / TRUSTWORTHY / COMPLETE" to "FRESH / TRUSTWORTHY / AUDITABLE-COVERAGE" — the first two remain guarantees, the third becomes a measurable SLO

**Before starting Phase 0 (requirement, not nice-to-have):**

1. Write the L0 schema with `observations` (raw_bytes + transform_policy) and `derivations` tables
2. Write the adapter SDK interface with `observe_outbox` pattern
3. Write the `is_noteworthy()` pseudocode + test cases with real before/after snapshots
4. Decide the `transform_policy` versioning convention (semver? date-stamp? git sha?)
5. Commit to "Auditable Coverage" in all user-facing docs (no "Complete" language)

**Phase 0 estimated scope:** L0 schema + kb-core library skeleton + Python `kb_ingest extract` CLI with docling/unstructured + install.sh. 1 week solo.

---

## Next Steps for the User

1. Review this synthesis and confirm the four converged decisions (D1 stdio+outbox, D2 md→web sequence, D3 hybrid+escape-hatch, Auditable Coverage pivot)
2. Decide the `transform_policy` versioning convention
3. Green-light Phase 0 or flag any remaining disagreements
4. If green: I will produce the Phase 0 technical specification (schema SQL, file layout, install script, adapter SDK interface, test fixtures)
