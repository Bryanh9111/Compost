import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { BreakerRegistry } from "../../../compost-core/src/llm/breaker-registry";
import { OllamaLLMService } from "../../../compost-core/src/llm/ollama";
import { startMcpServer } from "../../../compost-daemon/src/mcp-server";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

/**
 * `compost mcp` — standalone MCP stdio server for Claude Code / any MCP
 * client to spawn. Deliberately does NOT start reflect/drain/ingest/
 * engram schedulers — those live on the `compost daemon` process.
 * Multiple `compost mcp` subprocesses share the same ledger.db via
 * SQLite WAL; per-process BreakerRegistry is fine (L5 circuit state
 * does not need to be shared across MCP clients, and collisions are
 * rare on a single-user system).
 *
 * Intended use: add an entry to `~/.claude/.mcp.json`:
 *   "compost": {
 *     "command": "bun",
 *     "args": ["run", "/path/to/Compost/packages/compost-cli/src/main.ts", "mcp"]
 *   }
 * so every Claude Code session can reach compost.* tools (debate 023
 * shipped the 16-tool surface + L4 signal sinking; this closes the
 * configuration-layer gap that kept total_asks=0 on the live ledger).
 */
export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description(
      "Start a stdio MCP server for Claude Code / MCP clients to spawn. Shares ledger.db with the daemon; does not start background schedulers."
    )
    .action(async () => {
      const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

      const db = new Database(join(dataDir, "ledger.db"), { create: true });
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      applyMigrations(db);

      const llmRegistry = new BreakerRegistry(new OllamaLLMService());

      const mcpHandle = await startMcpServer(db, llmRegistry);

      // Graceful shutdown. MCP clients close stdin when they disconnect;
      // SIGINT/SIGTERM catches terminal kills. Either path stops the
      // transport cleanly before closing the DB handle.
      const shutdown = async (signal: string): Promise<void> => {
        process.stderr.write(`compost mcp: shutting down (${signal})\n`);
        try {
          await mcpHandle.stop();
        } catch (err) {
          process.stderr.write(
            `compost mcp: transport stop failed: ${err instanceof Error ? err.message : String(err)}\n`
          );
        }
        try {
          db.close();
        } catch {
          // already closed
        }
        process.exit(0);
      };

      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.stdin.on("close", () => void shutdown("stdin-close"));

      // Intentionally do not log to stdout — MCP stdio transport owns it.
      process.stderr.write(
        `compost mcp: ready (ledger: ${join(dataDir, "ledger.db")})\n`
      );
    });
}
