# Supported audit repair and recovery

`compost maintenance` requires an explicit operation and previews by default:

```bash
compost maintenance --scrub-pii --repair-access-log --backfill-actions
compost maintenance --scrub-pii --repair-access-log --backfill-actions --apply
```

Apply creates a private SQLite backup, verifies quick_check/integrity_check, then
performs repairs transactionally. The content-free maintenance_audit records
changed fields, hashes and backup pointers. A failing audit/repair rolls back the
transaction. Concurrently changed text fails its compare-and-swap condition.
Backups contain original private content and must remain in the private data directory.

Privacy repair is an explicit administrative exception to immutable captured
content: it redacts text in outbox, observations, chunks, facts and action
summaries. Source files and Engram memories stay authoritative. Stable IDs and
idempotency keys remain unchanged; redacted content hashes are recomputed and
chunk embeddings marked pending. It never outputs original contents. Regex
matches include false positives, especially long numeric IDs. Preview reports
candidate counts, not proven credential leaks. Rebuild embeddings when needed:
`compost doctor --rebuild L1` (requires the local embedding service).
The rebuild embeds each chunk once, builds a unique temporary index and retains
the previous index as `lancedb-rebuild-<timestamp>-<pid>-previous`; a failed swap
restores it. Only chunks included in the rebuild are marked embedded. A rebuild
reads only the SQLite chunk manifest, so it refuses while the manifest is
incomplete (see below); `--force` overrides that check and drops the vectors of
every observation without manifest rows.

## Vector index consolidation and chunk manifest backfill

Before migration 0028 the extractor's document-local chunk ids (`c0`, `c1`, ...)
were stored as the global `chunks.chunk_id`, so most observations lost their
manifest rows while their vectors still landed in LanceDB. Two operations repair
that history. Both require the daemon to be stopped (`compost daemon stop`) and
preview by default:

```bash
compost maintenance --consolidate-vectors --include-previous ~/.compost/lancedb-rebuild-<ts>-<pid>-previous
compost maintenance --consolidate-vectors --include-previous <dir> --apply
compost maintenance --backfill-chunks
compost maintenance --backfill-chunks --apply --concurrency 4
```

`--consolidate-vectors` rebuilds the index from the live table plus any older
copies without re-embedding: rows whose observation no longer exists are
dropped, duplicates are deduped with the live index winning, legacy ids are
rewritten to `<observe_id>:<local id>`, and the compacted table is swapped in
atomically. The replaced live index is kept as
`lancedb-consolidate-<ts>-<pid>-previous`.

`--backfill-chunks` re-runs the extractor (chunks only, no LLM calls) on the
stored raw bytes of every observation whose recorded chunk count exceeds its
manifest rows. When the re-extraction reproduces exactly the vectors LanceDB
holds, the rows are inserted as embedded with their fact mapping; otherwise they
are inserted pending and the observation's stale vectors are dropped so the
daemon's idle sweep re-embeds them. `--limit <n>` paces a large backlog.

Keep every `-previous` directory until `compost doctor --check-integrity` and a
search smoke test have been clean for a few days, then delete them by hand; the
pre-rebuild copy may be the only index holding older vectors.

## Ingest retries and quarantine

Extraction failures back off (60s, 120s) and quarantine the queue row on the
third exhausted attempt. `compost daemon status` prints
`ingest: pending=N quarantined=M unembedded=K` and `doctor --check-integrity`
counts `quarantined_ingest` as an issue. Review `ingest_queue.last_error`, fix
the cause, then requeue with a fresh attempt counter:

```bash
compost doctor --ingest-retry all
compost doctor --ingest-retry <queue id>
```

Chunks the embedding service answered with the wrong shape are isolated through
`chunks.embed_error` (reported as `embed_error_chunks`); clear the column to let
the sweep try them again.

Access repair removes only references to facts that no longer exist. Action
backfill runs the normal action processor on observations lacking an action;
unknown observation types can remain unindexed. It does not synthesize knowledge.

Recover history still available from Engram after missed ingestion or sensory GC:

```bash
compost engram-pull --replay --dry-run
compost engram-pull --replay --no-embed
```

Replay backs up the ledger and previous cursor, then uses normal supported
stream ingestion. It recovers currently exportable upstream memories, not
records already removed upstream. Duplicate entries reuse stable action IDs.
`--no-embed` defers vectors; BM25 stays usable. A filtered pull requires its own
`--cursor-path`, so it cannot accidentally advance the daemon's global cursor.

Verify `compost doctor --check-integrity`, `--check-pii`, and
`--reconcile-engram`. Integrity includes SQLite quick_check, every FK and FTS
external-content consistency; findings cause exit 1. PII findings also cause
exit 1. Engram lint staleness/missing-evidence warnings need source review and
are never an instruction to bulk-delete or automatically resolve memories.
