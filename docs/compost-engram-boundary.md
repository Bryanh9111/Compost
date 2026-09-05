# Compost / Engram Boundary

> Status: active baseline, 2026-05-05
> Decision source: user clarification after five-provider monorepo debate
> Related memories: Engram `656277969e90`, `96cb2edfb6a8`

## Current Decision

Compost and Engram stay as separate sibling repos for now.

The monorepo debate showed that a technical monorepo is possible, but it did
not prove that now is the right time. While both systems are still evolving,
the lower-risk path is to keep the existing repo split and improve boundary
checks, readiness probes, and cross-repo integration tests.

This refines, but does not contradict, the debate result:

- A strict package monorepo remains technically acceptable in the future.
- A full system merge remains out of scope.
- Runtime independence remains non-negotiable.

## Hard Boundary

HC-1 from `docs/engram-integration-contract.md` remains the controlling
contract:

- Compost must run without Engram installed.
- Engram must run without Compost installed.
- One side being down, removed, or crashed must not degrade the other side's
  local availability.

Engram keeps the zero-LLM hot path for `recall()` and proactive recall.
Compost keeps the metacognitive ledger/router role and does not own atomic
memories or persistent background wisdom.

## Allowed Coupling

Allowed Compost surfaces:

- `packages/compost-engram-adapter/`
- CLI commands for `engram-pull`, `engram-push`, and local reconciliation
- Daemon wiring that is disabled or degraded safely when Engram is absent
- MCP contract fixtures, readiness probes, and integration tests
- Documentation pointers to Engram contract sections

Disallowed coupling:

- `compost-core` importing `compost-engram-adapter`
- `compost-core` depending on the MCP SDK for Engram communication
- hard-coded local Engram repo paths in source packages
- Compost requiring `engram-server` or `ENGRAM_DB` for core query/ask/reflect
- shared "memory core" abstractions that blur Compost and Engram ownership

## Low-Risk Checks

Run the boundary drift check:

```bash
bun run check:engram-boundary
```

Run the Engram readiness probe when working on bidirectional integration:

```bash
bun scripts/probe-engram-readiness.ts --engram-repo ../Engram
```

Run the real Engram subprocess e2e when `engram-server` is on `PATH`:

```bash
bun test packages/compost-engram-adapter/test/engram-e2e-integration.test.ts
```

The boundary check is intentionally local and static. The readiness probe and
e2e test cover the runtime contract.

## Runtime Hygiene

Compost may keep one `engram-server` subprocess alive for its Engram write flusher. The read poller invokes the Engram CLI per batch.
That process should have the Compost daemon as its parent. A large number of
old `engram-server` stdio processes usually means stale MCP clients were not
reaped; it is a process hygiene issue, not a reason to merge repos.

Useful checks:

```bash
compost daemon status
uv --directory ../Engram run engram stats
ps -axo pid,ppid,comm,args | grep engram-server
```

After cleaning stale Engram MCP processes, verify both sides again: Compost
doctor checks should be clean, Engram SQLite `quick_check`/`integrity_check`
should return `ok`, and a fresh Engram CLI or MCP call should respond.

## Revisit Triggers

Reconsider a technical monorepo only if at least one of these persists across
multiple iterations:

- Compost and Engram repeatedly require lockstep changes to the same MCP
  contract.
- Integration drift recurs despite the readiness probe and e2e test.
- Release or install management becomes more expensive than boundary risk.
- Both projects reach a stable/final architecture and their release,
  licensing, and public audience constraints remain aligned.

If those triggers fire, the next step is an ADR for a strict package monorepo
with standalone build/test jobs for both sides.

## Pagination and lifecycle reconciliation (2026-09-05)

The nine-field content projection is unchanged. `stream_for_compost` and
`export-stream` accept optional `after_id` / `--after-id` with `since`, forming
a `(created_at, memory_id)` cursor with microsecond precision. Existing callers
using only `since` retain strict timestamp semantics. The consumer persists a
cursor only after every entry in the batch is ingested successfully; replays
reuse stable `engram://memory/<id>` action identities. Actions survive sensory
GC; reingestion relinks a detached observation pointer.

`states_for_compost(memory_ids)` / `export-states --ids ...` return only lifecycle
metadata for at most 1,000 IDs: memory_id, status, expires_at and searchable.
Before each pull, the adapter checks cached active facts and archives entries
that are obsolete, missing or expired upstream. This does not erase history or
copy durable knowledge ownership. Missing/incomplete/error responses retain the
cache and produce a degraded diagnostic. Core queries never depend on Engram
availability; invalidation is eventually consistent at the next successful poll.

A readiness probe now performs an actual read-only MCP handshake/tools/list,
checks these contracts and closes its subprocess. After a non-editable `uv tool`
installation, source changes require reinstalling the tool and reconnecting MCP
clients; a repo test alone does not verify the installed runtime.
