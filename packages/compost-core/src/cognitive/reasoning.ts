/**
 * Phase 7 L5 — Cross-fact reasoning (debate 025 entry slice).
 *
 * Hybrid retrieval (ANN+FTS via existing `query()`, plus graph traversal via
 * `fact_links`) → RRF merge → LLM-synthesized chain → persist row in
 * `reasoning_chains` (migration 0018) → write back `derived_from` links to
 * `fact_links` so the graph densifies with use.
 *
 * Synthesis decisions (debate 025):
 *   Q1=(c) parallel+RRF, Q2=(α) cross-fact slice, Q3=(B) dedicated table,
 *   Q4=(q) on-demand only, Q5=(X) gapThreshold:null for the L5 internal ask.
 *   The mandatory `derived_from` write-back is the closed-loop mechanism
 *   that lets sparse-graph (b)-like behavior bootstrap into dense-graph
 *   (a)-like behavior over time.
 *
 * Idempotency: `chain_id = uuidv5(seed_kind || seed_id || policy_version ||
 * sorted candidate_ids)`. Re-running with identical inputs returns the
 * existing row. Mirrors debate 024 lesson at the L5 layer.
 */

import type { Database } from "bun:sqlite";
import { v5 as uuidv5 } from "uuid";
import type { LLMService } from "../llm/types";
import { BreakerRegistry } from "../llm/breaker-registry";
import type { VectorStore } from "../storage/lancedb";
import { query, type QueryHit } from "../query/search";
import { rrfMerge } from "../query/rrf";
import { addLink, traverse, LINK_KINDS } from "./fact-links";

/**
 * Pin the policy version inside chain_id so a future policy change
 * (different prompt, different rerank weights) does NOT collide with
 * historical chains. Bump this string when reasoning behavior changes
 * in a way that should produce a fresh row instead of returning the
 * cached one.
 */
export const POLICY_VERSION = "l5-v1";

/**
 * UUIDv5 namespace for chain_id derivation. Frozen — changing this
 * invalidates every previously stored chain_id (debate 022 §Q5 lesson:
 * UUIDv5 namespaces are append-only, not mutable).
 */
const REASONING_CHAIN_NAMESPACE = "5b9c1e7d-3b1c-5e7f-9c3a-7f8b1e2d4a6c";

const DEFAULT_TOP_K = 10;
const DEFAULT_GRAPH_HOPS = 2;
const RETRIEVAL_BUDGET = 50; // candidate fetch budget before RRF; final cut by topK

/**
 * Graph kinds we traverse for thematic relatedness. `contradicts` is
 * deliberately excluded — a contradicting fact is interesting context but
 * not a "related" fact for chain synthesis (it's its own kind of signal,
 * already surfaced by reflect.ts contradiction arbitration).
 */
const REASONING_LINK_KINDS = LINK_KINDS.filter((k) => k !== "contradicts");

export type SeedKind = "fact" | "question" | "gap" | "curiosity_cluster";

export type ChainStatus = "active" | "stale" | "superseded" | "user_rejected";

export interface ReasoningSeed {
  kind: SeedKind;
  id: string;
}

export interface ReasoningOptions {
  topK?: number;
  graphHops?: number;
  /** Pass-through to internal `query()` for ANN+FTS recall. */
  retrievalBudget?: number;
  /** Inject for tests. Defaults to deterministic policy version. */
  policyVersion?: string;
  /**
   * Disable the `derived_from` write-back side-effect. Tests / dry-runs
   * use this to keep `fact_links` clean.
   */
  noLinkWriteback?: boolean;
  /** Optional: skip LLM call entirely (returns chain=null). For dry-run. */
  noLlm?: boolean;
}

export interface RetrievalTrace {
  ann_count: number;
  fts_count: number;
  graph_count: number;
  graph_hops: number;
  rrf_top_k: number;
  retrieval_source_lists: string[];
}

export interface ChainAnswer {
  chain: string | null;
  confidence: number;
  llm_meta?: { model: string; tokens?: number };
  failure_reason?: string;
}

export interface ReasoningChain {
  chain_id: string;
  seed_kind: SeedKind;
  seed_id: string;
  policy_version: string;
  candidate_fact_ids: string[];
  edge_refs: Array<{ from: string; to: string; kind: string }> | null;
  retrieval_trace: RetrievalTrace;
  answer: ChainAnswer;
  confidence: number;
  status: ChainStatus;
  engram_insight_id: string | null;
  created_at: string;
  reused_existing: boolean;
}

// ---------------------------------------------------------------------------
// chain_id — deterministic UUIDv5
// ---------------------------------------------------------------------------

export function computeChainId(
  seedKind: SeedKind,
  seedId: string,
  policyVersion: string,
  candidateFactIds: string[]
): string {
  const sorted = [...candidateFactIds].sort();
  const key = `${seedKind}|${seedId}|${policyVersion}|${sorted.join(",")}`;
  return uuidv5(key, REASONING_CHAIN_NAMESPACE);
}

// ---------------------------------------------------------------------------
// Seed resolution → query text + optional seed fact_id for graph traversal
// ---------------------------------------------------------------------------

interface ResolvedSeed {
  queryText: string;
  graphSeedFactId: string | null;
}

function resolveSeed(db: Database, seed: ReasoningSeed): ResolvedSeed {
  if (seed.kind === "fact") {
    const row = db
      .query(
        "SELECT subject, predicate, object FROM facts WHERE fact_id = ? AND archived_at IS NULL"
      )
      .get(seed.id) as
      | { subject: string; predicate: string; object: string }
      | null;
    if (!row) {
      throw new Error(`reasoning: fact not found or archived (${seed.id})`);
    }
    return {
      queryText: `${row.subject} ${row.predicate} ${row.object}`,
      graphSeedFactId: seed.id,
    };
  }
  if (seed.kind === "question") {
    return { queryText: seed.id, graphSeedFactId: null };
  }
  if (seed.kind === "gap") {
    const row = db
      .query("SELECT question FROM open_problems WHERE problem_id = ?")
      .get(seed.id) as { question: string } | null;
    if (!row) {
      throw new Error(`reasoning: gap not found (${seed.id})`);
    }
    return { queryText: row.question, graphSeedFactId: null };
  }
  if (seed.kind === "curiosity_cluster") {
    // Cluster seed_id is the representative gap's problem_id (per
    // curiosity.ts cluster shape). Resolve to its question.
    const row = db
      .query("SELECT question FROM open_problems WHERE problem_id = ?")
      .get(seed.id) as { question: string } | null;
    if (!row) {
      throw new Error(`reasoning: cluster representative not found (${seed.id})`);
    }
    return { queryText: row.question, graphSeedFactId: null };
  }
  throw new Error(`reasoning: unknown seed kind (${seed.kind as string})`);
}

// ---------------------------------------------------------------------------
// Candidate gathering — query() + graph traversal in parallel
// ---------------------------------------------------------------------------

interface GatheredCandidates {
  fact_ids: string[];
  trace: RetrievalTrace;
  edge_refs: Array<{ from: string; to: string; kind: string }>;
  hits: QueryHit[]; // for LLM prompt context
}

async function gatherCandidates(
  db: Database,
  resolved: ResolvedSeed,
  opts: Required<
    Pick<ReasoningOptions, "topK" | "graphHops" | "retrievalBudget">
  >,
  vectorStore?: VectorStore
): Promise<GatheredCandidates> {
  // Retrieval lane: existing hybrid query() (FTS5 + ANN + Phase 2 RRF + rerank).
  const queryResult = await query(
    db,
    resolved.queryText,
    { budget: opts.retrievalBudget },
    vectorStore
  );
  const retrievalRanked = queryResult.hits.map((h) => ({
    id: h.fact_id,
    score: h.final_score,
  }));

  // Graph lane: BFS traversal from the seed fact (if any). When no seed
  // fact (question / gap / curiosity_cluster), the graph lane is empty —
  // by design (debate 025 §Q1 (c) graceful degradation: sparse graph →
  // RRF naturally falls back to retrieval-only).
  let graphRanked: Array<{ id: string; score?: number }> = [];
  let edgeRefs: Array<{ from: string; to: string; kind: string }> = [];
  if (resolved.graphSeedFactId !== null) {
    const traversal = traverse(db, resolved.graphSeedFactId, {
      maxDepth: opts.graphHops,
      kinds: [...REASONING_LINK_KINDS],
    });
    // Order traversal by depth (closer = higher rank). Skip seed itself
    // (depth 0). Cap at retrieval budget so RRF sees comparable list sizes.
    graphRanked = traversal
      .filter((t) => t.fact_id !== resolved.graphSeedFactId)
      .slice(0, opts.retrievalBudget)
      .map((t) => ({ id: t.fact_id, score: 1 / (t.depth + 1) }));

    // Collect edge_refs — directly outgoing/incoming links from seed at
    // depth 1, used by the LLM prompt for "explain why these are related".
    const links = db
      .query(
        "SELECT from_fact_id, to_fact_id, kind FROM fact_links WHERE (from_fact_id = ? OR to_fact_id = ?)"
      )
      .all(resolved.graphSeedFactId, resolved.graphSeedFactId) as Array<{
      from_fact_id: string;
      to_fact_id: string;
      kind: string;
    }>;
    edgeRefs = links.map((l) => ({
      from: l.from_fact_id,
      to: l.to_fact_id,
      kind: l.kind,
    }));
  }

  // RRF merge across the two source lists. When graph is empty, merged ==
  // retrieval (proves graceful degradation guarantee).
  const merged = rrfMerge([
    { source: "retrieval", ranked: retrievalRanked },
    { source: "graph", ranked: graphRanked },
  ]);

  // Drop the seed itself from the candidate set — it's the topic, not a
  // related fact. Otherwise FTS5 can return the seed (its own SPO) as a
  // top hit and inflate write-back self-loops + chain_id collisions.
  const topIds = merged
    .filter((m) => m.id !== resolved.graphSeedFactId)
    .slice(0, opts.topK)
    .map((m) => m.id);

  // Map fact_ids back to QueryHit (for LLM context). Some graph candidates
  // may not be in queryResult.hits — fetch their SPO from facts.
  const hitMap = new Map<string, QueryHit>();
  for (const h of queryResult.hits) hitMap.set(h.fact_id, h);
  const missing = topIds.filter((id) => !hitMap.has(id));
  if (missing.length > 0) {
    const placeholders = missing.map(() => "?").join(",");
    const rows = db
      .query(
        `SELECT f.fact_id, f.subject, f.predicate, f.object, f.confidence,
                o.source_uri, o.captured_at, o.adapter, o.transform_policy
         FROM facts f
         JOIN observations o ON o.observe_id = f.observe_id
         WHERE f.fact_id IN (${placeholders}) AND f.archived_at IS NULL`
      )
      .all(...missing) as Array<Record<string, unknown>>;
    for (const r of rows) {
      hitMap.set(r.fact_id as string, {
        fact: {
          subject: r.subject as string,
          predicate: r.predicate as string,
          object: r.object as string,
        },
        fact_id: r.fact_id as string,
        confidence: r.confidence as number,
        provenance: {
          source_uri: r.source_uri as string,
          captured_at: r.captured_at as string,
          adapter: r.adapter as string,
          transform_policy: r.transform_policy as string,
        },
        contexts: [],
        ranking_components: { graph_only: 1 },
        final_score: 0,
      });
    }
  }

  const hits = topIds.map((id) => hitMap.get(id)!).filter(Boolean);

  return {
    fact_ids: topIds,
    trace: {
      ann_count: retrievalRanked.length,
      fts_count: retrievalRanked.length, // Phase 2 query() already merged ANN+FTS; not separable here
      graph_count: graphRanked.length,
      graph_hops: opts.graphHops,
      rrf_top_k: opts.topK,
      retrieval_source_lists: ["retrieval", "graph"],
    },
    edge_refs: edgeRefs,
    hits,
  };
}

// ---------------------------------------------------------------------------
// LLM chain synthesis
// ---------------------------------------------------------------------------

const CHAIN_PROMPT = `Given a seed and a set of related facts retrieved from a personal knowledge base, write a concise reasoning chain (2-4 sentences) that connects them. Only use information from the facts provided. If the facts do not support a coherent chain, say so explicitly.

Output JSON only: {"chain": "...", "confidence": 0.0-1.0}

Seed: `;

function formatHitsForPrompt(hits: QueryHit[]): string {
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] (conf=${h.confidence.toFixed(2)}) ${h.fact.subject} ${h.fact.predicate} ${h.fact.object}`
    )
    .join("\n");
}

async function synthesizeChain(
  llmOrRegistry: LLMService | BreakerRegistry,
  seedQueryText: string,
  hits: QueryHit[]
): Promise<ChainAnswer> {
  const llm =
    llmOrRegistry instanceof BreakerRegistry
      ? llmOrRegistry.get("l5.reason")
      : llmOrRegistry;

  const prompt =
    CHAIN_PROMPT + seedQueryText + "\n\nFacts:\n" + formatHitsForPrompt(hits);

  try {
    const raw = await llm.generate(prompt, {
      maxTokens: 400,
      temperature: 0.3,
      timeoutMs: 30_000,
    });
    const text = raw.trim().replace(/```\w*\n?/g, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return {
        chain: null,
        confidence: 0,
        failure_reason: "llm output not JSON",
        llm_meta: { model: llm.model },
      };
    }
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      chain?: unknown;
      confidence?: unknown;
    };
    const chain =
      typeof parsed.chain === "string" && parsed.chain.trim()
        ? parsed.chain.trim()
        : null;
    const confRaw =
      typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const confidence = Math.max(0, Math.min(1, confRaw));
    return {
      chain,
      confidence,
      llm_meta: { model: llm.model },
      ...(chain ? {} : { failure_reason: "llm returned empty chain" }),
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    const msg = err instanceof Error ? err.message : String(err);
    return {
      chain: null,
      confidence: 0,
      failure_reason: `${name}: ${msg}`,
      llm_meta: { model: llm.model },
    };
  }
}

// ---------------------------------------------------------------------------
// Persistence — INSERT row, write-back derived_from links
// ---------------------------------------------------------------------------

interface PersistArgs {
  chainId: string;
  seedKind: SeedKind;
  seedId: string;
  policyVersion: string;
  candidateFactIds: string[];
  edgeRefs: Array<{ from: string; to: string; kind: string }>;
  trace: RetrievalTrace;
  answer: ChainAnswer;
}

function insertChain(db: Database, args: PersistArgs): string {
  db.run(
    `INSERT INTO reasoning_chains
       (chain_id, seed_kind, seed_id, policy_version,
        candidate_fact_ids_json, edge_refs_json,
        retrieval_trace_json, answer_json, confidence, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      args.chainId,
      args.seedKind,
      args.seedId,
      args.policyVersion,
      JSON.stringify(args.candidateFactIds),
      args.edgeRefs.length > 0 ? JSON.stringify(args.edgeRefs) : null,
      JSON.stringify(args.trace),
      JSON.stringify(args.answer),
      args.answer.confidence,
    ]
  );
  return args.chainId;
}

/**
 * Write-back: every successful chain creates `derived_from` edges from the
 * seed fact to each candidate. `addLink` reinforces if the edge exists, so
 * repeated reasoning over the same seed naturally bumps `observed_count`
 * on existing edges — the closed-loop graph densification mechanism.
 *
 * Skipped when the seed is not a fact (no graph anchor) or when caller
 * opts out via `noLinkWriteback`.
 */
export function persistDerivedLinks(
  db: Database,
  seedFactId: string,
  candidateFactIds: string[]
): number {
  let written = 0;
  for (const candId of candidateFactIds) {
    if (candId === seedFactId) continue; // no self-loops
    try {
      addLink(db, seedFactId, candId, "derived_from");
      written++;
    } catch {
      // Self-loop guard or weight-out-of-range — non-fatal; chain row
      // already persisted, link is a side-effect.
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main entry — runReasoning
// ---------------------------------------------------------------------------

export async function runReasoning(
  db: Database,
  seed: ReasoningSeed,
  llmOrRegistry: LLMService | BreakerRegistry,
  opts: ReasoningOptions = {},
  vectorStore?: VectorStore
): Promise<ReasoningChain> {
  const policyVersion = opts.policyVersion ?? POLICY_VERSION;
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const graphHops = opts.graphHops ?? DEFAULT_GRAPH_HOPS;
  const retrievalBudget = opts.retrievalBudget ?? RETRIEVAL_BUDGET;

  const resolved = resolveSeed(db, seed);
  const gathered = await gatherCandidates(
    db,
    resolved,
    { topK, graphHops, retrievalBudget },
    vectorStore
  );

  const chainId = computeChainId(
    seed.kind,
    seed.id,
    policyVersion,
    gathered.fact_ids
  );

  // Idempotency check (debate 024 lesson at L5 layer)
  const existing = readChain(db, chainId);
  if (existing && existing.status === "active") {
    return { ...existing, reused_existing: true };
  }

  const answer: ChainAnswer = opts.noLlm
    ? {
        chain: null,
        confidence: 0,
        failure_reason: "noLlm flag set",
        llm_meta: { model: "(skipped)" },
      }
    : gathered.hits.length === 0
      ? {
          chain: null,
          confidence: 0,
          failure_reason: "no candidates retrieved",
          llm_meta: { model: "(skipped)" },
        }
      : await synthesizeChain(llmOrRegistry, resolved.queryText, gathered.hits);

  insertChain(db, {
    chainId,
    seedKind: seed.kind,
    seedId: seed.id,
    policyVersion,
    candidateFactIds: gathered.fact_ids,
    edgeRefs: gathered.edge_refs,
    trace: gathered.trace,
    answer,
  });

  // Write-back derived_from edges (debate 025 closed-loop mechanism).
  // Only when seed is a fact (graph anchor exists) and chain succeeded
  // and caller did not opt out. Failed chains do NOT write edges —
  // an empty/failed reasoning attempt is not evidence of fact relatedness.
  if (
    !opts.noLinkWriteback &&
    answer.chain !== null &&
    resolved.graphSeedFactId !== null
  ) {
    persistDerivedLinks(db, resolved.graphSeedFactId, gathered.fact_ids);
  }

  return {
    chain_id: chainId,
    seed_kind: seed.kind,
    seed_id: seed.id,
    policy_version: policyVersion,
    candidate_fact_ids: gathered.fact_ids,
    edge_refs: gathered.edge_refs.length > 0 ? gathered.edge_refs : null,
    retrieval_trace: gathered.trace,
    answer,
    confidence: answer.confidence,
    status: "active",
    engram_insight_id: null,
    created_at: new Date().toISOString(),
    reused_existing: false,
  };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

function rowToChain(row: Record<string, unknown>): ReasoningChain {
  const edgeRefsJson = row.edge_refs_json as string | null;
  return {
    chain_id: row.chain_id as string,
    seed_kind: row.seed_kind as SeedKind,
    seed_id: row.seed_id as string,
    policy_version: row.policy_version as string,
    candidate_fact_ids: JSON.parse(row.candidate_fact_ids_json as string),
    edge_refs: edgeRefsJson ? JSON.parse(edgeRefsJson) : null,
    retrieval_trace: JSON.parse(row.retrieval_trace_json as string),
    answer: JSON.parse(row.answer_json as string),
    confidence: row.confidence as number,
    status: row.status as ChainStatus,
    engram_insight_id: (row.engram_insight_id as string | null) ?? null,
    created_at: row.created_at as string,
    reused_existing: false,
  };
}

export function readChain(db: Database, chainId: string): ReasoningChain | null {
  const row = db
    .query("SELECT * FROM reasoning_chains WHERE chain_id = ?")
    .get(chainId) as Record<string, unknown> | null;
  return row ? rowToChain(row) : null;
}

export function getChainsBySeed(
  db: Database,
  seedKind: SeedKind,
  seedId: string,
  status: ChainStatus | "any" = "active"
): ReasoningChain[] {
  const sql =
    status === "any"
      ? "SELECT * FROM reasoning_chains WHERE seed_kind = ? AND seed_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM reasoning_chains WHERE seed_kind = ? AND seed_id = ? AND status = ? ORDER BY created_at DESC";
  const params =
    status === "any" ? [seedKind, seedId] : [seedKind, seedId, status];
  const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToChain);
}

export function listRecentChains(
  db: Database,
  limit: number = 20
): ReasoningChain[] {
  const rows = db
    .query(
      `SELECT * FROM reasoning_chains
       WHERE status = 'active' AND archived_at IS NULL
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToChain);
}
