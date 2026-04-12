import type { Database } from "bun:sqlite";

/**
 * Transform policy registry — canonical source of truth.
 * Spec §2: each policy is immutable once active. New policies require
 * a new tp-* key with supersedes link.
 */

export interface TransformPolicy {
  id: string;
  supersedes: string | null;
  effective_from: string;
  chunk: { size: number; overlap: number };
  embedding: { model: string; dim: number };
  factExtraction: { prompt: string; model: string };
  wikiSynthesis: { prompt: string; model: string };
  dedup: { minhashJaccard: number; embeddingCosine: number };
  normalize: { stripBoilerplate: boolean; collapseWhitespace: boolean };
  factDecay: { halfLifeSeconds: number };
  extraction: {
    timeoutSec: number;
    maxRetries: number;
    extractorMinVersion: string;
  };
  migration_notes: string;
}

export const policies = {
  "tp-2026-04": {
    id: "tp-2026-04",
    supersedes: null,
    effective_from: "2026-04-01",
    chunk: { size: 800, overlap: 100 },
    embedding: { model: "nomic-embed-text-v1.5", dim: 768 },
    factExtraction: { prompt: "fact-extract-v1", model: "claude-opus-4-6" },
    wikiSynthesis: { prompt: "wiki-synth-v1", model: "claude-opus-4-6" },
    dedup: { minhashJaccard: 0.98, embeddingCosine: 0.985 },
    normalize: { stripBoilerplate: true, collapseWhitespace: true },
    factDecay: { halfLifeSeconds: 2592000 }, // 30 days
    extraction: {
      timeoutSec: 120,
      maxRetries: 3,
      extractorMinVersion: "compost-ingest@0.1.0",
    },
    migration_notes: "Initial Phase 0 policy.",
  },
  "tp-2026-04-02": {
    id: "tp-2026-04-02",
    supersedes: "tp-2026-04",
    effective_from: "2026-04-12",
    chunk: { size: 800, overlap: 100 },
    embedding: { model: "nomic-embed-text-v1.5", dim: 768 },
    factExtraction: { prompt: "fact-extract-v1", model: "claude-opus-4-6" },
    wikiSynthesis: { prompt: "wiki-synth-v1", model: "claude-opus-4-6" },
    dedup: { minhashJaccard: 0.98, embeddingCosine: 0.985 },
    normalize: { stripBoilerplate: true, collapseWhitespace: true },
    factDecay: { halfLifeSeconds: 2592000 }, // 30 days
    extraction: {
      timeoutSec: 120,
      maxRetries: 3,
      extractorMinVersion: "compost-ingest@0.1.0",
    },
    migration_notes:
      "Phase 2 web policy. Uses trafilatura for HTML boilerplate removal. Same chunk/embedding config as tp-2026-04.",
  },
} as const satisfies Record<string, TransformPolicy>;

export type PolicyId = keyof typeof policies;

/**
 * Upsert all registry entries into the SQL policies table.
 * Called at daemon startup BEFORE opening MCP server or drain loop.
 */
export function upsertPolicies(db: Database): void {
  const stmt = db.prepare(`
    INSERT INTO policies (policy_id, supersedes, effective_from, definition_json, migration_notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(policy_id) DO UPDATE SET
      definition_json = excluded.definition_json,
      migration_notes = excluded.migration_notes
  `);

  const tx = db.transaction(() => {
    for (const policy of Object.values(policies)) {
      stmt.run(
        policy.id,
        policy.supersedes,
        policy.effective_from,
        JSON.stringify(policy),
        policy.migration_notes
      );
    }
  });

  tx();
}

/**
 * Application-layer referential integrity check.
 * Spec §2: every writer calls this before insert. Throws with actionable
 * error message instead of SQLite's opaque FK failure.
 */
export function validatePolicyExists(db: Database, policyId: string): void {
  const row = db
    .query("SELECT 1 FROM policies WHERE policy_id = ?")
    .get(policyId);

  if (!row) {
    throw new Error(
      `transform_policy \`${policyId}\` is not registered — add it to \`packages/compost-core/src/policies/registry.ts\` and restart the daemon`
    );
  }
}

/**
 * Returns the latest policy that is not superseded by another.
 */
export function getActivePolicy(): TransformPolicy {
  const allPolicies = Object.values(policies);
  const supersededIds = new Set(
    allPolicies.map((p) => p.supersedes).filter(Boolean)
  );

  const active = allPolicies.filter((p) => !supersededIds.has(p.id));
  // With a single policy, this is trivially the only one.
  // With multiple, return the latest by effective_from.
  active.sort(
    (a, b) =>
      new Date(b.effective_from).getTime() -
      new Date(a.effective_from).getTime()
  );

  return active[0];
}
