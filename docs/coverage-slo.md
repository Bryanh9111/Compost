# Coverage SLO

Compost tracks coverage as a measured service-level objective, not a promise.

## What coverage means

Coverage for a source is defined as:

```
coverage(source_id) = captured_items / expected_items
```

where:
- `expected_item(source_id, external_id)` - an item we expected to see (e.g. an RSS guid, a sitemap URL, a commit sha)
- `captured_item(source_id, external_id, observe_id)` - an item that was actually ingested

Both tables live in `~/.compost/ledger.db`. They are populated by adapters and crawlers that have advance knowledge of what a source should contain (e.g. an RSS feed with a known item count, a directory listing).

## No coverage guarantee

Compost does not guarantee that every item from every source has been captured. Sources may be:
- temporarily unreachable
- behind rate limits
- partially indexed
- not yet subscribed to

`coverage_target` on the `source` table records the operator-set SLO for that source (0.0 = no tracking). Meeting the target is aspirational; the system reports drift, not promises.

## `compost doctor --reconcile`

Reports coverage delta per source:

```
source_id              expected  captured  delta  coverage
local:notes-dir        142       139       -3     97.9%
web:nextjs-docs        88        88         0    100.0%
claude-code:sessions   214       211       -3     98.6%
```

Delta items are L0 observations that have `expected_item` rows with no matching `captured_item`. These are candidates for manual review or a re-ingest run.

The reconcile command also runs a policy audit: verifies no `observations.transform_policy` tag references a policy key absent from `packages/compost-core/src/policies/registry.ts`.

## Schema

```sql
-- Items we expected to see for a given source
CREATE TABLE expected_item (
  source_id   TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  expected_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

-- Items we actually captured
CREATE TABLE captured_item (
  source_id   TEXT NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  observe_id  TEXT NOT NULL REFERENCES observations(observe_id) ON DELETE CASCADE,
  PRIMARY KEY (source_id, external_id, captured_at)
);
```

Coverage is a ratio derived from these two tables at query time. It is not stored as a cached column.

## Relationship to `coverage_target`

`source.coverage_target REAL DEFAULT 0.0` sets the SLO floor. A value of `0.95` means the operator expects 95% of known items to be captured. Compost will surface a warning in `compost daemon status` when measured coverage drops below the target, but will not stop ingesting or block operations. It is a monitoring signal, not an enforcement gate.

## SLO vs guarantee

Coverage figures reported by `compost doctor --reconcile` reflect the state of `expected_item` and `captured_item` at the time of the query. They do not reflect items that were never registered in `expected_item`. Sources without an enumerable manifest (e.g. a watched directory that grows incrementally) cannot have a meaningful coverage ratio and should have `coverage_target = 0.0`.
