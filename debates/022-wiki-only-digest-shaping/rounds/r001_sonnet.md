# Sonnet (Pragmatic Implementer) - Round 1

**Pick: (d) JOIN wiki_page_observe -> observations -> facts to extract real contributing fact_ids.**

---

## Why not the other three

**(b) is a hard no.** `compost_fact_ids` is not a display field - it is the key that `computeRootInsightId()` feeds into a UUIDv5 namespace (`splitter.ts:40-47`). If you stuff sha1(wiki:path) in there, `invalidate_compost_fact` in Engram will silently match nothing - R3 becomes a lie wrapped in a zod parse that still passes. At 2am when you're tracing why an invalidated fact keeps surfacing in recalls, you will not find the bug quickly. Contract breaks compound.

**(a) is a bandage that creates a new wound.** Dropping floor from 0.85 to 0.75 unblocks dogfood but permanently conflates two semantically distinct thresholds: digest-worthiness vs arbitration confidence. Right now `CONFIDENCE_FLOORS.instance` is shared with `digest.ts:68`. Once you ship 0.75 as the digest default, future arbitration logic that imports the same constant gets silently weakened. 1-line change, multi-system footgun.

**(c) is honest but it kills the first live test.** The whole point of S6-2 dogfood is validating the MCP write transport end-to-end. A wiki-only KB means you literally never push on the first run. That is not a test - it is a timeout.

---

## Option (d): real JOIN path

The schema already has it. `wiki_page_observe` links `page_path -> observe_id`, and `observations` links to source ingestion which is how facts get created. The missing piece is whether there is a direct or indirect `observe_id -> fact_id` join.

Check `facts` table structure - `0001_init.sql:94` shows `confidence default 0.8`. Facts almost certainly carry an `observe_id` or `source_id` FK. If yes, the query in `selectWikiRebuilds()` can be extended:

```sql
SELECT DISTINCT f.fact_id
  FROM wiki_page_observe wpo
  JOIN observations o ON wpo.observe_id = o.observe_id
  JOIN facts f ON f.observe_id = o.observe_id   -- or f.source_id
 WHERE wpo.page_path = ?
   AND f.archived_at IS NULL
   AND f.superseded_by IS NULL
```

This gives real `fact_ids` that contributed to the wiki page synthesis. `digestInsightInput()` at `digest.ts:243-252` already collects fact_ids from `new_facts` and `resolved_gaps` - add wiki-contributing fact_ids to that same Set. No contract change, no threshold drift, no fake ids.

**Effort:** read the facts schema FK (~5 min), add the join to `selectWikiRebuilds` (return `contributing_fact_ids: string[]` alongside each `DigestItem`), update `digestInsightInput` to consume them. Call it 45-60 min total.

**If the FK does not exist** (facts has no observe_id): fall back to (c) for this dogfood run only, filed as a schema gap. Do not ship (b) as a workaround.

---

## Answers to the three questions

1. **Is (b) excused under scope=meta?** No. `compost_fact_ids` is a structural key for dedup and invalidation, not metadata. scope=meta does not widen what the field means.

2. **Should --confidence-floor override stay?** Yes, keep the flag, but document it as `[advanced] override digest confidence floor (default 0.85; note: distinct from arbitration threshold)` in CLI help. Do not rename the shared constant yet - that is a separate cleanup.

3. **Option (d)?** Yes, described above. The data path exists in the schema via `wiki_page_observe`. The question is purely whether `facts` carries `observe_id`. Verify before committing.

4. **Failure-attribution for first S6-2 dogfood?** Option (d) wins here too. If the MCP write fails, you know it is the transport, not a malformed source_trace. With (b) you'd never know if invalidation silently no-oped. With (a) you changed a threshold and now two things moved at once.

---

## The 2am debug case

With (d): push fails -> check transport logs -> single moving part. With (b): push succeeds, recall returns stale data, you grep for `invalidate_compost_fact`, find it ran, stare at fake sha1 ids that match nothing in Engram's fact index, realize the contract was hollow the whole time. That is a 2am session you do not want.
