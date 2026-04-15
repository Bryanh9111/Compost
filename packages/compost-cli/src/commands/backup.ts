import { Command } from "@commander-js/extra-typings";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { applyMigrations } from "../../../compost-core/src/schema/migrator";
import {
  backup,
  listBackups,
  pruneOldBackups,
  restore,
  resolveBackup,
  DEFAULT_BACKUP_RETENTION,
} from "../../../compost-core/src/persistence/backup";

const DEFAULT_DATA_DIR = join(process.env["HOME"] ?? "/tmp", ".compost");

function dataDir(): string {
  return process.env["COMPOST_DATA_DIR"] ?? DEFAULT_DATA_DIR;
}
function ledgerPath(): string {
  return join(dataDir(), "ledger.db");
}
function backupDir(): string {
  return join(dataDir(), "backups");
}
function pidFile(): string {
  return join(dataDir(), "compost.pid");
}

function openDb(): Database {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new Database(ledgerPath(), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

export function registerBackup(program: Command): void {
  const cmd = program
    .command("backup")
    .description("Manage Compost ledger backups (P0-7)")
    .option(
      "--retention <n>",
      "How many daily snapshots to keep",
      String(DEFAULT_BACKUP_RETENTION)
    )
    .action((opts) => {
      const retention = Number(opts.retention);
      if (!Number.isInteger(retention) || retention < 1) {
        process.stderr.write(
          `error: --retention must be a positive integer (got ${opts.retention})\n`
        );
        process.exit(2);
      }
      const db = openDb();
      try {
        const result = backup(db, backupDir());
        const deleted = pruneOldBackups(backupDir(), retention);
        process.stdout.write(
          JSON.stringify({ ...result, prunedCount: deleted }, null, 2) + "\n"
        );
      } finally {
        db.close();
      }
    });

  cmd
    .command("list")
    .description("List existing backups (newest first)")
    .action(() => {
      const list = listBackups(backupDir());
      process.stdout.write(JSON.stringify(list, null, 2) + "\n");
    });
}

export function registerRestore(program: Command): void {
  program
    .command("restore [date]")
    .description(
      "Restore the ledger from a backup. " +
        "[date] is YYYY-MM-DD or 'latest' (default). " +
        "Refuses if the daemon is running."
    )
    .action((date) => {
      const selector = date ?? "latest";
      // Refuse if daemon is running -- restore would clobber an open file.
      if (existsSync(pidFile())) {
        process.stderr.write(
          `error: daemon appears to be running (${pidFile()} exists). ` +
            `Stop it with 'compost daemon stop' before restoring.\n`
        );
        process.exit(2);
      }
      try {
        const snap = resolveBackup(backupDir(), selector);
        restore(snap.path, ledgerPath());
        process.stdout.write(
          JSON.stringify(
            { restoredFrom: snap.path, ledger: ledgerPath(), date: snap.date },
            null,
            2
          ) + "\n"
        );
      } catch (err) {
        process.stderr.write(
          `error: ${err instanceof Error ? err.message : String(err)}\n`
        );
        process.exit(2);
      }
    });
}
