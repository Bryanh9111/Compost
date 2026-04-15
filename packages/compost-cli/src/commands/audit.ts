import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  listDecisions,
  type AuditKind,
  type AuditActor,
} from "../../../compost-core/src/cognitive/audit";

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

const VALID_KINDS = new Set<AuditKind>([
  "contradiction_arbitration",
  "wiki_rebuild",
  "fact_excretion",
  "profile_switch",
]);

const VALID_ACTORS = new Set<AuditActor>(["reflect", "wiki", "user", "agent"]);

export function registerAudit(program: Command): void {
  const cmd = program
    .command("audit")
    .description("Inspect the decision_audit trail (P0-2)");

  cmd
    .command("list")
    .description("List recent decision_audit rows (newest first)")
    .option("--kind <kind>", "filter by kind (contradiction_arbitration / wiki_rebuild / fact_excretion / profile_switch)")
    .option("--since <iso>", "only rows with decided_at >= this ISO timestamp")
    .option("--target <id>", "filter by target_id")
    .option("--decided-by <actor>", "filter by decided_by (reflect / wiki / user / agent)")
    .option("--limit <n>", "max rows (default 100)", "100")
    .action((opts) => {
      if (opts.kind && !VALID_KINDS.has(opts.kind as AuditKind)) {
        process.stderr.write(`error: unknown --kind "${opts.kind}"\n`);
        process.exit(2);
      }
      if (opts.decidedBy && !VALID_ACTORS.has(opts.decidedBy as AuditActor)) {
        process.stderr.write(`error: unknown --decided-by "${opts.decidedBy}"\n`);
        process.exit(2);
      }
      const limit = Number(opts.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
        process.stderr.write(`error: --limit must be 1..10000 (got ${opts.limit})\n`);
        process.exit(2);
      }

      const db = openDb();
      try {
        const rows = listDecisions(db, {
          kind: opts.kind as AuditKind | undefined,
          sinceIso: opts.since,
          targetId: opts.target,
          decidedBy: opts.decidedBy as AuditActor | undefined,
          limit,
        });
        process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
      } finally {
        db.close();
      }
    });
}
