import type {Database} from 'bun:sqlite';

/** Structural and index checks; savepoint leaves the FTS control command read-only. */
export function checkStorageIntegrity(db: Database) {
  const databaseErrors = db.query('PRAGMA quick_check').all() as Record<string,string>[];
  const foreignKeys = db.query('PRAGMA foreign_key_check').all();
  const ftsErrors: string[] = [];
  db.exec('SAVEPOINT integrity_probe');
  try { db.run("INSERT INTO facts_fts(facts_fts, rank) VALUES ('integrity-check', 1)"); }
  catch(error) { ftsErrors.push(String(error)); }
  finally { db.exec('ROLLBACK TO integrity_probe; RELEASE integrity_probe'); }
  return {database_errors: databaseErrors.flatMap(r=>Object.values(r)).filter(v=>v!=='ok'),
    foreign_key_violations: foreignKeys, fts_errors: ftsErrors};
}
