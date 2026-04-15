import type { Database } from "bun:sqlite";
import { appendToOutbox } from "../../compost-core/src/ledger/outbox";
import type { OutboxEvent } from "../../compost-core/src/ledger/outbox";
import { query } from "../../compost-core/src/query/search";
import type { QueryOptions } from "../../compost-core/src/query/search";
import { ask } from "../../compost-core/src/query/ask";
import { reflect } from "../../compost-core/src/cognitive/reflect";
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
 * Build and connect the MCP server. Phase 0 tools:
 *   compost.observe   - notification-style, writes to outbox
 *   compost.query     - tool, proxies to query()
 *   compost.reflect   - tool, proxies to reflect()
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
