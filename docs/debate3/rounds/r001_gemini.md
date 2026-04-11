As the ECOSYSTEM AND STRATEGIC voice, I am looking at the 2031 horizon where "memory" is a utility as ubiquitous as DNS. The Phase 0 spec is a masterful tactical blueprint for a local-first RAG, but it contains three "poison pills" that will prevent it from ever becoming the portable, self-evolving brain the user envisions.

### 1. Top 3 Architectural Risks

**Risk 1: The "Local-Only" Data Silo (Axis 5: Portability/Sync)**
The spec (§9) explicitly forbids Dropbox/iCloud sync to avoid SQLite/LanceDB corruption. While tactically sound for a 1-week build, this is a strategic dead end. In 2031, a user's "brain" must follow them across devices. Relying on "rebuild from L0 anchor" is a massive hidden cost (LLM tokens for L2/L3 extraction) that makes portability an expensive luxury rather than a default. Without a **Sync-as-Protocol** (e.g., Litestream-style S3 replication or a CRDT-based ledger), the memory bank is trapped on the machine where it was born.

**Risk 2: Context as a Metadata Tag, not a Scope (Axis 3: Context Switching)**
The `facts` table (§1.6) uses `contexts TEXT NOT NULL DEFAULT '[]'`. This is a "JSON-array hack." Humans don't switch contexts by filtering tags; they switch by entering a different behavioral environment with different rules. A flat array fails to handle **context inheritance** (e.g., "Work" facts should be visible in "Project X" context, but not vice-versa) or **context-specific overrides**. It treats context as a filter on a global pool rather than a first-class namespace.

**Risk 3: Single-Writer Mutex scaling cliff (Axis 4: Multi-Agent Concurrency)**
The spec (§9) mandates a single-writer `AsyncMutex` for LanceDB and assumes a single `compost-daemon`. If `claude-code`, a browser extension, and a mobile sync agent all try to "absorb" knowledge simultaneously, the stdio-bound daemon becomes a bottleneck. By pinning the architecture to a local-process mutex rather than a **transactional outbox protocol** that can bridge machines, we are locking into a single-host architecture that cannot scale to a multi-agent ecosystem.

### 2. Concrete Schema Change: The "Context-Scope" Pivot

To move from "tags" to "environments," we must elevate Context to a table that defines the visibility and trust rules for that environment.

```sql
-- Replace the contexts column in facts/wiki_pages with a Scope bridge
CREATE TABLE context_scopes (
  id TEXT PRIMARY KEY,           -- e.g., "work", "private", "project-zylo"
  parent_id TEXT REFERENCES context_scopes(id), -- Hierarchy for inheritance
  isolation_level TEXT CHECK(isolation_level IN ('shared', 'isolated')),
  default_trust_threshold REAL DEFAULT 0.8,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Refactor facts to link to Scope
CREATE TABLE fact_scopes (
  fact_id TEXT NOT NULL REFERENCES facts(fact_id),
  scope_id TEXT NOT NULL REFERENCES context_scopes(id),
  PRIMARY KEY (fact_id, scope_id)
);
```

### 3. Axis Scoring (0-3)

*   **Self-evolution: 2.** L0-L4 + `derivations` table (§1.3) is solid; it allows the system to "re-think" as models improve.
*   **External Absorption: 3.** The adapter outbox + Python extraction boundary (§4) is the project's greatest strength.
*   **Context Switching: 1.** Currently just a string-array filter; lacks the "physical environment" isolation the user requested.
*   **Multi-Agent Concurrency: 1.** Stdio MCP + local mutex limits this to one host. 2031 agents will need a network-aware protocol.
*   **Portability/Sync: 0.** Forbidden sync + local-only paths (`~/.compost`) = zero portability. This is the biggest gap.
*   **Dependency Graph: 3.** The 23-step checklist is logically perfect for a local build.

### 4. Strategic Disagreements

I disagree with the conclusion in **Debate #2 regarding `transform_policy` being a local-only TypeScript registry (§2)**. If this memory is to be shared across agents (Axis 4), the `transform_policy` (the "DNA" of the memory) must be stored **inside the L0 ledger** as a table, not just a hardcoded registry in the `compost-core` source. If an external agent connects to a 3-year-old memory bank, it shouldn't need a specific version of the Node source code to understand how the facts were extracted. The policy is data, not just code.
