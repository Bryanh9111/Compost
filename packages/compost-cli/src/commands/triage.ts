import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  triage,
  listSignals,
  resolveSignal,
  type SignalKind,
} from "../../../compost-core/src/cognitive/triage";

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

// Debate 011 contract: single source of truth for the 6 kinds lives in
// triage.ts. Mirror here as a Set to validate CLI input before hitting SQL.
const VALID_KINDS = new Set<SignalKind>([
  "stale_fact",
  "unresolved_contradiction",
  "stuck_outbox",
  "orphan_delta",
  "stale_wiki",
  "correction_candidate",
]);

const VALID_RESOLVERS = new Set(["user", "agent"]);

export function registerTriage(program: Command): void {
  const cmd = program
    .command("triage")
    .description("Inspect and manage health_signals (P0-1, surface-only)");

  cmd
    .command("scan")
    .description(
      "Run a triage pass: scan the 5 signal kinds, insert new rows, report counts"
    )
    .action(() => {
      const db = openDb();
      try {
        const report = triage(db);
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      } finally {
        db.close();
      }
    });

  cmd
    .command("list")
    .description("List health_signals rows (unresolved by default, newest first)")
    .option(
      "--kind <kind>",
      "filter by kind (stale_fact / unresolved_contradiction / stuck_outbox / orphan_delta / stale_wiki / correction_candidate)"
    )
    .option("--since <iso>", "only rows with created_at >= this ISO timestamp")
    .option("--include-resolved", "include already-resolved rows (default: only unresolved)")
    .option("--limit <n>", "max rows (default 100)", "100")
    .action((opts) => {
      if (opts.kind && !VALID_KINDS.has(opts.kind as SignalKind)) {
        process.stderr.write(`error: unknown --kind "${opts.kind}"\n`);
        process.exit(2);
      }
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
        process.stderr.write(
          `error: --limit must be 1..10000 (got ${opts.limit})\n`
        );
        process.exit(2);
      }

      const db = openDb();
      try {
        const rows = listSignals(db, {
          kind: opts.kind as SignalKind | undefined,
          sinceIso: opts.since,
          includeResolved: opts.includeResolved ?? false,
          limit,
        });
        process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
      } finally {
        db.close();
      }
    });

  cmd
    .command("resolve <id>")
    .description("Mark a signal resolved (surface-only: does NOT fix the underlying cause)")
    .option(
      "--by <actor>",
      "actor performing the resolution (user or agent)",
      "user"
    )
    .action((idStr: string, opts) => {
      const id = Number(idStr);
      if (!Number.isInteger(id) || id < 1) {
        process.stderr.write(`error: <id> must be a positive integer (got ${idStr})\n`);
        process.exit(2);
      }
      if (!VALID_RESOLVERS.has(opts.by)) {
        process.stderr.write(`error: --by must be user or agent (got ${opts.by})\n`);
        process.exit(2);
      }

      const db = openDb();
      try {
        resolveSignal(db, id, opts.by as "user" | "agent");
        process.stdout.write(`resolved signal ${id} by ${opts.by}\n`);
      } finally {
        db.close();
      }
    });
}
