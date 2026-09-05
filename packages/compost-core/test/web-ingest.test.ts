import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../src/schema/migrator";
import { upsertPolicies } from "../src/policies/registry";
import { ingestUrl } from "../src/pipeline/web-ingest";
import type { VectorStore } from "../src/storage/lancedb";

test("web ingest extracts and embeds local HTTP evidence, skips unchanged pages, records failures", async () => {
  const db = new Database(":memory:"); applyMigrations(db); upsertPolicies(db);
  let mode = "success";
  const server = Bun.serve({ port: 0, fetch(req) {
    if (mode === "error") return new Response("unavailable", { status: 503 });
    if (req.headers.get("If-None-Match") === '"fixture"') return new Response(null,{status:304});
    return new Response("# Recovery evidence\n\nCompost stores action history. Backups preserve the ledger.\n", { headers:{"content-type":"text/markdown",etag:'"fixture"',"last-modified":"Wed, 01 Jul 2026 00:00:00 GMT"} });
  }});
  let embedded = 0;
  const embeddings = { model: "test", dim: 3, async embed(texts: string[]) { return texts.map(() => new Float32Array([1,0,0])); } };
  const vectors = { async add(rows: unknown[]) { embedded += rows.length; } } as unknown as VectorStore;
  try {
    expect((await ingestUrl(db,server.url.href,"/tmp",{policyId:"missing"})).ok).toBe(false);
    const first = await ingestUrl(db,server.url.href,"/tmp",{embeddingService:embeddings,vectorStore:vectors});
    expect(first.ok,first.error).toBe(true); expect(first.chunks_count).toBeGreaterThan(0); expect(embedded).toBe(first.chunks_count);
    const second = await ingestUrl(db,server.url.href,"/tmp"); expect(second.skipped_304).toBe(true);
    mode = "error";
    expect((await ingestUrl(db,server.url.href,"/tmp")).status_code).toBe(503);
    expect((await ingestUrl(db,server.url.href,"/tmp")).ok).toBe(false);
    const state = db.query("SELECT consecutive_failures FROM web_fetch_state").get() as {consecutive_failures:number};
    expect(state.consecutive_failures).toBe(2);
    server.stop(true);
    expect((await ingestUrl(db,server.url.href,"/tmp")).error).toContain("fetch failed");
  } finally { server.stop(true); db.close(); }
},30_000);
