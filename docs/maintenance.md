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
restores it. Only chunks included in the rebuild are marked embedded.

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
