# Portability

## Local-disk-only constraint

All Compost data lives under `~/.compost/`. This directory must reside on local disk, not on a sync service (Dropbox, iCloud Drive, OneDrive, Google Drive, or any FUSE-mounted network path).

`scripts/install.sh` detects common sync service paths and exits with an error if `~/.compost/` resolves into one. This check runs before any writes.

Why the restriction:
- SQLite WAL mode requires atomic file operations on the underlying filesystem. Network filesystems and sync services do not provide these guarantees.
- Sync services can rename or lock files mid-write, corrupting the WAL or SHM sidecar files.
- SQLite's WAL journal (`ledger.db-wal`) and shared-memory file (`ledger.db-shm`) are not safe to sync across machines concurrently.

## Directory layout

```
~/.compost/
  ledger.db         - sole persistent state (SQLite WAL mode)
  ledger.db-wal     - WAL journal (transient, do not snapshot mid-write)
  ledger.db-shm     - shared memory (transient)
  blobs/            - raw content payloads > 64 KiB (referenced via blob_ref)
  wiki/             - L3 synthesized markdown pages (Phase 1+)
  logs/             - daemon logs (pino JSON, rotated by the daemon)
  lance/            - LanceDB vector store (Phase 1+)
  lancedb.lock      - proper-lockfile cross-process write lock for LanceDB
```

## Permissions

`scripts/install.sh` applies `chmod 700` to `~/.compost/` and all subdirectories. The `ledger.db` file itself is created with `0600` by better-sqlite3. WAL/SHM sidecars inherit permissions from the parent directory.

Default macOS umask (022) would create world-readable directories. `chmod 700` restricts access to the owning user only. This does not protect against root or same-user processes, but closes the multi-user-machine data leak.

## Backup

Backup = copy `~/.compost/` directory.

For a consistent snapshot, checkpoint WAL first:

```bash
# Checkpoint WAL to merge all changes into the main database file
sqlite3 ~/.compost/ledger.db "PRAGMA wal_checkpoint(TRUNCATE);"
# Then copy
cp -a ~/.compost/ /path/to/backup/
```

If `compost-daemon` is running, use `compost daemon status` to confirm no writes are in flight before checkpointing. The daemon exposes a `compost.checkpoint` MCP tool for this purpose (Phase 1+).

## `ledger.db` as sole persistent state

Everything Compost knows is derivable from `ledger.db`:
- `observations` - the immutable append-only ledger (the rebuild anchor)
- `facts` - L2 semantic facts with decay metadata
- `wiki_pages` - L3 page registry (page content lives under `~/.compost/wiki/`)
- `observe_outbox` - durably queued but not yet drained observations
- All SLO tracking, policy registry, queue state, ranking profiles

The LanceDB vector store under `~/.compost/lance/` (Phase 1+) is derived from `observations` via the active `transform_policy`. It can be rebuilt from the ledger:

```bash
compost doctor --rebuild L1 --policy tp-YYYY-MM
```

## Cross-machine sync

Cross-machine sync is Phase 5. The architecture does not prevent it, but Phase 0-4 make no provision for it. Do not attempt to sync `~/.compost/` via a file sync service for any reason.

The intended Phase 5 path is a deliberate export/import protocol (not filesystem sync) that respects WAL boundaries and idempotency keys.

## No cloud dependencies for core operation

`compost-daemon`, `compost query`, and `compost hook` operate entirely on local disk. No network requests are required for the core ingest and retrieval pipeline. LLM model calls (fact extraction, wiki synthesis) require outbound network access, but the ledger and query path do not.
