import type { Database } from "bun:sqlite";
import { appendToOutbox } from "../../compost-core/src/ledger/outbox";
import type { OutboxEvent } from "../../compost-core/src/ledger/outbox";
import { query } from "../../compost-core/src/query/search";
import type { QueryOptions } from "../../compost-core/src/query/search";
import { ask } from "../../compost-core/src/query/ask";
import {
  listGaps,
  resolveGap,
  dismissGap,
  gapStats,
  type OpenProblemStatus,
} from "../../compost-core/src/cognitive/gap-tracker";
import { reflect } from "../../compost-core/src/cognitive/reflect";
import {
  detectCuriosityClusters,
  matchFactsToGaps,
  type CuriosityOptions,
  type FactGapMatchOptions,
} from "../../compost-core/src/cognitive/curiosity";
import {
  buildDigest,
  digestInsightInput,
} from "../../compost-core/src/cognitive/digest";
import {
  proposeCrawl,
  listCrawl,
  approveCrawl,
  rejectCrawl,
  crawlStats,
  type CrawlStatus,
} from "../../compost-core/src/cognitive/crawl-queue";

import { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";
import pino from "pino";

const log = pino({ name: "compost-mcp" });

// Lazy import: the MCP SDK may not be installed in Phase 0 test environments.
// We import dynamically so missing-package errors surface at server start,
// not at module load time during tests that don't exercise the MCP path.
type McpServerType = import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
type StdioServerTransportType =
  import("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport;

export interface McpHandle {
  server: McpServerType;
  transport: StdioServerTransportType;
  /** Resolves when the transport is connected and ready. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

/**
 * Build and connect the MCP server. Tool surface:
 *   Phase 0-2: compost.observe / .query / .reflect / .ask
 *   Phase 6 P0 (agent-reachable):
 *     compost.gaps.list / .resolve / .dismiss / .stats
 *     compost.curiosity
 *     compost.curiosity.match_facts (active L4 fact→gap suggestion)
 *     compost.digest (dry-run only; push stays CLI-gated)
 *     compost.crawl.propose / .list / .approve / .reject / .stats
 *   Intentionally NOT exposed via MCP:
 *     - gap.forget / crawl.forget (hard-delete; CLI-only for safety)
 *     - digest --push (sibling-system mutation; requires human CLI gate)
 *     - crawl fetch (does not yet exist anywhere; see crawl-queue.ts docblock)
 *
 * `llmRegistry` is injected by the caller (daemon boot, `main.ts`) so MCP
 * and the reflect scheduler share the exact same BreakerRegistry instance
 * -- circuit state for `ask.*` and `wiki.synthesis` lives in one place
 * (debate 011 Day 1 contract; eliminates the prior two-registry topology).
 */
export async function startMcpServer(
  db: Database,
  llmRegistry: BreakerRegistry
): Promise<McpHandle> {
  // Dynamic import so missing SDK doesn't crash unrelated tests
  const { McpServer } = await import(
    "@modelcontextprotocol/sdk/server/mcp.js"
  );
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { z } = await import("zod");

  const server = new McpServer(
    { name: "compost", version: "0.1.0" },
    { capabilities: {} }
  );

  // -----------------------------------------------------------------------
  // compost.observe — write an observation to the outbox
  // Modelled as a tool (MCP doesn't have client->server notifications).
  // -----------------------------------------------------------------------
  server.registerTool(
    "compost.observe",
    {
      description: "Append an observation event to the Compost outbox",
      inputSchema: z.object({
        adapter: z.string(),
        source_id: z.string(),
        source_kind: z.enum([
          "local-file",
          "local-dir",
          "web",
          "claude-code",
          "host-adapter",
          "sensory",
        ]),
        source_uri: z.string(),
        idempotency_key: z.string(),
        trust_tier: z.enum(["user", "first_party", "web"]),
        transform_policy: z.string(),
        payload: z.string(), // JSON string
        contexts: z.array(z.string()).optional(),
      }),
    },
    async (input) => {
      try {
        const event: OutboxEvent = {
          adapter: input.adapter,
          source_id: input.source_id,
          source_kind: input.source_kind,
          source_uri: input.source_uri,
          idempotency_key: input.idempotency_key,
          trust_tier: input.trust_tier,
          transform_policy: input.transform_policy,
          payload: input.payload,
          contexts: input.contexts,
        };
        appendToOutbox(db, event);
        log.debug({ idempotency_key: input.idempotency_key }, "observe appended");
        return {
          content: [{ type: "text" as const, text: "ok" }],
        };
      } catch (err) {
        log.error({ err }, "compost.observe error");
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // compost.query — semantic search (Phase 0 returns empty hits)
  // -----------------------------------------------------------------------
  server.registerTool(
    "compost.query",
    {
      description: "Query the Compost knowledge base",
      inputSchema: z.object({
        q: z.string(),
        budget: z.number().optional(),
        ranking_profile_id: z.string().optional(),
        contexts: z.array(z.string()).optional(),
        as_of_unix_sec: z.number().optional(),
        debug_ranking: z.boolean().optional(),
      }),
    },
    async (input) => {
      try {
        const opts: QueryOptions = {
          budget: input.budget,
          ranking_profile_id: input.ranking_profile_id,
          contexts: input.contexts,
          as_of_unix_sec: input.as_of_unix_sec,
          debug_ranking: input.debug_ranking,
        };
        const result = await query(db, input.q, opts);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        log.error({ err }, "compost.query error");
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // compost.reflect — active forgetting / consolidation
  // -----------------------------------------------------------------------
  server.registerTool(
    "compost.reflect",
    {
      description: "Run the Compost reflect pass (GC + tombstone + outbox prune)",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const report = reflect(db);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(report) }],
        };
      } catch (err) {
        log.error({ err }, "compost.reflect error");
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -----------------------------------------------------------------------
  // compost.ask — LLM-synthesized answer (Phase 2)
  // -----------------------------------------------------------------------
  server.registerTool(
    "compost.ask",
    {
      description: "Ask a question — synthesizes an answer from facts and wiki pages via LLM",
      inputSchema: z.object({
        question: z.string(),
        budget: z.number().optional(),
        ranking_profile_id: z.string().optional(),
        contexts: z.array(z.string()).optional(),
        as_of_unix_sec: z.number().optional(),
      }),
    },
    async (input) => {
      try {
        // Gap logging lives in ask() itself (debate 023) — this handler
        // is pure transport. `ask()` uses DEFAULT_GAP_THRESHOLD = 0.4
        // (re-export in query/ask.ts) and provenance-gates out the
        // BM25 fallback path.
        const result = await ask(db, input.question, llmRegistry, {
          budget: input.budget,
          ranking_profile_id: input.ranking_profile_id,
          contexts: input.contexts,
          as_of_unix_sec: input.as_of_unix_sec,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        log.error({ err }, "compost.ask error");
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // =======================================================================
  // Phase 6 P0 tool surface — agent-reachable gaps/curiosity/digest/crawl.
  // Deliberately conservative: push paths (digest --push, crawl fetch) and
  // hard-delete verbs (gap forget, crawl forget) stay CLI-only so
  // sibling-system mutations and destructive ops require a human gate.
  // =======================================================================

  // ----- compost.gaps.list -------------------------------------------------
  server.registerTool(
    "compost.gaps.list",
    {
      description:
        "List open questions Compost could not answer confidently. Use when the user wonders what gaps have accumulated or you suspect a recurring question is already tracked.",
      inputSchema: z.object({
        status: z.enum(["open", "resolved", "dismissed"]).optional(),
        since: z
          .string()
          .optional()
          .describe("SQLite datetime lower bound (YYYY-MM-DD HH:MM:SS)"),
        limit: z.number().int().positive().max(500).optional(),
      }),
    },
    async (input) => {
      try {
        const opts: {
          status?: OpenProblemStatus;
          since?: string;
          limit?: number;
        } = {};
        if (input.status) opts.status = input.status;
        if (input.since) opts.since = input.since;
        if (input.limit !== undefined) opts.limit = input.limit;
        const rows = listGaps(db, opts);
        return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
      } catch (err) {
        log.error({ err }, "compost.gaps.list error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.gaps.resolve ---------------------------------------------
  server.registerTool(
    "compost.gaps.resolve",
    {
      description:
        "Mark a gap as resolved when Compost (or the agent) has found an answer. Optional observationId/factId link the resolving evidence. Only transitions from status=open.",
      inputSchema: z.object({
        problem_id: z.string(),
        observation_id: z.string().optional(),
        fact_id: z.string().optional(),
      }),
    },
    async (input) => {
      try {
        const resolveOpts: { observationId?: string; factId?: string } = {};
        if (input.observation_id) resolveOpts.observationId = input.observation_id;
        if (input.fact_id) resolveOpts.factId = input.fact_id;
        const ok = resolveGap(db, input.problem_id, resolveOpts);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ resolved: ok, problem_id: input.problem_id }) },
          ],
        };
      } catch (err) {
        log.error({ err }, "compost.gaps.resolve error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.gaps.dismiss ---------------------------------------------
  server.registerTool(
    "compost.gaps.dismiss",
    {
      description:
        "Mark a gap as dismissed (user no longer cares). Keeps ask history but hides from default list. Only transitions from status=open. For hard deletion use the CLI `compost gaps forget`.",
      inputSchema: z.object({ problem_id: z.string() }),
    },
    async (input) => {
      try {
        const ok = dismissGap(db, input.problem_id);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ dismissed: ok, problem_id: input.problem_id }) },
          ],
        };
      } catch (err) {
        log.error({ err }, "compost.gaps.dismiss error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.gaps.stats -----------------------------------------------
  server.registerTool(
    "compost.gaps.stats",
    {
      description: "Summary counts across gap statuses: open / resolved / dismissed / total_asks.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(gapStats(db)) }] };
      } catch (err) {
        log.error({ err }, "compost.gaps.stats error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.curiosity ------------------------------------------------
  server.registerTool(
    "compost.curiosity",
    {
      description:
        "Cluster open gaps by token-Jaccard overlap to surface 'what the user keeps circling around'. Deterministic, no LLM. Use when you suspect the user has a recurring theme in unanswered questions.",
      inputSchema: z.object({
        status: z.enum(["open", "resolved", "dismissed"]).optional(),
        window_days: z.number().int().positive().max(365).optional(),
        min_jaccard: z.number().min(0).max(1).optional(),
        max_clusters: z.number().int().positive().max(50).optional(),
      }),
    },
    async (input) => {
      try {
        const opts: CuriosityOptions = {};
        if (input.status) opts.status = input.status;
        if (input.window_days !== undefined) opts.windowDays = input.window_days;
        if (input.min_jaccard !== undefined) opts.minJaccard = input.min_jaccard;
        if (input.max_clusters !== undefined) opts.maxClusters = input.max_clusters;
        const report = detectCuriosityClusters(db, opts);
        return { content: [{ type: "text" as const, text: JSON.stringify(report) }] };
      } catch (err) {
        log.error({ err }, "compost.curiosity error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.curiosity.match_facts ------------------------------------
  server.registerTool(
    "compost.curiosity.match_facts",
    {
      description:
        "Active L4: scan recent confident facts for candidates that might answer open gaps. Returns per-gap candidate_facts[] ordered by token overlap. Use when a new fact lands and you want to suggest 'this may resolve gap X', or proactively when reviewing open gaps.",
      inputSchema: z.object({
        since_days: z.number().int().positive().max(90).optional(),
        min_overlap: z.number().int().positive().max(20).optional(),
        confidence_floor: z.number().min(0).max(1).optional(),
        max_candidates_per_gap: z.number().int().positive().max(20).optional(),
        max_gaps: z.number().int().positive().max(100).optional(),
        only_with_candidates: z.boolean().optional(),
      }),
    },
    async (input) => {
      try {
        const opts: FactGapMatchOptions = {};
        if (input.since_days !== undefined) opts.sinceDays = input.since_days;
        if (input.min_overlap !== undefined) opts.minOverlap = input.min_overlap;
        if (input.confidence_floor !== undefined)
          opts.confidenceFloor = input.confidence_floor;
        if (input.max_candidates_per_gap !== undefined)
          opts.maxCandidatesPerGap = input.max_candidates_per_gap;
        if (input.max_gaps !== undefined) opts.maxGaps = input.max_gaps;
        let matches = matchFactsToGaps(db, opts);
        if (input.only_with_candidates) {
          matches = matches.filter((m) => m.candidate_facts.length > 0);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(matches) }],
        };
      } catch (err) {
        log.error({ err }, "compost.curiosity.match_facts error");
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.digest ---------------------------------------------------
  // Dry-run only via MCP. Push to Engram is CLI-gated (`compost digest
  // --push`) — sibling-system mutations require explicit human action, not
  // agent-initiated during a conversation. include_insight_input=true
  // previews the payload Round B would send.
  server.registerTool(
    "compost.digest",
    {
      description:
        "Compose a digest of noteworthy ledger state in the last N days (new confident facts, resolved gaps, wiki rebuilds). Dry-run only via MCP — push to Engram stays CLI-gated. Set include_insight_input to preview the payload that `compost digest --push` would send.",
      inputSchema: z.object({
        since_days: z.number().int().positive().max(365).optional(),
        confidence_floor: z.number().min(0).max(1).optional(),
        max_items: z.number().int().positive().max(100).optional(),
        include_insight_input: z.boolean().optional(),
      }),
    },
    async (input) => {
      try {
        const buildOpts: {
          sinceDays?: number;
          confidenceFloor?: number;
          maxItems?: number;
        } = {};
        if (input.since_days !== undefined) buildOpts.sinceDays = input.since_days;
        if (input.confidence_floor !== undefined) buildOpts.confidenceFloor = input.confidence_floor;
        if (input.max_items !== undefined) buildOpts.maxItems = input.max_items;
        const report = buildDigest(db, buildOpts);
        const payload: {
          report: typeof report;
          insight_input?: ReturnType<typeof digestInsightInput>;
        } = { report };
        if (input.include_insight_input) {
          payload.insight_input = digestInsightInput(report);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
      } catch (err) {
        log.error({ err }, "compost.digest error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.crawl.propose --------------------------------------------
  server.registerTool(
    "compost.crawl.propose",
    {
      description:
        "Propose a URL for ingest (status='proposed', pending user approval). NO fetch happens — crawl queue has no HTTP code path (first-party principle). Use proposed_by='curiosity'/'digest'/etc to attribute the suggestion source.",
      inputSchema: z.object({
        url: z.string(),
        rationale: z.string().optional(),
        tags: z.array(z.string()).optional(),
        proposed_by: z.string().optional(),
      }),
    },
    async (input) => {
      try {
        const opts: {
          rationale?: string;
          tags?: string[];
          proposedBy?: string;
        } = {};
        if (input.rationale) opts.rationale = input.rationale;
        if (input.tags && input.tags.length > 0) opts.tags = input.tags;
        if (input.proposed_by) opts.proposedBy = input.proposed_by;
        const item = proposeCrawl(db, input.url, opts);
        return { content: [{ type: "text" as const, text: JSON.stringify(item) }] };
      } catch (err) {
        log.error({ err }, "compost.crawl.propose error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.crawl.list -----------------------------------------------
  server.registerTool(
    "compost.crawl.list",
    {
      description:
        "List crawl queue items. Default view shows proposed + approved (hides rejected). Use status filter or proposed_by filter to narrow.",
      inputSchema: z.object({
        status: z.enum(["proposed", "approved", "rejected"]).optional(),
        proposed_by: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      }),
    },
    async (input) => {
      try {
        const opts: { status?: CrawlStatus; proposedBy?: string; limit?: number } = {};
        if (input.status) opts.status = input.status;
        if (input.proposed_by) opts.proposedBy = input.proposed_by;
        if (input.limit !== undefined) opts.limit = input.limit;
        const rows = listCrawl(db, opts);
        return { content: [{ type: "text" as const, text: JSON.stringify(rows) }] };
      } catch (err) {
        log.error({ err }, "compost.crawl.list error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.crawl.approve --------------------------------------------
  server.registerTool(
    "compost.crawl.approve",
    {
      description:
        "Approve a proposed URL. Persistent consent record — fetch still requires explicit `compost crawl fetch` CLI run (when that verb ships).",
      inputSchema: z.object({ crawl_id: z.string() }),
    },
    async (input) => {
      try {
        const ok = approveCrawl(db, input.crawl_id);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ approved: ok, crawl_id: input.crawl_id }) },
          ],
        };
      } catch (err) {
        log.error({ err }, "compost.crawl.approve error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.crawl.reject ---------------------------------------------
  server.registerTool(
    "compost.crawl.reject",
    {
      description:
        "Reject a proposed URL. Terminal — re-proposing does NOT resurrect; user must run `compost crawl forget` first (CLI-only). Prevents automated proposers from spamming vetoed URLs.",
      inputSchema: z.object({ crawl_id: z.string() }),
    },
    async (input) => {
      try {
        const ok = rejectCrawl(db, input.crawl_id);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ rejected: ok, crawl_id: input.crawl_id }) },
          ],
        };
      } catch (err) {
        log.error({ err }, "compost.crawl.reject error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  // ----- compost.crawl.stats ----------------------------------------------
  server.registerTool(
    "compost.crawl.stats",
    {
      description: "Summary counts of crawl queue items by status: proposed / approved / rejected / total.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return { content: [{ type: "text" as const, text: JSON.stringify(crawlStats(db)) }] };
      } catch (err) {
        log.error({ err }, "compost.crawl.stats error");
        return {
          content: [
            { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
          ],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  const ready = server.connect(transport);

  return {
    server,
    transport,
    ready,
    async stop() {
      await server.close();
    },
  };
}
