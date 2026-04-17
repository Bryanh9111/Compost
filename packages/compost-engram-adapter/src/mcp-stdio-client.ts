import type {
  EngramMcpClient,
  MCPCallResult,
  RememberArgs,
} from "./writer";

/**
 * Minimal surface of an MCP tool client that StdioEngramMcpClient depends
 * on. Matches @modelcontextprotocol/sdk `Client.callTool` / `.close`
 * shape exactly — the default factory below adapts the SDK into this
 * interface, and tests can substitute a fake without spawning a process.
 */
export interface McpToolClient {
  callTool(args: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<McpToolCallResponse>;
  close(): Promise<void>;
}

export interface McpToolCallResponse {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface StdioEngramMcpClientOptions {
  /**
   * The MCP tool client (usually wrapping @modelcontextprotocol/sdk's
   * `Client` + `StdioClientTransport`). Injectable so unit tests don't
   * spawn `engram-server`. Use `createStdioMcpClient` below for production.
   */
  client: McpToolClient;
}

/**
 * StdioEngramMcpClient adapts MCP `tools/call` invocations into the
 * `EngramMcpClient` surface the adapter writer expects.
 *
 * Engram's MCP `remember` tool returns the memory as JSON — we parse the
 * first text content block and surface `id` (or `memory_id` fallback)
 * back to the caller. Any transport / parse / tool-side error is
 * flattened into `MCPCallResult.error` rather than thrown, so the writer
 * can fall back to the pending queue without exception handling.
 */
export class StdioEngramMcpClient implements EngramMcpClient {
  private readonly client: McpToolClient;

  constructor(opts: StdioEngramMcpClientOptions) {
    this.client = opts.client;
  }

  async remember(
    args: RememberArgs
  ): Promise<MCPCallResult<{ id: string }>> {
    const result = await this.callTool("remember", args);
    if (!result.ok || !result.data) {
      return { ok: false, error: result.error ?? "remember failed" };
    }
    const data = result.data;
    const id =
      typeof data["id"] === "string"
        ? (data["id"] as string)
        : typeof data["memory_id"] === "string"
          ? (data["memory_id"] as string)
          : null;
    if (!id) {
      return {
        ok: false,
        error: `remember response missing id field: ${JSON.stringify(data).slice(0, 200)}`,
      };
    }
    return { ok: true, data: { id } };
  }

  async invalidate(args: {
    fact_ids: string[];
  }): Promise<
    MCPCallResult<{ invalidated_memory_ids: string[]; count: number }>
  > {
    const result = await this.callTool("invalidate_compost_fact", args);
    if (!result.ok || !result.data) {
      return { ok: false, error: result.error ?? "invalidate failed" };
    }
    const data = result.data;
    const idsRaw = data["invalidated_memory_ids"];
    const countRaw = data["count"];
    if (!Array.isArray(idsRaw) || typeof countRaw !== "number") {
      return {
        ok: false,
        error: `invalidate response shape invalid: ${JSON.stringify(data).slice(0, 200)}`,
      };
    }
    return {
      ok: true,
      data: {
        invalidated_memory_ids: idsRaw.filter(
          (x): x is string => typeof x === "string"
        ),
        count: countRaw,
      },
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async callTool(
    name: string,
    args: unknown
  ): Promise<MCPCallResult<Record<string, unknown>>> {
    try {
      const response = await this.client.callTool({
        name,
        arguments: args as Record<string, unknown>,
      });
      if (response.isError) {
        return {
          ok: false,
          error: extractTextContent(response) ?? `${name} tool returned isError`,
        };
      }
      // Prefer structuredContent if present (MCP 1.x), else parse text.
      if (
        response.structuredContent &&
        typeof response.structuredContent === "object"
      ) {
        return { ok: true, data: response.structuredContent };
      }
      const text = extractTextContent(response);
      if (!text) {
        return { ok: false, error: `${name} returned empty content` };
      }
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        return { ok: true, data: parsed };
      } catch (e) {
        return {
          ok: false,
          error: `${name} non-JSON response: ${text.slice(0, 200)}`,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: `${name} transport error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

function extractTextContent(response: McpToolCallResponse): string | null {
  const first = response.content?.[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    return null;
  }
  return first.text;
}

/**
 * Default factory: spawns `engram-server` as a subprocess and wraps the
 * @modelcontextprotocol/sdk `Client` in our `McpToolClient` shape.
 *
 * Kept as an async factory (not a constructor) because `client.connect`
 * must complete before the first call. Callers typically construct one
 * StdioEngramMcpClient at daemon startup and share it.
 *
 * Tests should NOT use this — inject a fake McpToolClient instead.
 */
export async function createStdioMcpClient(opts: {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  clientInfo?: { name: string; version: string };
}): Promise<McpToolClient> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );

  const transport = new StdioClientTransport({
    command: opts.command ?? "engram-server",
    args: opts.args ?? [],
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });
  const client = new Client(
    opts.clientInfo ?? { name: "compost-engram-adapter", version: "0.1.0" }
  );
  await client.connect(transport);

  return {
    async callTool(callArgs) {
      const result = (await client.callTool(callArgs)) as McpToolCallResponse;
      return result;
    },
    async close() {
      await client.close();
    },
  };
}
