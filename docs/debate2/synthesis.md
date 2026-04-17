# Debate #2 Synthesis — D3 + transform_policy

**Scope**: two focused follow-up decisions from debate #1
**Rounds**: 1 (single focused pass)
**Participants**: 🔴 Codex, 🟡 Gemini, 🟠 Sonnet, 🐙 Opus
**Priority inherited**: Maintainability

---

## Position Matrix

| Participant | D3 (Runtime) | transform_policy |
|---|---|---|
| 🔴 Codex | Hybrid (held) | Date-stamp |
| 🟡 Gemini | **Hybrid (CONCEDED)** | Semver |
| 🟠 Sonnet | Hybrid (held) | Date-stamp |
| 🐙 Opus | Hybrid | Date-stamp |
| **Final** | **Hybrid (4-0)** | **Date-stamp (3-1)** |

---

## D3: Hybrid — Unanimous

Debate #1 ended 3-1 for hybrid with Gemini dissenting on pure Node/Bun. Debate #2 opened with Gemini conceding in the first sentence: "I concede. While a single-binary distribution is the ultimate strategic asset, shipping next week requires the extraction quality of docling and trafilatura."

**The concrete failure modes that killed pure-Node:**

- **Sonnet**: arXiv PDF with LaTeX equations, multi-column layout, embedded tables. `pdf.js` gives character spans with XY coordinates, no table structure, no formula semantics. `pdf-parse` gives text only, destroys structural information. docling runs layout detection, preserves table cells, outputs clean Markdown. There is no Node equivalent in 2026.

- **Codex**: mixed PDF with tables plus scanned pages goes through `pdf.js` + ad hoc OCR, loses table structure and formulas, writes bad chunks into `observations`, then SQL reports "successful" ingests whose downstream facts are garbage.

- **Gemini (in concession)**: "`pdf-parse` and `mammoth.js` are text-only relics that fail on tables and formulas, and `@mozilla/readability` lacks the boilerplate-removal precision of Python's trafilatura."

All four participants agreed this is not a "WASM will solve it eventually" problem — it is a "ship in one week with correct extraction quality" problem, and only Python has the tools today.

**Final hybrid boundary (all four agree):**

```
Node/Bun owns:
  packages/compost-core/**         L0 ledger, derivations, schema, queue
  packages/compost-daemon/**       MCP server, scheduler, L4 loop
  packages/compost-adapter-*/**    host adapters + outbox
  All LanceDB + SQLite access
  All query, synthesis, reasoning logic

Python owns:
  packages/compost-ingest/**       extraction ONLY
  Spawned via `uv run compost-ingest extract --policy <tp-id>`
  JSON stdin/stdout contract
  Never touches the DB
  Never imported by Node code
  Returns: { chunks[], facts[], entities[], normalized_content, content_hash_*, warnings[] }

Mandatory guardrails:
  - uv.lock committed, Python deps pinned
  - Schema contract test on every Python dep bump (asserts JSON output against fixture documents)
  - install.sh runs both `bun install` and `uv sync --frozen`
  - Test fixtures for .md, .pdf (with tables), .html (with boilerplate) — committed as part of Phase 0 DoD
```

---

## transform_policy: Date-stamp — 3-1

### The split

- **Sonnet, Codex, Opus**: `tp-YYYY-MM[-NN]` (date-stamp with in-month revision counter)
- **Gemini**: semver `tp-MAJOR.MINOR.PATCH` — argues it enables L4 to programmatically reason about compatibility (MAJOR = L1 rebuild required, MINOR = compatible, PATCH = metadata fix)

### Why date-stamp wins

**Gemini's argument is substantive but the reasoning it demands lives elsewhere.** The L0 schema already has a `derivations` table (decided in debate #1) that directly encodes (observe_id, layer, model_id, transform_policy). The rebuild decision is answered by a SQL query against that table, not by parsing the policy ID:

```sql
-- "Which observations need L1 re-derivation under the new embedding model?"
SELECT observe_id FROM observations o
WHERE NOT EXISTS (
  SELECT 1 FROM derivations d
  WHERE d.observe_id = o.observe_id
    AND d.layer = 'L1'
    AND d.model_id = :target_model_id
);
```

The code never needs to ask "is tp-1.1.0 backward compatible with tp-1.0.0?" It asks "which derivations exist under the target model_id?" The name is a label; the truth is in the explicit per-layer columns.

**Semver would actively mislead.** Semver's intuition (additive changes are compatible) is for APIs. For data extraction pipelines, almost any change — chunk size, prompt version, normalization rule — invalidates existing derivations in ways that APIs do not suffer. A `tp-1.1.0` labeled MINOR would tempt a maintainer to skip an L2 rebuild that should have happened. Date-stamp is honest: "this is a different configuration snapshot, active in a time window, make no compatibility assumptions."

**Sonnet's 2am operational argument** lands the decision: `tp-2026-04-02` at 2am tells you "four month, second revision" and you can immediately `git log --since="2026-04-01" packages/compost-core/src/policies/` to see what changed. Semver forces a second lookup. Git SHA is opaque in SQL and code review.

### Refinement adopted (from Opus R1)

Keep the date-stamp naming AND add explicit relationship fields in the registry entry, so semver-style reasoning is available via data, not via name parsing:

```typescript
export const policies = {
  'tp-2026-04': {
    id: 'tp-2026-04',
    supersedes: null,
    effective_from: '2026-04-01',
    embedding: { model: 'nomic-embed-text-v1.5', dim: 768 },
    chunk: { size: 800, overlap: 100 },
    factExtraction: { prompt: 'fact-extract-v1', model: 'claude-opus-4-6' },
    wikiSynthesis: { prompt: 'wiki-synth-v1', model: 'claude-opus-4-6' },
    dedup: { minhashJaccard: 0.98, embeddingCosine: 0.985 },
    normalize: { stripBoilerplate: true, collapseWhitespace: true },
    migration_notes: 'Initial policy.',
  },
  'tp-2026-04-02': {
    id: 'tp-2026-04-02',
    supersedes: 'tp-2026-04',
    effective_from: '2026-04-15',
    embedding: { model: 'nomic-embed-text-v1.5', dim: 768 },
    chunk: { size: 800, overlap: 150 },  // changed
    factExtraction: { prompt: 'fact-extract-v1', model: 'claude-opus-4-6' },
    wikiSynthesis: { prompt: 'wiki-synth-v1', model: 'claude-opus-4-6' },
    dedup: { minhashJaccard: 0.98, embeddingCosine: 0.985 },
    normalize: { stripBoilerplate: true, collapseWhitespace: true },
    migration_notes: 'Bumped chunk overlap 100→150 to improve cross-chunk fact linking. Requires chunk + L1 rebuild for observations indexed under tp-2026-04. L2 facts may shift; rebuild recommended.',
  },
} as const;
```

`supersedes` + `migration_notes` give operators the relationship clarity that Gemini wanted, without the false compatibility claims of semver.

---

## Impact on phase0-spec.md

Two edits needed:

1. **§0 / §3 / §4**: no change. Hybrid boundary is already specified correctly.
2. **§2 transform_policy convention**: add the `supersedes`, `effective_from`, and `migration_notes` fields to the registry entry example. Keep the `tp-YYYY-MM[-NN]` naming.

---

## Decisions Closed

- ✅ **Package name**: `compost`
- ✅ **Project location**: `<repo>/`
- ✅ **D1 transport**: stdio MCP + adapter-local `observe_outbox`
- ✅ **D2 first combo**: local markdown week 1 → web URL week 2
- ✅ **D3 runtime**: Hybrid (Node core + Python extraction subprocess)
- ✅ **transform_policy convention**: `tp-YYYY-MM[-NN]` date-stamp with `supersedes` + `migration_notes`

Phase 0 is ready to start. No remaining blockers.
