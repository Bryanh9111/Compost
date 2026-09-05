import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {applyMigrations} from '../../compost-core/src/schema/migrator';
import {reflect} from '../../compost-core/src/cognitive/reflect';
import {ensureEngramSource,ingestEngramEntry} from '../src/ingest-adapter';
import {runEngramPullOnce} from '../../compost-daemon/src/engram-poller';
import {StreamPuller,type StreamForCompostArgs,type EngramStreamEntry} from '../src/stream-puller';
const entry:EngramStreamEntry={memory_id:'audit',kind:'decision',content:'Keep the canonical artifact pointer',project:'audit',scope:'project',created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',tags:[],origin:'human'};
function setup(){const dir=mkdtempSync(join(tmpdir(),'compost-audit-'));const db=new Database(join(dir,'ledger.db'));applyMigrations(db);ensureEngramSource(db);return {dir,db,close(){db.close();rmSync(dir,{recursive:true,force:true});}};}

test('Engram action survives sensory GC and repeated ingestion',async()=>{
 const f=setup();try{
  await ingestEngramEntry(f.db,entry);await ingestEngramEntry(f.db,entry);
  expect(f.db.query('select count(*) n from action_log').get()).toEqual({n:1});
  f.db.run("update observations set captured_at=datetime('now','-8 days')");
  expect(reflect(f.db).sensoryObservationsDeleted).toBe(1);
  const a=f.db.query('select source_observe_id,artifact_locations from action_log').get() as {source_observe_id:string|null;artifact_locations:string};
  expect(a.source_observe_id).toBeNull();expect(a.artifact_locations).toContain('engram://memory/audit');
  await ingestEngramEntry(f.db,entry);
  expect(f.db.query('select count(*) n from action_log').get()).toEqual({n:1});
 }finally{f.close();}
});
test('failed batch retries without moving past its failed entry',async()=>{
 const f=setup();try{
  const client={async streamForCompost(args:StreamForCompostArgs){return {ok:true,data:args.since?[]:[entry]};}};
  f.db.exec("CREATE TRIGGER reject_ingest BEFORE INSERT ON observations BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
  const cursorPath=join(f.dir,'cursor.json');
  const fail=await runEngramPullOnce(f.db,{client,cursorPath});expect(fail.errors.length).toBeGreaterThan(0);
  f.db.exec('DROP TRIGGER reject_ingest');
  const retry=await runEngramPullOnce(f.db,{client,cursorPath});expect(retry.entries_new).toBe(1);
 }finally{f.close();}
});
test('puller sends a composite cursor and retains the final tied ID',async()=>{
 const f=setup();try{
  const calls:StreamForCompostArgs[]=[];const rows=[{...entry,memory_id:'a'},{...entry,memory_id:'b'},{...entry,memory_id:'c'}];
  const client={async streamForCompost(args:StreamForCompostArgs){calls.push(args);return {ok:true,data:args.after_id?rows.filter(r=>r.memory_id>args.after_id!).slice(0,args.limit):rows.slice(0,args.limit)};}};
  const puller=new StreamPuller(client,{cursorPath:join(f.dir,'cursor')});
  const first=await puller.pullBatch({limit:2});expect(first.cursor.last_memory_id).toBe('b');
  const second=await puller.pullBatch({limit:2,cursor:first.cursor});expect(second.entries.map(r=>r.memory_id)).toEqual(['c']);expect(calls[1].after_id).toBe('b');
 }finally{f.close();}
});
test('revoked upstream caches are archived while history survives, outage retains local availability',async()=>{
 const f=setup();try{
  await ingestEngramEntry(f.db,entry);
  const client={async streamForCompost(){return {ok:true,data:[]};},async statesForCompost(ids:string[]){return {ok:true,data:ids.map(memory_id=>({memory_id,status:'obsolete',expires_at:null,searchable:false}))};}};
  await runEngramPullOnce(f.db,{client,cursorPath:join(f.dir,'cursor')});
  expect(f.db.query('select count(*) n from facts where archived_at is null').get()).toEqual({n:0});
  expect(f.db.query('select count(*) n from action_log').get()).toEqual({n:1});
  await ingestEngramEntry(f.db,{...entry,memory_id:"still-live"});
  const down={...client,async statesForCompost(){return {ok:false,error:'offline'};}};
  const r=await runEngramPullOnce(f.db,{client:down,cursorPath:join(f.dir,'cursor')});
  expect(r.errors.join(' ')).toContain('offline');
  expect(f.db.query('select count(*) n from facts where archived_at is null').get()).toEqual({n:1});
 }finally{f.close();}
});

test("Engram replays scrub materialized text while preserving upstream identity", async()=>{
  const db=new Database(":memory:");applyMigrations(db);ensureEngramSource(db);
  const entry={memory_id:"private-fixture",kind:"fact",content:"API_KEY=syntheticSecret12345",project:"audit",scope:"project" as const,created_at:"2026-09-01T00:00:00Z",updated_at:"2026-09-01T00:00:00Z",tags:[],origin:"human" as const};
  try {
    await ingestEngramEntry(db,entry);
    const values=[...db.query("SELECT object FROM facts").all(),...db.query("SELECT text_content FROM chunks").all(),...db.query("SELECT what_text FROM action_log").all()];
    expect(JSON.stringify(values)).not.toContain("syntheticSecret12345");
    expect(entry.content).toContain("syntheticSecret12345");
    expect(db.query("SELECT source_id FROM action_log").get()).toEqual({source_id:"engram://memory/private-fixture"});
  }finally{db.close();}
});
