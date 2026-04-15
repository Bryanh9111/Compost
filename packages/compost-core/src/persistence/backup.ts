import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from "fs";
import { join, basename } from "path";

/**
 * P0-7 Backup / Restore — debate 003 Pre-P0 fix #5 + Phase 4 Batch D.
 *
 * Strategy: SQLite `VACUUM INTO` produces an atomic, defragmented snapshot
 * that is consistent under WAL. Snapshots are filename-versioned by UTC date
 * (`YYYY-MM-DD.db`); same-day backups overwrite. Retention enforced after
 * each backup.
 *
 * Lock window: backups SHOULD run in the 03:00 UTC window declared in
 * `docs/ARCHITECTURE.md` to avoid SQLite writer-lock contention with the
 * 6h reflect scheduler (00/06/12/18 UTC). The function itself does not
 * enforce the window — that lives in `compost-daemon`'s `startBackupScheduler`.
 */

export const DEFAULT_BACKUP_RETENTION = 30;

const BACKUP_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.db$/;

export interface BackupResult {
  path: string;
  takenAt: string;          // ISO-8601 UTC
  sizeBytes: number;
  durationMs: number;
}

export interface BackupSnapshot {
  path: string;
  date: string;             // YYYY-MM-DD
  takenAt: string;          // ISO-8601 from file mtime
  sizeBytes: number;
}

/**
 * Take an atomic snapshot of `db` to `<backupDir>/YYYY-MM-DD.db`.
 * Same-day backups overwrite (idempotent within a day). Caller is
 * responsible for time-window discipline (see ARCHITECTURE.md).
 */
export function backup(db: Database, backupDir: string): BackupResult {
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }

  const startedAt = Date.now();
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const targetPath = join(backupDir, `${dateStr}.db`);

  // VACUUM INTO replaces target file atomically. Remove any stale prior
  // copy first to avoid SQLite "target exists" semantics on some versions.
  if (existsSync(targetPath)) {
    unlinkSync(targetPath);
  }

  // SQLite literal — backup path is operator-controlled, but escape single
  // quotes defensively in case operator passes a path with ' in it.
  const escaped = targetPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  const stat = statSync(targetPath);
  return {
    path: targetPath,
    takenAt: new Date().toISOString(),
    sizeBytes: stat.size,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * List backups in `backupDir`, newest first.
 */
export function listBackups(backupDir: string): BackupSnapshot[] {
  if (!existsSync(backupDir)) return [];

  const entries: BackupSnapshot[] = [];
  for (const name of readdirSync(backupDir)) {
    const match = name.match(BACKUP_FILE_PATTERN);
    if (!match) continue;
    const fullPath = join(backupDir, name);
    const stat = statSync(fullPath);
    entries.push({
      path: fullPath,
      date: match[1]!,
      takenAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  }

  // Newest first by date filename (lexicographic == chronological)
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Delete oldest backups beyond `retention`. Returns count deleted.
 */
export function pruneOldBackups(
  backupDir: string,
  retention: number = DEFAULT_BACKUP_RETENTION
): number {
  if (retention < 1) {
    throw new Error(`retention must be >= 1 (got ${retention})`);
  }
  const all = listBackups(backupDir);
  const toDelete = all.slice(retention);
  for (const snap of toDelete) {
    unlinkSync(snap.path);
  }
  return toDelete.length;
}

/**
 * Restore by file-copying `backupPath` over `targetPath`.
 *
 * SAFETY: Caller MUST ensure no daemon process holds `targetPath` open.
 * This function does not coordinate with running daemons; it just copies.
 * The CLI wrapper is responsible for refusing restore when the daemon PID
 * file is live.
 */
export function restore(backupPath: string, targetPath: string): void {
  if (!existsSync(backupPath)) {
    throw new Error(`backup not found: ${backupPath}`);
  }
  if (!BACKUP_FILE_PATTERN.test(basename(backupPath))) {
    throw new Error(
      `refusing to restore from non-backup-named file: ${backupPath} ` +
      `(expected YYYY-MM-DD.db)`
    );
  }
  copyFileSync(backupPath, targetPath);
}

/**
 * Resolve a date string (or "latest") to a backup path. Used by `compost restore`.
 */
export function resolveBackup(
  backupDir: string,
  selector: string
): BackupSnapshot {
  const all = listBackups(backupDir);
  if (all.length === 0) {
    throw new Error(`no backups found in ${backupDir}`);
  }
  if (selector === "latest") {
    return all[0]!;
  }
  // Exact YYYY-MM-DD match
  const match = all.find((b) => b.date === selector);
  if (!match) {
    throw new Error(
      `no backup for date "${selector}" in ${backupDir}. ` +
      `Available: ${all.map((b) => b.date).join(", ")}`
    );
  }
  return match;
}
