I will now read the required files to understand the architectural proposals and the current state of the project.
## Decision A: Stateless query-time decay
- **Score: 3/3**
- **Concrete failure mode**: **The "Archive Paradox."** In a purely stateless decay model, memories of extreme historical significance (e.g., "The day I launched project X") eventually decay toward zero score. If a user asks for "important events from 2026" five years later, a standard decayed query will return nothing unless the decay is explicitly bypassed. This breaks the "brain follows you" vision because the system effectively "lobotomizes" its own past without a manual "archival-recall" flag.
- **Required schema/code change**: Add a `decay_function` parameter to the `compost.query` contract (defaulting to `ebbinghaus`) and a `decay_floor` column in the `memories` table to allow specific "pinned" facts to resist the power-law curve.
- **Strategic rationale**: Statelessness is the only path to **cross-machine convergence** without a massive sync-engine overhead. If decay were a background write job, syncing two machines would result in thousands of "drift" conflicts as clocks and job schedules inevitably diverge. By making decay a query-time view, we ensure the "objective ledger" remains identical across devices, while allowing the "subjective lens" (recency) to be calculated locally. This aligns with the "Museum vs. Living Stream" requirement from Debate #1.

## Decision B: Probabilistic multi-factor ranking formula
- **Score: 2/3**
- **Concrete failure mode**: **"Explainability Debt."** As we move toward 2031, autonomous agents will be judged by their auditability. A 7-factor weighted sum is a "black box" that makes it impossible for an external agent or user to understand *why* a specific memory surfaced. If the system returns a "bad result," there is no "Trace" path to see if it was due to `emotional_intensity` being too high or `temporal_relevance` being too low.
- **Required schema/code change**: The `QueryHit` interface in `packages/compost-core/src/api.ts` must be updated to include a `ranking_components: Record<string, number>` field that returns the raw scores for all 7 factors before weighting. 
- **Strategic rationale**: While probabilistic ranking is correct for "brain-like" nuance, we must avoid "vibes-based" architecture. By returning the component scores, we enable **multi-agent sharing** where different agents can apply their own "re-ranking" logic on top of Compost’s raw signals. This prevents vendor lock-in and allows the ranking formula to evolve into an open standard rather than a fixed implementation.

## Decision C: 5-tier cognitive memory in ONE physical table
- **Score: 3/3**
- **Concrete failure mode**: **"Storage Class Collision."** SQLite stores data in pages. If the `memories` table contains both high-volume L1 vectors (megabytes of blobs) and low-volume L2 facts (kilobytes of text), a query for "just the facts" (`WHERE kind='fact'`) may still force the OS to page-in massive amounts of vector data if they are physically interleaved. On mobile/edge devices in 2031, this I/O penalty will kill "instant" recall.
- **Required schema/code change**: Implement **Vertical Partitioning** via two tables: `memory_metadata` (the kind, timestamps, and facts) and `memory_blobs` (the L1 vectors), linked by a shared `memory_id`. 
- **Strategic rationale**: This is a massive win for **portability**. A "brain" should be a single file you can move. Using a `kind` enum allows the ecosystem to add new tiers (e.g., "Spatial" or "Social" memory) without creating a "table-per-feature" mess. It also simplifies the **Auditable Coverage** story: one table, one sequence, one source of truth.

## Decision D: Hook contract replaces MCP notifications for write path
- **Score: 3/3** (Strategic upgrade over locked Decision #1)
- **Concrete failure mode**: **"The Execution Context Ghost."** A subprocess hook loses the environment variables, auth tokens, and session context of the host agent (Claude Code) unless they are explicitly serialized into the stdin JSON. If Compost needs to call an external API (like a cloud embedder) using the user's keys, the "hook" will fail silently where an "in-process" MCP call might have succeeded.
- **Required schema/code change**: The `ObserveEvent` interface in the Hook Contract must include a `host_context: JSON` field to pass through necessary session state (working directory, platform, etc.) from the caller to Compost.
- **Strategic rationale**: **Infrastructure Hardening.** Debate #1 locked MCP notifications because we wanted a "standard." However, evidence from the Claude Code survey shows that **stdio MCP is too fragile for the write path**. If the daemon is down, the notification vanishes. A **Hook Contract** (subprocess + stdin + exit code) is a "harder" OS-level integration. It allows the `compost hook` binary to act as its own **Outbox**, persisting the memory to disk even if the daemon is dead. This is "2031 thinking": the system must be as resilient as a filesystem. Reopening this decision isn't "shiny-chasing"; it's moving from a "network protocol" to a "system primitive."

## Composition check
These four decisions compose into a **"Resilient Intelligence Pipeline."**
1. **Hooks (D)** provide the durable, host-agnostic entry point.
2. **One Table (C)** provides the portable, single-file container.
3. **Stateless Decay (A)** provides the drift-free, cross-machine consistency.
4. **Ranking (B)** provides the "agent-facing" interface for nuanced recall.
Architecturally, this moves Compost from being a "database with an API" to being a **"Local Memory Primitive"** that behaves like a system service (like `git` or `ssh`) rather than a fragile SaaS-lite daemon.

## Final paragraph
If I had to ship only two, I choose **Decision C (One Table)** and **Decision D (Hooks)**. These two define the **Boundary and the Container**. Decision D (Hooks) ensures that Compost can be integrated into *any* ecosystem (Claude Code, OpenClaw, or a raw shell script) with maximum durability. Decision C (One Table) ensures that once a memory is captured, it is stored in a way that is trivially portable across the 2031 device landscape. The "Decay" and "Ranking" (A & B) are algorithmic "software" that can be patched in `v2.1`, but the Hook/Table interface is the "hardware" that defines whether Compost is a lasting standard or a transient tool.
