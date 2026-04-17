# r001_sonnet — 真实用户体验视角

**角色**: 同时装了 Compost + Engram 的真实用户 (Sonnet)

---

## 6 判决点立场

### 1. "独立自进化大脑"过度包装?

**立场: 是的, 严重过度包装.**

Compost 的实际行为: 被动 ingest (shim 拦截) + 定时 reflect (cron/LLM 摘要). 没有任何机制让它在没有 agent 客户端触发的情况下主动学习. 用户装好 Compost 之后, 如果不开着 Claude Code 跑 session, Compost 什么都不会学到.

"自进化大脑"这个叙事会在第一次用户打开项目却发现 Compost DB 是空的时创造失望感. 正确叙事: "会随你工作积累的项目记忆索引".

**风险**: 叙事差距导致首次体验差 -> 卸载.

---

### 2. 两者协同边际价值多大?

**立场: 场景 C 增量极小, 不支撑维护成本.**

- 只装 Compost (场景 A): 解决的 pain 是"LLM 每次 session 重新理解项目上下文". 真实价值: 每次 session 节省 2-5 分钟 recap 时间.
- 只装 Engram (场景 B): 解决的 pain 是"跨项目个人偏好/约束丢失". 真实价值: 不用每个项目重新解释"我不喜欢 default exports".
- 两者都装 + 桥接 (场景 C): 唯一新增的: Engram recall 能混入 Compost 摘要 (compiled origin). 用户实际感知: "常见问题查找快 0.3 秒". 这不是 killer feature.

**关键数字**: compiled origin 通道 ~120 LoC + TTL/GC + 独立 MCP tool. 用户感知的增量 < 维护成本.

---

### 3. "不让一边离不开另一边" 是真对称吗?

**立场: 天然非对称, 但没有问题.**

Compost 是项目级记忆, Engram 是个人级记忆. Engram 消费 Compost 摘要有合理场景 (跨项目 pattern 归纳), 反向 (Compost 依赖 Engram) 没有. 这不是矛盾, 这是正确的架构. 强行对称是 YAGNI.

**风险**: 如果叙事说"对等互操作", 实际是单向, 会有误导.

---

### 4. "独立自进化大脑"叙事会让用户失望吗?

**立场: 会, 且具体失望点在第 3 周.**

第 1 周: 用户觉得很酷, 装上了. 第 3 周: 用户问"为什么它没有学到我上周说的那个约束?". 答案是: 那个约束在 Engram 里, 不在 Compost 里, 两者没有桥接 (默认关闭). 用户会觉得割裂.

这个失望不是来自功能不足, 而是叙事给了错误预期. Compost 是项目文档的 AI 可消费形式, 不是 AI 自主代理.

---

### 5. compiled origin 默认关闭, 97% 用户无感, 值得保留吗?

**立场: 不值得作为核心维护, 但可以作为 experiment flag 存活.**

3% power user 会 opt-in 的估算可能乐观. 实际测试: 有多少用户知道 `compost config set engram.bridge=true` 这个命令存在? 文档路径有多深? 如果这个功能在文档第 3 层, 实际激活率可能 <0.5%.

~120 LoC 本身不多, 但 TTL/GC 逻辑 + MCP tool 注册 + 测试覆盖加起来是持续维护负担. 如果 power user 反馈不活跃, 这条路径会成为 dead code with active maintenance cost.

**建议**: 保留 compiled origin enum 值 (0 LoC 代价), 砍掉 TTL/GC 实现和独立 MCP tool, 等有 3+ 用户主动要求再实现.

---

### 6. v2 记忆要不要立刻 supersede?

**立场: 不改, 等 Session 3.**

纪律优于即时更新. v2 记忆里"桥接是 killer feature"的叙事虽然错了, 但现在改意味着在 debate 未收敛时写入强主张. 等 4 方 r001 都出来, r002 或 Session 3 再做 consolidated supersede.

---

## 投票

**投 A** (维持现状 + 叙事修正 + 记忆暂缓), 但附加条件:

1. 叙事立刻修正: "自进化大脑" -> "随项目积累的 AI 可消费记忆"
2. compiled origin 的 TTL/GC + MCP tool 降优先级到 P2, 不在 Phase 4 交付
3. 非对称依赖 (Engram 消费 Compost) 明确文档化, 不叫"互操作"

**记忆处理建议**: Session 3 后更新. 现在的分歧点还在 r001, 过早固化会锁死讨论.
