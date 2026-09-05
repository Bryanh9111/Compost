import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import { runCli } from "./run-cli";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import { logGap } from "../../compost-core/src/cognitive/gap-tracker";

test("operator workflows round-trip command output and persisted state without network", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compost-operator-"));
  const db = new Database(join(dir, "ledger.db")); applyMigrations(db); upsertPolicies(db);
  const run = async (...args: string[]) => {
    const r = await runCli(args, dir);
    expect(r.exitCode, `${args.join(" ")}: ${r.stderr}`).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
    return r.stdout;
  };
  try {
    for (const args of [
      ["gaps", "list"], ["gaps", "stats"], ["curiosity", "clusters"], ["curiosity", "matches"],
      ["crawl", "list"], ["crawl", "stats"], ["digest"], ["digest", "--json"], ["digest", "--insight-input"],
      ["reason", "list"], ["reason", "show", "missing"], ["reason", "stats"], ["reason", "stats", "--json"],
      ["reason", "scheduler", "status"], ["reason", "scheduler", "pause", "--reason", "fixture"],
      ["reason", "scheduler", "status", "--json"], ["reason", "scheduler", "status"], ["reason", "scheduler", "resume"],
      ["doctor", "--reconcile"], ["doctor", "--drain-retry"],
      ["doctor", "--reconcile-engram", "--queue-path", join(dir,"pending.db")],
      ["engram-push", "--dry-run", "--queue-path", join(dir,"pending.db")],
      ["backup"], ["backup", "list"], ["restore", "latest"],
    ]) await run(...args);
    const first = JSON.parse(await run("crawl", "propose", "https://example.test/a", "--rationale", "test", "--tag", "audit", "--json"));
    await run("crawl", "propose", "https://example.test/b");
    await run("crawl", "list", "--status", "proposed", "--proposed-by", "user", "--limit", "5");
    await run("crawl", "list", "--json");
    await run("crawl", "approve", first.crawl_id);
    expect((await runCli(["crawl", "reject", first.crawl_id],dir)).exitCode).toBe(1);
    await run("crawl", "forget", first.crawl_id);
    for (const cmd of ["approve", "reject", "forget"]) {
      expect((await runCli(["crawl", cmd, "missing"],dir)).exitCode).toBe(1);
    }
    // Reopen after the supported restore atomically replaced the database.
    const fresh = new Database(join(dir,"ledger.db"));
    const a = logGap(fresh, "How to validate recovery evidence", { confidence: 0 });
    const b = logGap(fresh, "How to validate recovery backup", { confidence: 0 });
    fresh.close();
    await run("gaps", "list", "--status", "open", "--limit", "10");
    await run("gaps", "list", "--json");
    await run("curiosity", "clusters", "--min-jaccard", "0.1", "--window-days", "30", "--max-clusters", "5");
    await run("curiosity", "clusters", "--json");
    await run("curiosity", "matches", "--only-with-candidates");
    await run("curiosity", "matches", "--json");
    await run("gaps", "dismiss", a.problem_id);
    await run("gaps", "resolve", b.problem_id);
    await run("gaps", "forget", a.problem_id);
    for (const cmd of ["dismiss", "resolve", "forget"]) expect((await runCli(["gaps",cmd,"missing"],dir)).exitCode).toBe(1);
    await run("capture", "zsh", "--command", "git status", "--cwd", dir, "--exit-status", "0", "--json");
    await run("capture", "git", "--repo", dir, "--commit", "a".repeat(40), "--subject", "audit fixture", "--branch", "main", "--json");
    const note = join(dir,"note.md"); writeFileSync(note,"# Fixture\n");
    await run("capture", "obsidian", "--vault-root", dir, "--path", note, "--event", "change", "--json");
    await run("drain", "--adapter", "missing");
    await run("drain");
    await run("reflect");
    for (const cmd of ["did", "patterns", "reconcile"]) {
      await run(cmd,"this week","--limit","10","--now",new Date().toISOString());
      await run(cmd,"this week","--json");
      await expect(runCli([cmd,"today","--limit","0"],dir)).rejects.toThrow("positive integer");
      await expect(runCli([cmd,"today","--now","invalid"],dir)).rejects.toThrow("ISO timestamp");
    }
    for (const cmd of ["cover", "route"]) {
      await run(cmd,"audit","--repo-root",dir,"--since-days","30","--limit","5");
      await run(cmd,"audit","--repo-root",dir,"--json");
    }
    await run("maintenance", "--repair-access-log");
    await run("maintenance", "--repair-access-log", "--apply");
    expect((await runCli(["doctor"], dir)).exitCode).toBe(1);
    expect((await runCli(["doctor", "--rebuild", "L99"], dir)).exitCode).toBe(1);
    for (const args of [["reason","verdict","missing","invalid"],["reason","verdict","missing","confirmed"],["reason","run","missing","--seed-kind","invalid"]]) {
      expect((await runCli(args,dir)).exitCode).toBeGreaterThan(0);
    }
  } finally { db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("hook entry redacts JSON and raw input before it reaches SQLite", async () => {
  const { spyOn } = await import("bun:test");
  const dir = mkdtempSync(join(tmpdir(),"compost-hook-cli-"));
  let body = JSON.stringify({content:"API_KEY=syntheticSecret12345"});
  const input = spyOn(Bun.stdin,"text").mockImplementation(async()=>body);
  try {
    expect((await runCli(["hook","session-start"],dir)).exitCode).toBe(0);
    body = "PASSWORD=anotherSynthetic123";
    expect((await runCli(["hook","post-tool"],dir)).exitCode).toBe(0);
    body = "";
    expect((await runCli(["hook","stop"],dir)).exitCode).toBe(0);
    const db = new Database(join(dir,"ledger.db"));
    const rows = db.query("SELECT payload FROM observe_outbox").all();
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("syntheticSecret");
    expect(JSON.stringify(rows)).not.toContain("anotherSynthetic");
    db.close();
  } finally { input.mockRestore(); rmSync(dir,{recursive:true,force:true}); }
});

test("doctor validates embedding rebuild and hooks; historical reasoning controls preserve verdicts", async () => {
  const { spyOn } = await import("bun:test");
  const { OllamaEmbeddingService } = await import("../../compost-core/src/embedding/ollama");
  const { OllamaLLMService } = await import("../../compost-core/src/llm/ollama");
  const { ensureEngramSource, ingestEngramEntry } = await import("../../compost-engram-adapter/src/ingest-adapter");
  const dir = mkdtempSync(join(tmpdir(),"compost-rebuild-cli-"));
  const embed = spyOn(OllamaEmbeddingService.prototype,"embed").mockImplementation(async (texts)=>texts.map(()=>new Float32Array(768).fill(0.1)));
  const llm = spyOn(OllamaLLMService.prototype,"generate").mockResolvedValue(JSON.stringify({chain:"Evidence connects fixture facts",confidence:0.7}));
  const run = async (...args:string[]) => { const r=await runCli(args,dir);expect(r.exitCode,r.stderr).toBe(0);return r.stdout; };
  try {
    expect(JSON.parse(await run("doctor","--rebuild","L1")).rebuilt).toBe(0);
    const db=new Database(join(dir,"ledger.db"));upsertPolicies(db);ensureEngramSource(db);
    await ingestEngramEntry(db,{memory_id:"rebuild",kind:"fact",content:"recovery evidence workflow",project:"audit",scope:"project",created_at:new Date().toISOString(),updated_at:new Date().toISOString(),tags:[],origin:"human"});
    const fact=db.query("SELECT fact_id FROM facts").get() as {fact_id:string};
    db.run("INSERT INTO facts(fact_id,subject,predicate,object,observe_id) SELECT 'second-rebuild-fact','recovery','has','evidence',observe_id FROM facts LIMIT 1");
    expect(JSON.parse(await run("doctor","--rebuild","L1")).rebuilt).toBe(1);
    expect(db.query("SELECT count(*) n FROM chunks WHERE embedded_at IS NULL").get()).toEqual({n:0});
    await run("reason","run",fact.fact_id,"--no-llm","--json");
    const chain=JSON.parse(await run("reason","run",fact.fact_id,"--json"));
    expect(chain.chain_id).toBeDefined();
    await run("ask","recovery evidence","--no-track-gap","--budget","3");
    await run("reason","list");await run("reason","list","--json");await run("reason","show",fact.fact_id);await run("reason","show",fact.fact_id,"--json");
    await run("reason","verdict",chain.chain_id.slice(0,8),"confirmed","--note","verified fixture");
    await run("reason","verdict",chain.chain_id,"refined","--json");
    await run("reason","stats");
    expect(JSON.parse(await run("reason","stats","--json")).refined).toBe(1);
    db.close();
    const measurement=await runCli(["doctor","--measure-hook"],dir);
    const timing=JSON.parse(measurement.stdout);expect(timing.n).toBe(100);expect(timing.p95).toBeGreaterThan(0);
    expect([0,1]).toContain(measurement.exitCode);
  } finally {embed.mockRestore();llm.mockRestore();rmSync(dir,{recursive:true,force:true});}
},30_000);

test("drain adapter filter leaves other producers queued",async()=>{
  const {appendToOutbox}=await import("../../compost-core/src/ledger/outbox");
  const dir=mkdtempSync(join(tmpdir(),"compost-drain-filter-"));const db=new Database(join(dir,"ledger.db"));applyMigrations(db);upsertPolicies(db);
  try {
    for(const adapter of ["first","second"]) appendToOutbox(db,{adapter,source_id:adapter,source_uri:`test://${adapter}`,source_kind:"host-adapter",trust_tier:"first_party",transform_policy:"tp-2026-04",idempotency_key:adapter,payload:JSON.stringify({content:"drain fixture"})});
    const r=await runCli(["drain","--adapter","second"],dir);expect(r.exitCode).toBe(0);expect(JSON.parse(r.stdout).drained).toBe(1);
    expect(db.query("SELECT adapter FROM observe_outbox WHERE drained_at IS NULL").all()).toEqual([{adapter:"first"}]);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
