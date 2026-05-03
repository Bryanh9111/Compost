import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  auditCoverage,
  formatCoverageAudit,
} from "../../../compost-core/src/metacognitive/coverage-audit";

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

export function registerCover(program: Command): void {
  program
    .command("cover")
    .description(
      "Audit metacognitive coverage for a topic across action_log, repo docs, and artifact pointers"
    )
    .argument("<topic>", "Topic or timeline question to audit")
    .option("--project <name>", "Filter action_log evidence by project")
    .option(
      "--since-days <n>",
      "Only include actions newer than this many days",
      parsePositiveInteger
    )
    .option(
      "--limit <n>",
      "Maximum matched actions to return",
      parsePositiveInteger,
      20
    )
    .option("--repo-root <path>", "Repo root for README/docs scanning", process.cwd())
    .option("--no-docs", "Skip README/docs scanning")
    .option("--json", "Emit JSON report", false)
    .action((topic, opts) => {
      const db = openDb();
      try {
        const report = auditCoverage(db, topic, {
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

        process.stdout.write(formatCoverageAudit(report));
      } finally {
        db.close();
      }
    });
}
