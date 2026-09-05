import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync,existsSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {applyMigrations} from '../../compost-core/src/schema/migrator';
import {upsertPolicies} from '../../compost-core/src/policies/registry';
import {maintainLedger} from '../src/maintenance';
test('maintenance preview is read-only; apply is backed up, redacted, audited and idempotent',()=>{
 const dir=mkdtempSync(join(tmpdir(),'maintenance-'));const db=new Database(join(dir,'ledger.db'));applyMigrations(db);upsertPolicies(db);
 try{
  db.exec('PRAGMA foreign_keys=OFF');db.run("INSERT INTO access_log(fact_id,accessed_at_unix_sec,query_id,ranking_profile_id) VALUES ('missing',0,'q','rp-phase3-default')");db.exec('PRAGMA foreign_keys=ON');
  db.run(`INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload)
    VALUES ('codex','s','host-adapter','test://s','k','first_party','tp-2026-04',?)`,[JSON.stringify({content:'API_KEY=syntheticSecret12345'})]);
  const opts={scrubPii:true,repairAccessLog:true,backfillActions:true,backupDir:join(dir,'backups')};
  const dry=maintainLedger(db,opts);expect(dry.privacy_rows).toBe(1);expect(dry.dangling_access_rows).toBe(1);
  expect(db.query('select payload from observe_outbox').get()).toEqual({payload:JSON.stringify({content:'API_KEY=syntheticSecret12345'})});
  const applied=maintainLedger(db,{...opts,apply:true});expect(applied.changed_rows).toBe(2);expect(existsSync(applied.backup_path!)).toBe(true);
  expect(JSON.stringify(db.query('select payload from observe_outbox').get())).not.toContain('syntheticSecret12345');
  expect(db.query('pragma foreign_key_check').all()).toHaveLength(0);
  expect(db.query('select count(*) n from maintenance_audit').get()).toEqual({n:2});
  expect(maintainLedger(db,opts).privacy_rows).toBe(0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('repair rolls back captured text when its audit insert fails',()=>{
 const dir=mkdtempSync(join(tmpdir(),'maintenance-rollback-'));const db=new Database(join(dir,'ledger.db'));applyMigrations(db);upsertPolicies(db);
 try {
  const payload=JSON.stringify({content:'API_KEY=syntheticRollback123'});
  db.run(`INSERT INTO observe_outbox(adapter,source_id,source_kind,source_uri,idempotency_key,trust_tier,transform_policy,payload) VALUES ('test','s','host-adapter','test://s','k','first_party','tp-2026-04',?)`,[payload]);
  db.exec("CREATE TRIGGER reject_maintenance BEFORE INSERT ON maintenance_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  expect(()=>maintainLedger(db,{apply:true,scrubPii:true,backupDir:join(dir,'backups')})).toThrow('audit unavailable');
  expect(db.query('SELECT payload FROM observe_outbox').get()).toEqual({payload});
  expect(db.query('SELECT count(*) n FROM maintenance_audit').get()).toEqual({n:0});
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
