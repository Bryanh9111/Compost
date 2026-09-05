import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import { runCli } from "./run-cli";

test("Engram replay previews full history, preserves cursor backup and recovers each stable action once", async () => {
  const dir=mkdtempSync(join(tmpdir(),"compost-engram-replay-"));
  const bin=join(dir,"engram-fixture");const cursor=join(dir,"engram-cursor.json");
  writeFileSync(bin,`#!/usr/bin/env bun
const args=process.argv.slice(2);
const ids=Array.from({length:1001},(_,i)=>String(i).padStart(5,'0'));
if(args[0]==='export-states') console.log(JSON.stringify(args.slice(args.indexOf('--ids')+1).map(memory_id=>({memory_id,status:'active',expires_at:null,searchable:true}))));
else {
 const after=args.includes('--after-id')?args[args.indexOf('--after-id')+1]:null;
 const limit=Number(args[args.indexOf('--limit')+1]||1000);
 for(const memory_id of ids.filter(id=>!after||id>after).slice(0,limit)) console.log(JSON.stringify({memory_id,kind:'fact',content:'Recovery fixture '+memory_id,project:'audit',scope:'project',created_at:'2026-09-01T00:00:00.123456Z',updated_at:'2026-09-01T00:00:00.123456Z',tags:[],origin:'human'}));
}
`,{mode:0o700});
  try {
    const old=JSON.stringify({since:"2026-09-02T00:00:00Z",last_memory_id:"99999"});writeFileSync(cursor,old);
    const preview=await runCli(["engram-pull","--engram-bin",bin,"--dry-run","--replay"],dir);
    expect(preview.exitCode).toBe(0);expect(JSON.parse(preview.stdout).entry_count).toBe(1001);
    expect(readFileSync(cursor,"utf8")).toBe(old);expect(existsSync(join(dir,"ledger.db"))).toBe(false);
    const args=["engram-pull","--engram-bin",bin,"--no-embed","--replay"];
    const applied=await runCli(args,dir);expect(applied.exitCode,applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout).entries_new).toBe(1001);
    const second=await runCli(args,dir);expect(second.exitCode).toBe(0);expect(JSON.parse(second.stdout).entries_duplicate).toBe(1001);
    const db=new Database(join(dir,"ledger.db"));
    expect(db.query("SELECT count(*) n FROM action_log WHERE source_system='engram'").get()).toEqual({n:1001});
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);db.close();
    expect(JSON.parse(readFileSync(cursor,"utf8")).last_memory_id).toBe("01000");
    await expect(runCli(["engram-pull","--project","audit","--dry-run"],dir)).rejects.toThrow("--cursor-path");
  } finally {rmSync(dir,{recursive:true,force:true});}
},30_000);
