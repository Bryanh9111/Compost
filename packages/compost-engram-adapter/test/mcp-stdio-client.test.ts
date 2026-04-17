import { describe, test, expect } from "bun:test";
import {
  type McpToolCallResponse,
  type McpToolClient,
  StdioEngramMcpClient,
} from "../src/mcp-stdio-client";
import type { RememberArgs } from "../src/writer";

class FakeMcpClient implements McpToolClient {
  calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  nextResponse: McpToolCallResponse | null = null;
  throwOnCall = false;
  closeCalled = false;

  async callTool(args: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<McpToolCallResponse> {
    this.calls.push(args);
    if (this.throwOnCall) throw new Error("transport dead");
    return this.nextResponse ?? { content: [] };
  }

  async close() {
    this.closeCalled = true;
  }
}

function rememberArgs(): RememberArgs {
  return {
    origin: "compost",
    kind: "insight",
    content: "some synthesized insight",
    project: "compost",
    scope: "project",
    source_trace: {
      compost_fact_ids: ["f1"],
      root_insight_id: "00000000-0000-5000-8000-000000000000",
      chunk_index: 0,
      total_chunks: 1,
      split_strategy: "none",
      synthesized_at: "2026-04-17T00:00:00Z",
    },
    expires_at: "2026-07-16T00:00:00Z",
  };
}

describe("StdioEngramMcpClient.remember", () => {
  test("success with structuredContent returns id", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      structuredContent: { id: "mem-42" },
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(true);
    expect(r.data?.id).toBe("mem-42");
    expect(client.calls[0]?.name).toBe("remember");
  });

  test("success with text content JSON body", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      content: [{ type: "text", text: JSON.stringify({ id: "mem-7" }) }],
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(true);
    expect(r.data?.id).toBe("mem-7");
  });

  test("memory_id fallback field name accepted", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = { structuredContent: { memory_id: "mem-alt" } };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(true);
    expect(r.data?.id).toBe("mem-alt");
  });

  test("missing id field → error", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = { structuredContent: { content: "stored" } };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("missing id");
  });

  test("tool isError flag surfaces as MCPCallResult error", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      isError: true,
      content: [{ type: "text", text: "source_trace required" }],
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("source_trace");
  });

  test("non-JSON text response flagged with preview", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      content: [{ type: "text", text: "OK stored 42" }],
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("non-JSON");
  });

  test("transport exception flattened, no throw", async () => {
    const client = new FakeMcpClient();
    client.throwOnCall = true;
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("transport dead");
  });

  test("empty content returns empty-content error", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = { content: [] };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.remember(rememberArgs());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("empty content");
  });
});

describe("StdioEngramMcpClient.invalidate", () => {
  test("success returns invalidated_memory_ids and count", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      structuredContent: {
        invalidated_memory_ids: ["m1", "m2"],
        count: 2,
      },
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.invalidate({ fact_ids: ["f1", "f2"] });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({
      invalidated_memory_ids: ["m1", "m2"],
      count: 2,
    });
    expect(client.calls[0]?.name).toBe("invalidate_compost_fact");
    expect(client.calls[0]?.arguments).toEqual({ fact_ids: ["f1", "f2"] });
  });

  test("malformed shape (count missing) → error", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      structuredContent: { invalidated_memory_ids: [] },
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.invalidate({ fact_ids: ["f1"] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("invalidate response shape invalid");
  });

  test("filters non-string memory_ids from response array", async () => {
    const client = new FakeMcpClient();
    client.nextResponse = {
      structuredContent: {
        invalidated_memory_ids: ["m1", 42, null, "m2"],
        count: 2,
      },
    };
    const c = new StdioEngramMcpClient({ client });
    const r = await c.invalidate({ fact_ids: ["f1"] });
    expect(r.ok).toBe(true);
    expect(r.data?.invalidated_memory_ids).toEqual(["m1", "m2"]);
  });
});

describe("StdioEngramMcpClient.close", () => {
  test("delegates to underlying client", async () => {
    const client = new FakeMcpClient();
    const c = new StdioEngramMcpClient({ client });
    await c.close();
    expect(client.closeCalled).toBe(true);
  });
});
