import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  detectCuriosityClusters,
  type CuriosityOptions,
} from "../../../compost-core/src/cognitive/curiosity";
import type { OpenProblemStatus } from "../../../compost-core/src/cognitive/gap-tracker";

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

export function registerCuriosity(program: Command): void {
  program
    .command("curiosity")
    .description(
      "Cluster open gaps by token-level Jaccard overlap and surface hotspots (Phase 6 P0 — Curiosity agent). Deterministic, no LLM."
    )
    .option(
      "--window-days <n>",
      "Include gaps last asked within this many days",
      (v) => Number.parseInt(v, 10),
      30
    )
    .option(
      "--min-jaccard <f>",
      "Minimum Jaccard overlap (0-1) for two gaps to cluster. Higher = stricter",
      (v) => Number.parseFloat(v),
      0.3
    )
    .option(
      "--max-clusters <n>",
      "Cap on clusters returned (sorted by total_asks desc)",
      (v) => Number.parseInt(v, 10),
      10
    )
    .option(
      "--status <status>",
      "Gap status to cluster over: open | resolved | dismissed",
      "open"
    )
    .option("--json", "Emit JSON report instead of human-readable", false)
    .action((opts) => {
      const db = openDb();
      try {
        const detectOpts: CuriosityOptions = {
          windowDays: opts.windowDays,
          minJaccard: opts.minJaccard,
          maxClusters: opts.maxClusters,
        };
        if (
          opts.status === "open" ||
          opts.status === "resolved" ||
          opts.status === "dismissed"
        ) {
          detectOpts.status = opts.status as OpenProblemStatus;
        }

        const report = detectCuriosityClusters(db, detectOpts);

        if (opts.json) {
          process.stdout.write(JSON.stringify(report, null, 2) + "\n");
          return;
        }

        if (report.clusters.length === 0 && report.unclustered.length === 0) {
          process.stdout.write(
            `(no gaps in last ${report.window_days}d under status filter)\n`
          );
          return;
        }

        if (report.clusters.length > 0) {
          process.stdout.write(
            `clusters (${report.clusters.length}):\n`
          );
          for (const c of report.clusters) {
            process.stdout.write(
              `  [${c.total_asks} asks, ${c.gap_ids.length} gaps] ${c.representative}\n`
            );
            process.stdout.write(
              `    shared: ${c.shared_tokens.join(", ") || "(none)"}\n`
            );
          }
          process.stdout.write("\n");
        }

        if (report.unclustered.length > 0) {
          process.stdout.write(
            `unclustered (${report.unclustered.length}):\n`
          );
          for (const g of report.unclustered) {
            process.stdout.write(
              `  [${g.ask_count} asks] ${g.question}\n`
            );
          }
        }
      } finally {
        db.close();
      }
    });
}
