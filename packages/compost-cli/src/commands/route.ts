import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  formatRouteQuestion,
  routeQuestion,
} from "../../../compost-core/src/metacognitive/router";

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

export function registerRoute(program: Command): void {
  program
    .command("route")
    .description(
      "Route a question to the likely canonical system or artifact pointer"
    )
    .argument("<question>", "Question or topic to route")
    .option("--project <name>", "Filter action_log evidence by project")
    .option(
      "--since-days <n>",
      "Only include actions newer than this many days",
      parsePositiveInteger
    )
    .option(
      "--limit <n>",
      "Maximum route candidates to return",
      parsePositiveInteger,
      10
    )
    .option(
      "--repo-root <path>",
      "Repo root for README/docs scanning",
      process.cwd()
    )
    .option("--no-docs", "Skip README/docs scanning")
    .option("--json", "Emit JSON report", false)
    .action((question, opts) => {
      const db = openDb();
      try {
        const report = routeQuestion(db, question, {
          project: opts.project,
          sinceDays: opts.sinceDays,
          limit: opts.limit,
          repoRoot: opts.repoRoot,
          includeDocs: opts.docs,
        });

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
          return;
        }

        process.stdout.write(formatRouteQuestion(report));
      } finally {
        db.close();
      }
    });
}
