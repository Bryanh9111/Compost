# Transform Policy Versioning

## Format

```
tp-YYYY-MM[-NN]
```

- `YYYY-MM` - year and month when the policy became active
- `-NN` - optional in-month revision counter (starts at `02` if a second version lands in the same month)

Examples: `tp-2026-04`, `tp-2026-04-02`, `tp-2026-05`

## What a policy encapsulates

Each policy is an immutable snapshot of every parameter that affects derivation output:

- chunk size and overlap
- embedding model ID and vector dimension
- fact extraction prompt version and model
- L3 wiki synthesis prompt version and model
- deduplication thresholds (MinHash Jaccard, embedding cosine)
- content normalization rules (whitespace, boilerplate stripping)
- extraction timeout

A change to any of these parameters requires a new policy key, not an edit to an existing one.

## Immutability rule

Once a policy key is active (i.e., any `observations.transform_policy` row references it), the policy record is frozen. The registry entry must not be modified.

To update parameters: add a new entry with a new key and set `supersedes` to the prior key.

```typescript
// packages/compost-core/src/policies/registry.ts

export const policies = {
  'tp-2026-04': {
    id: 'tp-2026-04',
    supersedes: null,
    effective_from: '2026-04-01',
    chunk: { size: 800, overlap: 100 },
    embedding: { model: 'nomic-embed-text-v1.5', dim: 768 },
    factExtraction: { prompt: 'fact-extract-v1', model: 'claude-opus-4-6' },
    wikiSynthesis: { prompt: 'wiki-synth-v1', model: 'claude-opus-4-6' },
    dedup: { minhashJaccard: 0.98, embeddingCosine: 0.985 },
    normalize: { stripBoilerplate: true, collapseWhitespace: true },
    extraction_timeout_sec: 30,
    migration_notes: 'Initial Phase 0 policy.',
  },
} as const;
```

## Required fields per entry

| Field | Purpose |
|---|---|
| `id` | Must match the registry key |
| `supersedes` | Key of the prior policy, or `null` for the first |
| `effective_from` | ISO date when this policy started being used |
| `migration_notes` | One paragraph: what changed, which layers need rebuild |

`migration_notes` is the field an operator reads at 2am to understand why a rebuild produced different facts than expected.

## Not a SQL foreign key

`observations.transform_policy` is a `TEXT` column, not an `INTEGER REFERENCES policies(id)`. The FK relationship is application-layer: any policy key written into observations must exist in `packages/compost-core/src/policies/registry.ts` at write time. `compost doctor --reconcile` verifies this post-hoc and flags orphaned policy tags.

Rationale for application-layer validation: the `policies` table is populated from the TS registry at install time and on schema:apply. A SQL FK would require the table to be populated before any observation can be inserted, creating a strict ordering dependency that breaks embedded-mode and offline replay. Application-layer validation is an explicit trade-off documented in debate #2.

## Date-stamp over semver

Semver implies compatibility semantics (MAJOR/MINOR/PATCH) that do not translate to data extraction pipelines. A "minor" chunk size change still invalidates existing L1 vectors. The `derivation_run` table encodes rebuild requirements directly via `(layer, model_id)` columns; code never needs to parse the policy name to decide scope.

Date-stamp is honest: each key is a different configuration snapshot active in a time window. Make no compatibility assumptions between any two keys. The `supersedes` + `migration_notes` fields carry the relationship reasoning that semver would have encoded in the name.

Git SHA is rejected because it is opaque in SQL queries and in code review.

## Registry location

`packages/compost-core/src/policies/registry.ts`

The `schema:apply` script calls `upsertPolicies()` to sync the TS registry into the `policies` SQL table before any writer can connect.
