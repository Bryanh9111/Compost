import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { applyMigrations } from "../../compost-core/src/schema/migrator";
import { upsertPolicies } from "../../compost-core/src/policies/registry";
import { BreakerRegistry } from "../../compost-core/src/llm/breaker-registry";
import { startMcpServer } from "../src/mcp-server";

type Reply = { content: { text: string }[]; isError?: boolean };
type Handler = { handler: (input: Record<string, unknown>, extra: Record<string, unknown>) => Promise<Reply> };
const inputs: Record<string, Record<string, unknown>> = {
  "compost.observe": { adapter: "test", source_id: "mcp-test", source_kind: "host-adapter", source_uri: "test://mcp", idempotency_key: "mcp-test", trust_tier: "first_party", transform_policy: "tp-2026-04", payload: JSON.stringify({ content: "contract fixture" }), contexts: ["audit"] },
  "compost.query": { q: "missing", budget: 3 },
  "compost.ask": { question: "missing evidence", budget: 3 },
  "compost.reflect": {},
  "compost.gaps.list": { status: "open", since: "2020-01-01", limit: 10 },
  "compost.gaps.resolve": { problem_id: "missing", observation_id: "missing", fact_id: "missing" },
  "compost.gaps.dismiss": { problem_id: "missing" },
  "compost.gaps.stats": {},
  "compost.curiosity": { status: "open", window_days: 30, min_jaccard: 0.3, max_clusters: 5 },
  "compost.curiosity.match_facts": { since_days: 30, min_overlap: 1, confidence_floor: 0.5, max_candidates_per_gap: 3, max_gaps: 5, only_with_candidates: true },
  "compost.digest": { since_days: 7, confidence_floor: 0.5, max_items: 10, include_insight_input: true },
  "compost.crawl.propose": { url: "https://example.test/mcp", rationale: "Fixture", tags: ["audit"], proposed_by: "user" },
  "compost.crawl.list": { status: "proposed", proposed_by: "user", limit: 10 },
  "compost.crawl.approve": { crawl_id: "missing" },
  "compost.crawl.reject": { crawl_id: "missing" },
  "compost.crawl.stats": {},
  "compost.reason": { seed: "missing", seed_kind: "fact", no_link_writeback: true },
  "compost.reason.list": { limit: 10 },
  "compost.reason.verdict": { chain_id: "missing", verdict: "confirmed", note: "fixture" },
  "compost.reason.stats": {},
  "compost.reason.scheduler.status": {},
};

test("all MCP tools return their contract on empty state and structured errors on storage failure", async () => {
  const db = new Database(":memory:"); applyMigrations(db); upsertPolicies(db);
  const llm = new BreakerRegistry({ model: "fixture", async generate() { throw new Error("offline fixture"); } });
  const handle = await startMcpServer(db, llm);
  const registry = (handle.server as unknown as { _registeredTools: Record<string, Handler> })._registeredTools;
  try {
    expect(Object.keys(registry).sort()).toEqual(Object.keys(inputs).sort());
    for (const [name, input] of Object.entries(inputs)) {
      const reply = await registry[name]!.handler(input, {});
      expect(reply.content.length).toBeGreaterThan(0);
      if (name === "compost.reason.verdict" || name === "compost.reason") expect(reply.isError).toBe(true);
      else expect(reply.isError, name).not.toBe(true);
      if (name !== "compost.observe" && !reply.isError) expect(() => JSON.parse(reply.content[0]!.text)).not.toThrow();
    }
    const item = JSON.parse((await registry["compost.crawl.propose"]!.handler(inputs["compost.crawl.propose"]!, {})).content[0]!.text);
    const approval = await registry["compost.crawl.approve"]!.handler({ crawl_id: item.crawl_id }, {});
    expect(JSON.parse(approval.content[0]!.text).approved).toBe(true);
    const rejection = await registry["compost.crawl.reject"]!.handler({ crawl_id: item.crawl_id }, {});
    expect(JSON.parse(rejection.content[0]!.text).rejected).toBe(false);
    db.close();
    for (const [name, input] of Object.entries(inputs)) {
      const reply = await registry[name]!.handler(input, {});
      expect(reply.isError, `${name} storage failure`).toBe(true);
      expect(reply.content[0]!.text.length).toBeGreaterThan(0);
    }
  } finally { await handle.stop(); db.close(); }
});
