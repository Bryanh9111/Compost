I will read the framing and context files to understand the architectural options and the strategic requirements for the Compost ecosystem.
I will search for "Option A" and "Option B" in the `docs/` directory to identify the architectural choices being debated, and I'll also try to read the framing file using a shell command since it's located in `/tmp`.
As the **ECOSYSTEM AND STRATEGIC** voice, I have analyzed the trade-offs between per-adapter isolation (Option A) and a unified ledger-integrated outbox (Option B). For a system that promises "the brain follows you across devices" and "Auditable Coverage," the choice must prioritize structural integrity and scalability of the ecosystem over individual process isolation.

### 1. Pick
**Option B — Merge outbox into ledger.db**

### 2. Rationale
A unified storage model is the only architectural path that ensures the "brain" remains a cohesive, portable unit. Fragmenting the sensory buffer into per-adapter files introduces a "split-brain" risk during sync, backup, and migration that undermines the long-term vision of a portable cognitive identity. Furthermore, the arbitrary 10-adapter `ATTACH` limit in Option A is a legacy ceiling that a modern multi-agent ecosystem cannot accept; we must design for dozens of specialized adapters and tools without hitting a hard-coded SQLite limit.

### 3. Concrete failure mode survived
Option B survives a **partial filesystem sync or backup restore**. In Option A, if a user restores `ledger.db` from a backup but keeps a more recent `adapters/claude-code/outbox.db`, the transactional sequence is broken: the outbox might contain "drained" markers for `observe_id`s that no longer exist in the restored ledger, or vice-versa. In Option B, the outbox and the observations ledger are a single atomic snapshot; you can never lose the "connective tissue" between a pending event and its captured state during a device migration.

### 4. Concrete concession
We give up **write-path isolation and durability fault-tolerance**. Under Option B, a single rogue adapter or a long-running transaction on `ledger.db` (e.g., a heavy `reflect()` vacuum or a complex L2 re-indexing) will block the hook shims of every other adapter. We are moving the complexity from "how do we manage 10+ file handles" to "how do we ensure no process holds the SQLite write lock for more than 5-10ms."

### 5. Hook shim cold-start impact
This choice puts the **≤30ms p95 gate at risk but is manageable**. SQLite's `open` performance is largely invariant to file size; the primary risk to cold start is waiting for a write lock or processing a large WAL file. To preserve the gate, we must mandate that the `compost-daemon` performs aggressive, non-blocking WAL checkpoints (`PRAGMA wal_checkpoint(PASSIVE)`) to keep the WAL header small, ensuring the shim's 20ms budget is spent on library loading rather than journal recovery. If the p95 exceeds 30ms, the fallback is to move the hook shim to a native Go/Rust binary that bypasses the Node runtime cost entirely.

### 6. Schema migration path
1. **Schema Update**: Move the `observe_outbox` DDL from §1.6 into a core migration (e.g., `0005_merged_outbox.sql`).
2. **Shim Refactor**: Update `compost-hook-shim` to resolve the path to `~/.compost/ledger.db` instead of a per-adapter subdirectory.
3. **Adapter SDK**: Update `HostAdapter` in `packages/compost-adapter-sdk` to use a shared connection string for the outbox.
4. **Daemon Logic**: The daemon's drain loop simplifies from a multi-file polling orchestrator to a single, prioritized SQL query: 
   ```sql
   SELECT * FROM observe_outbox WHERE drained_at IS NULL ORDER BY appended_at ASC LIMIT 50;
   ```
   This allows the daemon to drain events from *multiple* adapters in a single atomic transaction, significantly improving ingest throughput for multi-agent swarms.
