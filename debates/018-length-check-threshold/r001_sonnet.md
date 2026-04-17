# Debate 018 — Sonnet 立场 (r001)

**Date**: 2026-04-16
**Perspective**: 用户心智 / AI agent 工作流

---

## 选项排序 (1 最优 → 4 最差)

| 排名 | 选项 | 一句话理由 |
|------|------|-----------|
| 1 | **A** (放宽到 4000) | 数据已证明真实用例存在，2000 是无依据的拍脑袋值，直接修正比绕路便宜 |
| 2 | **C** (2000 + archive 表) | 分离策略在语义上正确，但引入双查询路径让 recall 复杂度翻倍，AI agent 容易漏读 |
| 3 | **D** (临时 4000 + TODO) | 实质同 A，但挂着一个永远不会执行的 TODO；不如直接选 A 干净 |
| 4 | **B** (保持 2000，7 条被拒) | migration 阻塞 + 信息损失双杀，对用户和 agent 都是最差结果 |

---

## Q1: 2000 字阈值从哪来？

**立场：无硬依据，阈值可议。**

debate 016 synthesis 找不到推导过程。2000 很可能是从"Twitter 字符限制"或"便条直觉"借来的整数。现实数据（7/475 = 1.5% 超标，全是高价值记忆）说明这个值切的位置错了。正确做法是从真实 p99 推算阈值，而不是反过来用阈值切数据。

---

## Q2: session handoff / debate outcome 是 anti-pattern 吗？

**立场：不是 anti-pattern，是被设计低估的合法用例。**

"便条夹"叙事来自 debate 016，但那次 debate 的核心改动是 SLO + 来源分离，不是字数限制。把叙事从"便条"扩展到"handoff envelope"并不违反设计原则：

- 整块 session handoff 必须原子读取（拆开就断 context，agent 恢复不了状态）
- debate outcome 包含论证链，删段就失去可追溯性
- spec dump 是临时降落区，最终会被 forget() 掉，用完即弃

强迫用户把这三类内容拆成 5-10 条小记忆，实际上只是把认知负担从 Engram 转移给用户。用户不会做这件事——他们会退而写 CLAUDE.md 或外部文件，Engram 失去这批最有价值的入口。

---

## Q3: 长度 CHECK 应该 kind-specific 吗？

**立场：是，但要控制复杂度。**

每个 kind 的天然长度上限差距显著：

| kind | 建议上限 | 理由 |
|------|---------|------|
| `fact` | 500 | 一个事实就是一句话，长了说明写法有问题 |
| `guardrail` | 800 | 防护规则 + 一句 evidence 链接 |
| `constraint` | 800 | 同上 |
| `decision` | 3000 | 需要 context + 选项对比 + 理由 |
| `procedure` | 4000 | 步骤列表可以很长 |

**反驳 "AI agent 判断 kind 太复杂"**：agent 在 remember() 时已经选了 kind，CHECK 只是数据库级别的验证，agent 不需要额外判断。复杂的是实现层（migration 写 5 个不同的 CHECK），而不是调用层。

---

## 最终推荐

**方案 E：kind-specific 上限 + 渐进式**

```sql
CHECK(
  (kind = 'fact'      AND length(content) <= 500)  OR
  (kind = 'guardrail' AND length(content) <= 800)  OR
  (kind = 'constraint'AND length(content) <= 800)  OR
  (kind = 'decision'  AND length(content) <= 3000) OR
  (kind = 'procedure' AND length(content) <= 4000)
)
```

现有 7 条超标记忆：
- 3 条 fact/procedure（2062, 2153, 3468）→ 检查是否超 4000，基本都过
- 4 条 decision（2129, 2163, 2375, 3466）→ 检查是否超 3000

如果还有超标的，归入 archive（不是 truncate），主表存摘要 + archive_ref 外键。

这比 C 方案便宜：只有真正超 kind 上限的才进 archive，不是全量 2000 以上。

---

## 独家警告

**"remember() 返回 error 时 agent 怎么处理" — 这是最被低估的风险。**

当前 Engram 的 remember() 如果因 CHECK 失败返回 error，AI agent（包括 Claude Code）的默认处理路径是：
1. 报错 → 重试（截断内容）→ 信息丢失
2. 或者放弃写入 → 记忆完全消失

没有任何 agent 会在 remember() 失败时自动拆分内容为多条记忆，这个逻辑对 agent 来说太复杂且无法预测拆分点。

**硬限制 CHECK 在 agent 工作流里等于静默丢弃，不等于"请写短一点"。**

kind-specific 上限（E 方案）比一刀切 2000 好，但任何硬 CHECK 都必须配合 server 层的清晰 error message（说明超了多少、建议哪个 kind 或 archive 选项），否则 agent 无法做出有意义的恢复。
