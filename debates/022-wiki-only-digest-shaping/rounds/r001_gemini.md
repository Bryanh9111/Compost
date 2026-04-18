YOLO mode is enabled. All tool calls will be automatically approved.
Loaded cached credentials.
YOLO mode is enabled. All tool calls will be automatically approved.
**Stance: Option (d) — The Meta-Fact Anchor.**

**Reasoning:**
Option (b) is an architectural "poison pill." Synthetic IDs like `sha1("wiki:"+path)` bypass the R3 write-boundary guard, transforming a safety mechanism into a facade. If Engram later attempts to invalidate, trace, or refresh this insight, the synthetic ID will cause silent failures or referential 404s. `compost_fact_ids` must strictly represent a "row in the facts table" to maintain the integrity of the bidirectional link.

Option (c) is unacceptable for live dogfooding. If the project author cannot push a digest because their facts are too "stable" (sitting at 0.80), we lose the ability to verify the S6-2 MCP transport under real-world conditions.

Option (a) is a temporary fix that conflates KB arbitration (is this fact true?) with digest utility (is this summary useful?). 

**The Solution (d):**
The CLI should treat the **Digest Event** itself as a high-confidence `meta` fact. 
1. When `compost digest` identifies a meaningful change (like 11 wiki rebuilds), it should **insert a new row** into the `facts` table: `{content: "Digest Summary: [Date Range]", confidence: 1.0, scope: "meta", tag: "digest"}`.
2. Use this **real, persisted `fact_id`** to satisfy the `EngramWriter` Zod `min(1)` constraint.

**Benefits:**
- **Failure Attribution:** Minimizes complexity because the `source_trace` is real. If the push fails or the insight is questioned, the developer can query the `facts` table and see the exact audit record for that digest generation.
- **Contract Adherence:** Respects the Engram contract without fake guards.
- **Dogfooding:** Unlocks the push path immediately for wiki-active users.

A digest is a "fact" about the current state of the knowledge base. Logging it as such turns an engineering hurdle into a useful audit trail. Use (a) as a CLI-level override only if (d) cannot be implemented in the current turn, but (d) is the only path that preserves the Phase 6 architectural vision.
