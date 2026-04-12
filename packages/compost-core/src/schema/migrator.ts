import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(import.meta.dir, ".");
const TRACKING_TABLE = "_compost_migrations";

interface MigrationRecord {
  name: string;
  applied_at: string;
  checksum: string;
}

interface ApplyResult {
  applied: MigrationRecord[];
  errors: Array<{ name: string; error: string }>;
}

interface MigrationStatus {
  applied: MigrationRecord[];
  pending: string[];
}

function ensureTrackingTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT NOT NULL
    )
  `);
}

function discoverMigrations(): Array<{ name: string; path: string }> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  return files.map((f) => ({
    name: f.replace(/\.sql$/, ""),
    path: join(MIGRATIONS_DIR, f),
  }));
}

function checksum(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

export function applyMigrations(db: Database): ApplyResult {
  ensureTrackingTable(db);

  const applied: MigrationRecord[] = [];
  const errors: ApplyResult["errors"] = [];
  const migrations = discoverMigrations();

  const alreadyApplied = new Set(
    (
      db.query(`SELECT name FROM ${TRACKING_TABLE}`).all() as { name: string }[]
    ).map((r) => r.name)
  );

  for (const migration of migrations) {
    if (alreadyApplied.has(migration.name)) continue;

    const sql = readFileSync(migration.path, "utf-8");
    const hash = checksum(sql);

    try {
      // PRAGMA statements must run outside transactions in SQLite
      const pragmaLines: string[] = [];
      const schemaLines: string[] = [];

      for (const line of sql.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.toUpperCase().startsWith("PRAGMA ")) {
          pragmaLines.push(trimmed);
        } else {
          schemaLines.push(line);
        }
      }

      // Apply PRAGMAs outside transaction
      for (const pragma of pragmaLines) {
        db.exec(pragma);
      }

      // Apply schema in a transaction
      const schemaSQL = schemaLines.join("\n").trim();
      if (schemaSQL) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(schemaSQL);
          db.run(
            `INSERT INTO ${TRACKING_TABLE} (name, checksum) VALUES (?, ?)`,
            [migration.name, hash]
          );
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }

      const record: MigrationRecord = {
        name: migration.name,
        applied_at: new Date().toISOString(),
        checksum: hash,
      };
      applied.push(record);
    } catch (e) {
      errors.push({
        name: migration.name,
        error: e instanceof Error ? e.message : String(e),
      });
      break; // Stop on first error - migrations are sequential
    }
  }

  return { applied, errors };
}

export function getMigrationStatus(db: Database): MigrationStatus {
  ensureTrackingTable(db);

  const allMigrations = discoverMigrations();
  const appliedRows = db
    .query(
      `SELECT name, applied_at, checksum FROM ${TRACKING_TABLE} ORDER BY name`
    )
    .all() as MigrationRecord[];

  const appliedNames = new Set(appliedRows.map((r) => r.name));
  const pending = allMigrations
    .filter((m) => !appliedNames.has(m.name))
    .map((m) => m.name);

  return { applied: appliedRows, pending };
}
