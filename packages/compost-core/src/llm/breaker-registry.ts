import type { LLMService } from "./types";
import { CircuitBreakerLLM, type CircuitBreakerOpts } from "./circuit-breaker";

/**
 * Per-site-key circuit breaker registry — locked in debate 007 Lock 4.
 *
 * The four call-site keys below mirror the five LLM sites in
 * `docs/ARCHITECTURE.md`. Python's `llm_facts.py` is out of scope for the
 * TS wrapper (handled by its own retry loop).
 *
 * Why per-site-key (not global, not per-call):
 *  - Global: a failure in `ask.expand` (expansion prompts, 10s timeout) would
 *    open the breaker for `wiki.synthesis` (long synthesis, 60s timeout),
 *    which may still succeed. Too coarse.
 *  - Per-call: every `.generate()` has its own state -> failures never
 *    aggregate, breaker never opens. Too fine.
 *  - Per-site-key: one breaker per logical call site, shared by that site's
 *    concurrent invocations. Matches the fallback-per-site contract.
 */
export type LLMCallSite =
  | "ask.expand"
  | "ask.answer"
  | "wiki.synthesis";
// Debate 010 Fix 5: removed "mcp.ask.factory" -- it was declared in debate
// 007 Lock 4 but no caller ever materialized. mcp-server.ts passes the
// registry directly into `ask()`, which dispatches to ask.expand / ask.answer
// internally. Add the site back only when a real MCP-level LLM call exists.

/**
 * Returns a singleton `CircuitBreakerLLM` for the given site. Test code
 * should build its own registry via `new BreakerRegistry(...)` rather than
 * using the module-level default to avoid state leak between test files.
 */
export class BreakerRegistry {
  private readonly breakers = new Map<LLMCallSite, CircuitBreakerLLM>();

  constructor(
    private readonly inner: LLMService,
    private readonly opts: CircuitBreakerOpts = {}
  ) {}

  get(site: LLMCallSite): CircuitBreakerLLM {
    let b = this.breakers.get(site);
    if (!b) {
      b = new CircuitBreakerLLM(this.inner, site, this.opts);
      this.breakers.set(site, b);
    }
    return b;
  }
}
