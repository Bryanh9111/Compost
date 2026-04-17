# r001_sonnet - Pragmatic Implementer (🟠)

**Role**: I build this. I debug it at 2am.

---

## 1. 边界: 内容类型 vs 触发时机

**立场: 触发时机 (方案 B 正确)**

内容类型边界在纸上好看，代码里是噩梦。你得在写入路径上做分类判断——"这条记忆是 fact 还是 procedure"——这本身就需要 LLM 或者人工标注。触发时机边界是纯机械的: 调用栈深度 + 预算计时器，`packages/compost-core/src/llm/circuit-breaker.ts` 里已经有类似模式。直接复用，不用新语义。

风险: p95<50ms 在 SQLite FTS5 冷页时很脆。需要 WAL + `PRAGMA cache_size=-8000` 明确设置，否则首查 p99 轻松 200ms。

---

## 2. v3.4: 同步 fallback vs 异步 compile 回写

**立场: 异步 compile 回写 (方案 B v3.5)，v3.4 只做 suggest_ingest**

同步 fallback 是把 Compost 的 p95=3-10s 注入到 Engram 的 p95<50ms 调用链里——这直接击穿延迟预算。我见过太多"加个同步降级"最后变成主路径。`packages/compost-core/src/ledger/outbox.ts` 已有 outbox 模式，v3.4 的 suggest_ingest 直接往这里写一条消息就够了，~50 LoC。

异步回写 (v3.5) 才是正路: Compost 答完之后往 Engram 写 origin=compiled，下次 Engram FTS5 直接命中，零 LLM。

---

## 3. origin=compiled 通道值得复活吗

**立场: 值得，但有具体条件**

当前 0 条 compiled 记忆，说明写入管道从未跑通或从未被触发。复活前需确认: Engram DB 的 `kind` 约束是否接受 compiled，以及 TTL/淘汰策略是否已定义。如果这两个都没有，v3.5 上线后会有 compiled 记忆无限积累、FTS5 索引膨胀的问题。预估: 新增 1 个淘汰策略 + 1 个 kind-guard = ~80 LoC + 5 新测试。

---

## 4. 双栈能避免 Engram 重建简化版 Compost 吗

**立场: 短期能，长期需要强约束**

当前 Engram v3.x 没有 `packages/compost-core/src/cognitive/` 下那套东西 (wiki rebuild、reflect、triage)。只要 v4-v7 被砍，且 suggest_ingest 接口是单向的，边界就守住了。

隐患: 当有人要给 Engram 加"解释为什么这么记"的功能时，L2 reasoning 会从后门溜进来。需要在 Engram repo 的 CONTRIBUTING 里硬写禁止规则，不是软约束。

---

## 5. Engram 有独立 LLM 的合法场景吗

**立场: 只有一个: Compost 守护进程宕机时的降级**

这是真实的运维场景。`packages/compost-daemon/src/main.ts` 的 daemon 如果崩了，Engram 目前直接裸奔。但实现方式不应该是 Engram 内嵌 LLM 调用，而是 Engram 检测到 Compost socket 超时后，降级为"只返回 FTS5 结果 + 标注[degraded]"。不需要 LLM。方案 C (竞争路线) 是重复造轮子，砍。

---

## 6. v3.3 kind-lint 该多严

**立场: 硬拒绝 unknown kind，warn 但不拒绝 misrouted kind**

unknown kind 写入 = 数据污染，必须在写入路径同步抛错。misrouted kind (比如把 guardrail 写成 fact) 是语义问题，同步拒绝会让 agent 卡死。记录 warn + metrics counter，事后审计。实现: `packages/compost-core/src/policies/registry.ts` 的模式可以参考，Engram 侧加一个 kindValidator，~30 LoC，3 个单元测试。

---

## 路线表

| 版本 | 内容 | 估算 LoC | 新测试 |
|------|------|----------|--------|
| v3.2 | 当前已发布，baseline | - | - |
| v3.3 | recall_miss 日志 + kind-lint (unknown=硬拒绝, misrouted=warn) | ~80 | 8 |
| v3.4 | Engram→Compost 单向 suggest_ingest (写 outbox, 不阻塞) | ~50 | 5 |
| v3.5 | Compost→Engram 异步回写 origin=compiled + TTL 淘汰策略 | ~130 | 12 |

**v4-v7 判决: 砍。** LLM compile / embedding / memory graph 全部交给 Compost L2-L3 处理。Engram 守住零 LLM + p95<50ms，这条线不能妥协。

---

*Builder note*: 最大的执行风险不是架构，是 suggest_ingest 接口被当成同步 fallback 误用。需要接口签名上就禁止 await，强制 fire-and-forget。
