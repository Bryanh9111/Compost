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
      "Compose a dry-run digest of noteworthy ledger state (Phase 6 P0 slice 2 Round A; no Engram push)"
    )
    .option(
      "--since-days <n>",
      "Window size in days",
      (v) => Number.parseInt(v, 10),
      7
    )
    .option(
      "--confidence-floor <f>",
      "Minimum fact confidence to include",
      (v) => Number.parseFloat(v),
      0.85
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
      "Emit the shape that Round B will feed to EngramWriter.writeInsight (JSON)",
      false
    )
    .action((opts) => {
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
