# Claude (Opus) — D3+Policy

## D3: Unanimous for hybrid (4-0 after Gemini concession)

Gemini conceded this round with the right framing: "Contractual Subprocess." That matches what Sonnet and Codex defended with concrete failure modes (arXiv PDF with LaTeX tables, mixed-PDF-with-OCR scanned pages). The decision is locked.

Final boundary (all four agree):

```
Node/Bun owns:
  packages/compost-core/**        L0 ledger, derivations, schema
  packages/compost-daemon/**      MCP server, scheduler, L4 loop
  packages/compost-adapter-*/**   host adapters + outbox
  LanceDB + SQLite access
  All queue, query, synthesis logic

Python owns:
  packages/compost-ingest/**      extraction only
  Spawned via `uv run compost-ingest extract --policy <tp-id>`
  JSON stdin/stdout contract, never touches DB
  Returns: { chunks[], facts[], entities[], normalized_content, content_hash_*, warnings[] }

Guardrails:
  uv.lock committed
  Schema contract test on every Python dep bump
  install.sh runs both `bun install` and `uv sync --frozen`
  kb_ingest test fixtures for: .md, .pdf (tables), .html (with boilerplate)
```

## transform_policy: Date-stamp wins (3-1 with my vote)

Sonnet and Codex converge on `tp-YYYY-MM[-NN]`. Gemini argues for semver so L4 can programmatically reason about compatibility (MAJOR = rebuild L1, MINOR = compatible, PATCH = metadata). Gemini's argument is substantive but wrong for this system. Here is why:

**The compatibility reasoning Gemini wants already lives in the `derivations` table, not the policy ID.** The L0 schema from debate #1 has:

```sql
CREATE TABLE derivations (
  observe_id TEXT REFERENCES observations(observe_id),
  layer TEXT CHECK(layer IN ('L1','L2','L3')),
  transform_policy TEXT,
  model_id TEXT,
  derived_at TEXT
);
```

The rebuild decision is:

```sql
-- L1 rebuild needed:
SELECT observe_id FROM observations o
WHERE NOT EXISTS (
  SELECT 1 FROM derivations d
  WHERE d.observe_id = o.observe_id
    AND d.layer = 'L1'
    AND d.model_id = 'nomic-embed-text-v1.5'  -- current target model
);
```

The code does not need to parse the policy ID to decide rebuild scope. It asks the derivations table directly: "which observations lack a derivation under the current target?" That query is agnostic to whether the policy is named `tp-2026-04-02` or `tp-1.2.0` — it uses the explicit `model_id` and `layer` columns.

**Semver would actually encourage bugs here.** "This is just a MINOR chunk size change, existing L1 vectors stay valid" — but a chunk size change DOES invalidate existing L1 embeddings because the chunks themselves are different. The semver intuition from APIs (additive changes are compatible) doesn't translate to data pipelines (almost every extraction change is effectively "major" in its downstream impact). Gemini's scheme would tempt someone to ship a `tp-1.1.0` and skip a rebuild that should have happened.

**Date-stamp is honest about what a policy is:** an immutable configuration snapshot from a time window, with no implicit compatibility claims. Code reasons about compatibility via explicit fields in the registry entry (embedding model ID, chunk params, prompt version) — not via the name.

**One refinement to the date-stamp convention Sonnet and Codex proposed:** each policy registry entry should include explicit `supersedes` and `migration_notes` fields so the relationship between policies is tracked without abusing the name:

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
    // ... changed fields ...
    migration_notes: 'Bumped chunk overlap 100→150 to improve cross-chunk fact linking. Requires L1 rebuild for observations indexed under tp-2026-04.',
  },
} as const;
```

The `supersedes` + `migration_notes` give you the semver-like reasoning without the false compatibility promise.

## Final Answers

- **D3: hybrid, 4-0 unanimous.** Keep phase0-spec §0-§5 as written.
- **transform_policy: `tp-YYYY-MM[-NN]` date-stamp, 3-1.** Keep phase0-spec §2 as written, but add the `supersedes` + `migration_notes` fields to the registry entry example.

Both decisions are now fully closed. Phase 0 can begin.
