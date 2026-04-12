import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import { drainOne } from "../../../compost-core/src/ledger/outbox";

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

export function registerDrain(program: Command): void {
  program
    .command("drain")
    .description("Force-drain the outbox queue")
    .option("--adapter <name>", "Only drain rows from this adapter")
    .action((opts) => {
      const db = openDb();
      let drained = 0;
      let failed = 0;

      try {
        while (true) {
          // If adapter filter specified, peek to check before draining
          if (opts.adapter) {
            const peek = db
              .query(
                `SELECT seq FROM observe_outbox
                 WHERE drained_at IS NULL AND drain_quarantined_at IS NULL
                   AND adapter = ?
                 ORDER BY seq LIMIT 1`
              )
              .get(opts.adapter) as { seq: number } | null;

            if (!peek) break;
          }

          const result = drainOne(db);
          if (!result) break;
          drained++;
        }
      } catch {
        failed++;
      } finally {
        db.close();
      }

      process.stdout.write(JSON.stringify({ drained, failed }) + "\n");
    });
}
