Pick: B — Write-path vertical

## Three concrete technical reasons

1. **UUIDv5 determinism is the idempotency keystone.** `root_insight_id = uuidv5(NAMESPACE, project + '|' + sorted_fact_ids.join(','))` is the only thing preventing duplicate Engram writes on retry. If `splitter.ts` ships without `writer.ts` consuming it in the same session, the determinism contract has no test harness exercising the full path — you won't know if the UUIDv5 namespace constant drifts across module boundaries until you hit duplicate-write errors in prod.

2. **`pending-writes.db` must be co-designed with the writer call signature.** The offline queue stores the serialized `remember()` payload. If `writer.ts`'s call shape changes after `pending-writes.ts` is already merged (i.e., separate sessions), you get schema mismatch in `~/.compost/pending-engram-writes.db` — a SQLite file that has no migration system of its own. Bundling both forces the interface to be finalized once.

3. **Migration 0015 is load-bearing for splitter's `chunk_index` tracking.** `user_pattern_observations` presumably carries the FK back to `user_patterns`, which is where observation-level chunking gets anchored. Shipping splitter without 0015 means chunk metadata has nowhere to land in the DB — the splitter becomes a pure in-memory transform with no durability proof, which is an untestable stub.

## Two main risks

1. **Invalidate-before-rewrite race on the pending queue.** If Engram is briefly reachable during a retry flush, `invalidate_compost_fact` may succeed but `remember()` fails. The pending-writes queue will retry the `remember()` but the old fact is already gone — you've created a gap window with no valid Engram entry. Needs explicit two-phase log in `pending-writes.db` (invalidation committed separately from write attempt).

2. **`expires_at` default clock skew in the queue.** `expires_at = synthesized_at + 90 days` is computed at enqueue time, not at flush time. If a write sits in the offline queue for days (network outage, daemon not running), the TTL is silently shorter than intended when it finally lands in Engram. No current contract addresses this; you'll debug "fact expired too soon" reports weeks later.

## Stances

- **Write-first or read-first?** Write-first. Compost is the authority on insight freshness — the contract says so. Proving Engram can receive a compost-origin fact correctly is more foundational than proving Compost can consume Engram entries via `stream_for_compost`.

- **Migration 0015 this session?** Yes, unconditionally. Splitter chunk tracking is orphaned without it.

- **Splitter isolation (E): wise or over-fragmented?** Over-fragmented. Splitter's correctness is only provable end-to-end: UUIDv5 determinism means nothing if `writer.ts` doesn't consume `root_insight_id` the same way the splitter outputs it. Isolated tests give false confidence.

- **500-600 LoC single session?** Too aggressive given recent ~400 LoC averages. B caps at ~350 LoC, which matches the observed sustainable rate. C's extra 150-250 LoC is exactly where the stream-puller feedback-loop guard gets under-specified.

- **pending-writes.db bundled with writer (B) or own session?** Same session. The call signature must be frozen before the queue serialization format is defined — separating them guarantees a schema migration you don't want.

## If you pick something else

If you pick C, the first bug will be `stream_for_compost` returning `origin=compost` entries despite the default-exclude flag, because the shallow stream-puller implementation will skip the filter validation that only becomes obvious when you see Compost re-ingesting its own outputs.
