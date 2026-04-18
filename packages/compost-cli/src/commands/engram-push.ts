import { Command } from "@commander-js/extra-typings";
import { DEFAULT_PENDING_DB_PATH } from "../../../compost-engram-adapter/src/constants";
import { PendingWritesQueue } from "../../../compost-engram-adapter/src/pending-writes";
import {
  StdioEngramMcpClient,
  createStdioMcpClient,
} from "../../../compost-engram-adapter/src/mcp-stdio-client";
import { runEngramFlushOnce } from "../../../compost-daemon/src/engram-flusher";

/** Split a space-separated CLI arg into individual args. No shell quoting. */
function splitArgs(raw: string): string[] {
  return raw.split(/\s+/).filter((p) => p.length > 0);
}

export function registerEngramPush(program: Command): void {
  program
    .command("engram-push")
    .description(
      "Flush Compost's pending-engram-writes queue to Engram via MCP (Phase 5 S6 slice 2)"
    )
    .option(
      "--queue-path <path>",
      "Pending writes SQLite path",
      DEFAULT_PENDING_DB_PATH
    )
    .option(
      "--engram-server-cmd <cmd>",
      "Command spawning engram-server (MCP stdio transport)",
      "engram-server"
    )
    .option(
      "--engram-server-args <args>",
      'Space-separated args passed after --engram-server-cmd. Quote the whole string. Example: --engram-server-cmd uv --engram-server-args "--directory /path/to/engram run engram-server"'
    )
    .option("--dry-run", "Show pending queue contents without flushing", false)
    .action(async (opts) => {
      const queue = new PendingWritesQueue(opts.queuePath);
      try {
        if (opts.dryRun) {
          const pending = queue.listPending();
          const summary = {
            mode: "dry-run",
            pending_count: pending.length,
            by_kind: pending.reduce<Record<string, number>>((acc, p) => {
              acc[p.kind] = (acc[p.kind] ?? 0) + 1;
              return acc;
            }, {}),
            oldest_enqueued_at:
              pending.length > 0
                ? new Date(
                    Math.min(...pending.map((p) => p.enqueued_at))
                  ).toISOString()
                : null,
          };
          process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
          return;
        }

        const transport = await createStdioMcpClient({
          command: opts.engramServerCmd,
          ...(opts.engramServerArgs
            ? { args: splitArgs(opts.engramServerArgs) }
            : {}),
        });
        const mcpClient = new StdioEngramMcpClient({ client: transport });
        try {
          const stats = await runEngramFlushOnce({ mcpClient, queue });
          process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
          if (stats.failed > 0) process.exitCode = 1;
        } finally {
          await mcpClient.close();
        }
      } finally {
        queue.close();
      }
    });
}
