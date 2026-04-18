import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  dismissGap,
  forgetGap,
  gapStats,
  listGaps,
  resolveGap,
  type OpenProblemStatus,
} from "../../../compost-core/src/cognitive/gap-tracker";

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

export function registerGaps(program: Command): void {
  const gaps = program
    .command("gaps")
    .description(
      "Inspect and manage Compost's gap tracker (Phase 6 P0 — open questions the brain could not answer)"
    );

  gaps
    .command("list")
    .description("List open problems Compost hasn't answered confidently")
    .option(
      "--status <status>",
      "Filter by status: open | resolved | dismissed"
    )
    .option("--limit <n>", "Max rows", (v) => Number.parseInt(v, 10), 50)
    .option("--json", "Emit full rows as JSON", false)
    .action((opts) => {
      const db = openDb();
      try {
        const listOpts: { status?: OpenProblemStatus; limit: number } = {
          limit: opts.limit,
        };
        if (
          opts.status === "open" ||
          opts.status === "resolved" ||
          opts.status === "dismissed"
        ) {
          listOpts.status = opts.status;
        }
        const rows = listGaps(db, listOpts);
        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
          return;
        }
        if (rows.length === 0) {
          process.stdout.write("(no gaps)\n");
          return;
        }
        for (const r of rows) {
          const conf =
            r.last_answer_confidence != null
              ? ` conf=${r.last_answer_confidence.toFixed(2)}`
              : "";
          process.stdout.write(
            `[${r.status}] ${r.problem_id} asks=${r.ask_count}${conf}\n  ${r.question}\n  last=${r.last_asked_at}\n`
          );
        }
      } finally {
        db.close();
      }
    });

  gaps
    .command("forget <id>")
    .description("Hard-delete a gap row")
    .action((id) => {
      const db = openDb();
      try {
        const ok = forgetGap(db, id);
        process.stdout.write(
          JSON.stringify({ forget: ok, id }, null, 2) + "\n"
        );
        if (!ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  gaps
    .command("dismiss <id>")
    .description("Mark a gap as dismissed (keeps history, hides from default list)")
    .action((id) => {
      const db = openDb();
      try {
        const ok = dismissGap(db, id);
        process.stdout.write(
          JSON.stringify({ dismiss: ok, id }, null, 2) + "\n"
        );
        if (!ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  gaps
    .command("resolve <id>")
    .description(
      "Mark a gap as resolved — optional --observation and --fact links to the answer"
    )
    .option("--observation <id>", "Observation that answered the gap")
    .option("--fact <id>", "Fact that answered the gap")
    .action((id, opts) => {
      const db = openDb();
      try {
        const resolveOpts: { observationId?: string; factId?: string } = {};
        if (opts.observation !== undefined) resolveOpts.observationId = opts.observation;
        if (opts.fact !== undefined) resolveOpts.factId = opts.fact;
        const ok = resolveGap(db, id, resolveOpts);
        process.stdout.write(
          JSON.stringify({ resolve: ok, id, ...resolveOpts }, null, 2) + "\n"
        );
        if (!ok) process.exitCode = 1;
      } finally {
        db.close();
      }
    });

  gaps
    .command("stats")
    .description("Summary counts across all gap statuses")
    .action(() => {
      const db = openDb();
      try {
        const s = gapStats(db);
        process.stdout.write(JSON.stringify(s, null, 2) + "\n");
      } finally {
        db.close();
      }
    });
}
