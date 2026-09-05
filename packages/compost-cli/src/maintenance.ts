import {Database} from 'bun:sqlite';
import {createHash} from 'crypto';
import {chmodSync} from 'fs';
import {join} from 'path';
import {backup} from '../../compost-core/src/persistence/backup';
import {processObservationAction} from '../../compost-core/src/metacognitive/action-processor';
import {scrubEnvelope} from '../../compost-hook-shim/src/pii';

type Cell = string | number | null | Uint8Array;
interface Repair {table:string; idColumn:string; id:Cell; before:Record<string,Cell>; after:Record<string,Cell>}
export interface MaintenanceOptions {apply?:boolean; scrubPii?:boolean; repairAccessLog?:boolean; backfillActions?:boolean; backupDir:string}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Explicit, backup-first repair API. Preview exposes counts, never original contents. */
export function maintainLedger(db:Database, opts:MaintenanceOptions) {
  const repairs:Repair[]=[];
  if(opts.scrubPii){
    // Repair captured content and its materialized copies; never touch source
    // files, external memories, stable identity keys or credential stores.
    const specs=[
      ['observe_outbox','seq',['payload']],
      ['observations','observe_id',['raw_bytes','metadata']],
      ['facts','fact_id',['subject','predicate','object']],
      ['chunks','chunk_id',['text_content']],
      ['action_log','action_id',['what_text','next_query_hint']],
    ] as const;
    for(const [table,idColumn,columns] of specs){
      const rows=db.query(`SELECT ${idColumn},${columns.join(',')} FROM ${table}`).all() as Record<string,Cell>[];
      for(const row of rows){
        const before:Record<string,Cell>={};const after:Record<string,Cell>={};
        for(const col of columns){
          const old=row[col];if(old===null||old===undefined)continue;
          const text=old instanceof Uint8Array?Buffer.from(old).toString('utf8'):String(old);
          // Refuse binary round-trip changes. Raw text bytes are the only
          // admissible source for this redaction-only maintenance operation.
          if(old instanceof Uint8Array&&!Buffer.from(text).equals(Buffer.from(old)))continue;
          const clean=scrubEnvelope({content:text});
          if(!clean.redactions)continue;
          before[col]=old;after[col]=old instanceof Uint8Array?Buffer.from(clean.envelope.content):clean.envelope.content;
        }
        if(Object.keys(after).length)repairs.push({table,idColumn,id:row[idColumn]!,before,after});
      }
    }
  }
  const dangling=opts.repairAccessLog?db.query(`SELECT rowid AS repair_id FROM access_log WHERE NOT EXISTS
    (SELECT 1 FROM facts WHERE facts.fact_id=access_log.fact_id)`).all() as {repair_id:number}[]:[];
  const missing=opts.backfillActions?db.query(`SELECT o.observe_id FROM observations o
    WHERE NOT EXISTS(SELECT 1 FROM action_log a WHERE a.source_observe_id=o.observe_id)`).all() as {observe_id:string}[]:[];
  const report={mode:opts.apply?'applied':'dry-run',privacy_rows:repairs.length,
    privacy_by_table:{} as Record<string,number>,dangling_access_rows:dangling.length,
    action_candidates:missing.length,actions_inserted:0,actions_linked:0,changed_rows:0,
    backup_path:null as string|null};
  for(const r of repairs)report.privacy_by_table[r.table]=(report.privacy_by_table[r.table]??0)+1;
  if(!opts.apply)return report;
  const snapshot=backup(db,join(opts.backupDir,`${new Date().toISOString().replace(/[:.]/g,'-')}-maintenance`));
  chmodSync(snapshot.path,0o600);
  const saved=new Database(snapshot.path,{readonly:true});
  try{for(const pragma of ['quick_check','integrity_check']){
    const rows=saved.query(`PRAGMA ${pragma}`).all() as Record<string,string>[];
    if(rows.some(r=>Object.values(r).some(v=>v!=='ok')))throw new Error(`backup ${pragma} failed`);
  }}finally{saved.close();}
  report.backup_path=snapshot.path;
  const log=(operation:string,table:string,id:Cell,detail:unknown)=>db.run(
    'INSERT INTO maintenance_audit(operation,target_table,target_id,detail_json) VALUES (?,?,?,?)',
    [operation,table,String(id),JSON.stringify(detail)]);
  db.transaction(()=>{
    for(const r of repairs){
      const columns=Object.keys(r.after);const fields=[...columns];const values:Cell[]=columns.map(c=>r.after[c]!);
      if(r.table==='observations'&&r.after.raw_bytes){
        const digest=createHash('sha256').update(r.after.raw_bytes as Uint8Array).digest('hex');
        fields.push('content_hash','raw_hash');values.push(digest,digest);
      }
      if(r.table==='chunks'&&r.after.text_content){
        fields.push('content_hash','embedded_at');values.push(createHash('sha256').update(String(r.after.text_content)).digest('hex'),null);
      }
      const result=db.run(`UPDATE ${r.table} SET ${fields.map(c=>`${c}=?`).join(',')}
        WHERE ${r.idColumn}=? AND ${columns.map(c=>`${c} IS ?`).join(' AND ')}`,
        [...values,r.id,...columns.map(c=>r.before[c]!)]);
      if(result.changes){report.changed_rows++;log('privacy-redaction',r.table,r.id,{columns,before_sha256:hash(r.before),after_sha256:hash(r.after),backup:snapshot.path});}
    }
    for(const row of dangling){
      const removed=db.run('DELETE FROM access_log WHERE rowid=? AND fact_id NOT IN (SELECT fact_id FROM facts)',[row.repair_id]);
      if(removed.changes){report.changed_rows++;log('remove-dangling-access','access_log',row.repair_id,{backup:snapshot.path});}
    }
    for(const row of missing){
      const r=processObservationAction(db,row.observe_id);
      if(r.status==='error')throw new Error(r.reason);
      if(r.status==='inserted')report.actions_inserted++;
      if(r.status==='duplicate')report.actions_linked++;
    }
    if(missing.length)log('backfill-actions','action_log','batch',{candidates:missing.length,inserted:report.actions_inserted,linked:report.actions_linked});
  })();
  return report;
}
