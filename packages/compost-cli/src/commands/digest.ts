import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  buildDigest,
  renderDigestMarkdown,
  digestInsightInput,
} from "../../../compost-core/src/cognitive/digest";
import { DEFAULT_PENDING_DB_PATH } from "../../../compost-engram-adapter/src/constants";
import { PendingWritesQueue } from "../../../compost-engram-adapter/src/pending-writes";
import {
  StdioEngramMcpClient,
  createStdioMcpClient,
} from "../../../compost-engram-adapter/src/mcp-stdio-client";
import { runDigestPushOnce } from "../../../compost-daemon/src/digest-push";

/** Split a space-separated CLI arg into individual args. No shell quoting. */
function splitArgs(raw: string): string[] {
  return raw.split(/\s+/).filter((p) => p.length > 0);
}

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

export function registerDigest(program: Command): void {
  program
    .command("digest")
    .description(
      "Compose a digest of noteworthy ledger state (Phase 6 P0 slice 2). Dry-run by default; --push writes kind=insight scope=meta to Engram"
    )
    .option(
      "--since-days <n>",
      "Window size in days",
      (v) => Number.parseInt(v, 10),
      7
    )
    .option(
      "--confidence-floor <f>",
      "Noteworthiness filter — digest uses confidence as 'what's worth surfacing', NOT the arbitration trust floor. Default exploration=0.75 matches typical personal-KB ingest; raise to instance=0.85 only for arbitration-grade gating",
      (v) => Number.parseFloat(v),
      0.75
    )
    .option(
      "--max-items <n>",
      "Per-group cap on items",
      (v) => Number.parseInt(v, 10),
      25
    )
    .option("--json", "Emit JSON report instead of markdown", false)
    .option(
      "--insight-input",
      "Emit the shape that --push would feed to EngramWriter.writeInsight (JSON)",
      false
    )
    .option(
      "--push",
      "Push digest to Engram as kind=insight scope=meta via S6-2 MCP write transport. Wiki-only digests are skipped (slice 3 will add wiki provenance)",
      false
    )
    .option(
      "--engram-server-cmd <cmd>",
      "Command spawning engram-server (MCP stdio transport) — used only with --push",
      "engram-server"
    )
    .option(
      "--engram-server-args <args>",
      'Space-separated args passed after --engram-server-cmd. Quote the whole string. Example: --engram-server-cmd uv --engram-server-args "--directory /path/to/engram run engram-server"'
    )
    .option(
      "--queue-path <path>",
      "Pending writes SQLite path (shared with engram-push) — used only with --push",
      DEFAULT_PENDING_DB_PATH
    )
    .action(async (opts) => {
      const db = openDb();
      try {
        const report = buildDigest(db, {
          sinceDays: opts.sinceDays,
          confidenceFloor: opts.confidenceFloor,
          maxItems: opts.maxItems,
        });

        if (opts.insightInput) {
          const payload = digestInsightInput(report);
          process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
          return;
        }

        if (opts.push) {
          // Round B: live MCP push. Open pending queue + spawn engram-server,
          // mirrors engram-push.ts shape so a failure here can be attributed
          // to the transport layer not the digest synthesizer.
          const queue = new PendingWritesQueue(opts.queuePath);
          try {
            const transport = await createStdioMcpClient({
              command: opts.engramServerCmd,
              ...(opts.engramServerArgs
                ? { args: splitArgs(opts.engramServerArgs) }
                : {}),
            });
            const mcpClient = new StdioEngramMcpClient({ client: transport });
            try {
              const outcome = await runDigestPushOnce({
                mcpClient,
                queue,
                report,
              });
              process.stdout.write(JSON.stringify(outcome, null, 2) + "\n");
              if (outcome.status === "pushed" && !outcome.result.ok) {
                process.exitCode = 1;
              }
            } finally {
              await mcpClient.close();
            }
          } finally {
            queue.close();
          }
          return;
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          return;
        }

        process.stdout.write(renderDigestMarkdown(report));
      } finally {
        db.close();
      }
    });
}
