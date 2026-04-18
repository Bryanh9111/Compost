import { describe, test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";
import { OllamaLLMService } from "../../compost-core/src/llm/ollama";
import { startMcpServer } from "../src/mcp-server";
import type { McpHandle } from "../src/mcp-server";

/**
 * Regression guard for the zod-missing latent bug (2026-04-18 fix,
 * commit de4905f). Before the fix, mcp-server.ts's dynamic
 * `await import("zod")` silently failed at boot and the daemon logged
 * "MCP server failed to start (SDK may not be installed)" — nobody
 * noticed because daemon.test.ts passes withMcp=false, so the MCP
 * import path had zero test coverage.
 *
 * This test exercises `startMcpServer` directly so any future dep-drop
 * (zod moved out of compost-daemon/package.json, SDK renamed, etc)
 * surfaces as a red test instead of a silent prod degrade.
 */
describe("startMcpServer — dependency-resolution regression guard", () => {
  let handle: McpHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
  });

  test("resolves zod + @modelcontextprotocol/sdk at runtime and registers the full tool surface", async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    const migResult = applyMigrations(db);
    expect(migResult.errors).toHaveLength(0);
    upsertPolicies(db);

    handle = await startMcpServer(
      db,
      new BreakerRegistry(new OllamaLLMService())
    );

    expect(handle.server).toBeDefined();
    expect(handle.transport).toBeDefined();

    // Peek at the MCP SDK's internal tool registry to assert the full
    // Phase 6 P0 surface is wired. Shape: server._registeredTools is a
    // Record<name, ToolHandler>. This is SDK-internal but stable enough
    // for a regression guard — if the shape changes, this test goes red
    // which is the right signal (someone upgraded the SDK).
    const registered = (handle.server as unknown as {
      _registeredTools?: Record<string, unknown>;
    })._registeredTools;
    expect(registered).toBeDefined();
    const toolNames = Object.keys(registered!).sort();

    // Pre-existing surface.
    expect(toolNames).toContain("compost.observe");
    expect(toolNames).toContain("compost.query");
    expect(toolNames).toContain("compost.reflect");
    expect(toolNames).toContain("compost.ask");

    // Phase 6 P0 surface (2026-04-18).
    expect(toolNames).toContain("compost.gaps.list");
    expect(toolNames).toContain("compost.gaps.resolve");
    expect(toolNames).toContain("compost.gaps.dismiss");
    expect(toolNames).toContain("compost.gaps.stats");
    expect(toolNames).toContain("compost.curiosity");
    expect(toolNames).toContain("compost.digest");
    expect(toolNames).toContain("compost.crawl.propose");
    expect(toolNames).toContain("compost.crawl.list");
    expect(toolNames).toContain("compost.crawl.approve");
    expect(toolNames).toContain("compost.crawl.reject");
    expect(toolNames).toContain("compost.crawl.stats");

    db.close();
  });
});
