import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  formatActionReconcile,
  reconcileActionPointers,
} from "../../../compost-core/src/metacognitive/action-reconciler";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function openDb(): Database {
  const dataDir = process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const db = new Database(join(dataDir, "ledger.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`expected a positive integer, got ${value}`);
  }
  return parsed;
}

function parseDateOption(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`expected an ISO timestamp, got ${value}`);
  }
  return parsed;
}

export function registerReconcile(program: Command): void {
  program
    .command("reconcile")
    .description(
      "Report action_log entries missing Engram, Obsidian, git, or durable artifact pointers"
    )
    .argument(
      "<when>",
      "Date expression: today, yesterday, this week, last week, this month, last month, last N days, or YYYY-MM-DD"
    )
    .option("--project <name>", "Filter action_log entries by project")
    .option("--source <system>", "Filter action_log entries by source_system")
    .option(
      "--limit <n>",
      "Maximum actions to scan",
      parsePositiveInteger,
      1000
    )
    .option(
      "--issue-limit <n>",
      "Maximum missing-pointer issues to return",
      parsePositiveInteger,
      50
    )
    .option(
      "--now <iso>",
      "Override current time for deterministic checks",
      parseDateOption
    )
    .option("--json", "Emit JSON report", false)
    .action((when, opts) => {
      const db = openDb();
      try {
        const report = reconcileActionPointers(db, when, {
          project: opts.project,
          sourceSystem: opts.source,
          limit: opts.limit,
          issueLimit: opts.issueLimit,
          now: opts.now,
        });

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          return;
        }

        process.stdout.write(formatActionReconcile(report));
      } finally {
        db.close();
      }
    });
}
