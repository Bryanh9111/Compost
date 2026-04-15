# Round 2 — 🐙 Opus Cross-Critique

## 1. Cargo Cult 点名

### CC-1: Gemini R1 Item 1 — "Requirement Executor" 自动执行信号
**参赛者**: Gemini
**Item**: "Daemon 根据信号优先级动态调整任务权重并执行"
**为什么是 cargo cult**: Gemini 照搬了 Myco 的 `hunger(execute=true)` 自动 action, 这正是 Myco 自己标记为**身份锚点第 3 条**的 agent-first 假设. Compost 是 **user-driven** (人对话 → hook 捕获), 不存在一个"自我驱动的 agent"调 hunger. 把 daemon 做成 auto-action executor 会引入: (a) 无审计的 write path, (b) LLM 幻觉信号污染数据层, (c) 人失去控制.
**正确替代**: Signal → **Surface** (写入 health_signals 表, `compost triage` 查看), **不做 auto-action**. 用户或 agent 手动执行.

### CC-2: Gemini R1 Item 3 — 29 维 immune lint
**参赛者**: Gemini
**Item**: "扩展 compost doctor 到 29 维"
**为什么是 cargo cult**: Sonnet R1 §R1 已精准指出: Myco 的 lint 体系检查 markdown/YAML 文件系统, Compost 的 canon 是 SQLite schema + TS 类型. 叠 29 维 YAML lint 在强类型系统上 = 两套真相源. Gemini 没读 Compost 的 TS 类型系统就建议, 典型不读原项目的 cargo cult.
**正确替代**: 保留最多 5 个高价值健康信号 (orphan rate / stale wiki / stuck outbox / tombstone velocity / contradiction backlog), 都是 SQL view.

### CC-3: Gemini R1 Item 8 — evolve.py 直接集成 (L 成本)
**参赛者**: Gemini
**Item**: "对 tp-YYYY-MM 策略变异 + reflect 验证反馈优胜劣汰"
**为什么是 cargo cult**: Myco 的 "evolve.py" 本质是 mutation + gate + scoring 的 Python 脚本, 操作对象是 markdown 文件. Compost 已有 talking_profile / ranking_profile 表 + version 字段, ranking_audit_log 记录性能 — 这就是进化引擎, 只是没起这个哲学名字. Gemini 要求再加 L 成本的 "evolve" 层, 是把已有功能 rebrand.
**正确替代**: 在现有 profile 表加 `mutated_from` 外键和 `performance_score` 字段, 定期 crontab 对比选优. S 成本, 不开新模块.

### CC-4: Gemini 全文违反硬约束
**参赛者**: Gemini
**Item**: 全篇用 "基质 / 代谢 / 免疫 / 菌丝体" 等 Myco 术语
**为什么是 cargo cult**: 明确硬约束禁用. Gemini 无视. 这不是品味问题 — 如果合并 Gemini 建议的接口命名会污染 Compost API.
**正确替代**: Gemini 所有建议必须先做术语映射 (substrate→system, metabolism→reflect cycle, immune→lint, mycelium→fact graph) 再评估.

### CC-5: Opus (自我) R1 #6 — Cross-Project Distillation
**参赛者**: Opus
**Item**: 我把它标 P0, 理由是"个人大脑最值钱的是跨领域迁移"
**为什么是 cargo cult**: Sonnet R1 §R3 精准反驳: Compost 单 namespace, 无 project 表, 实现 cross-project 需要 multi-host 基础设施. 我当时把"g4-candidate tag"当 S 成本, 实际是 L 成本 (需要 project 边界 + sync 机制). 我抄了 Myco 的 tag 皮, 没看底层基础设施.
**正确替代**: 降为 P2 观望. 或最简化: 在 fact 表加 `shareable BOOLEAN + export_label TEXT`, 手动 `compost export --shareable` 导出 markdown bundle, 人工迁移. 跨项目同步留给 Engram (本来就是全局层).

---

## 2. 真 Insight 背书

### BK-1: Sonnet #2 — Forage Queue (SQLite crawl_queue)
**原作者**: Sonnet
**Insight**: 我 R1 把 forage 完全 reject. Sonnet 的修正版 (SQLite `crawl_queue(url, source_type, why, status)` + `why` 强制字段) 把 Phase 4 的 "curiosity agent / autonomous crawl" 从**内存状态**升级为**持久化队列**. 这是真价值: daemon 重启不丢 crawl intent, gap tracker 驱动的"去学什么"有落地存储.
**我愿意撤回**: Opus R1 R5 "forage 全 reject". 改为 **accept (SQLite + 手动 trigger)**, 反对的是 autonomous crawl + YAML manifest, 不是 queue 本身.

### BK-2: Sonnet #4 — 压缩三判据直接实现到 reflect()
**原作者**: Sonnet
**Insight**: 我 R1 把"compression doctrine"标 modify 但没给落地点, Sonnet 直接说: "在 `reflect.ts` 加 `access_log` 频率 + 同主语排他性合并 heuristic, 纯 SQL, S 成本, 不引入 LLM 写路径". 精准到代码层.
**背书**: 此项是所有 R1 里最值得 P0 的. 我同意 Sonnet 的实现路径.

### BK-3: Gemini Item 9 — Inlet Provenance Contract
**原作者**: Gemini (是的, 即使 Gemini 有问题)
**Insight**: 在 observations 表加 `origin_hash + method_fingerprint`. 这点 Opus 和 Sonnet 都没提. Compost 现在 source 字段松散 (tool_name + payload hash), 没强制 provenance. 对**第二大脑**, 溯源是信任基石 — 没有它就不能做 contradiction arbitration 的公平仲裁.
**我愿意新增**: 到 P1 清单. 成本 S (加字段 + hook 计算).

---

## 3. 最终投票 (Opus)

| 代号/名称 | Tier | 理由 |
|---|---|---|
| A 🩺 triage view (改名) | **P0** | 第二大脑核心缺失: 被动→主动 |
| C confidence ladder + decision_audit | **P0** | 矛盾仲裁无 audit trail 是 bug |
| D graph health (SQL view) | **P0** | Phase 4 fact-graph 必配 |
| E 压缩三判据 → reflect() | **P0** | Sonnet 路径精确, S 成本 |
| 自承错误事件捕获 | **P0** | 第二大脑最宝贵信号 |
| G-partial (A 库存 + C 退化) | **P1** | D 层是 Myco open problem, 别学 |
| 死知识 tombstone reason | **P1** | 防止 churn, 已有结构扩字段 |
| Session FTS5 | **P1** | Phase 4 episodic 的一部分 |
| 压缩压力 metric (pressure) | **P1** | triage 的信号输入 |
| open_problems 表 | **P1** | 诚实盲点登记, S 成本 |
| Inlet provenance (Gemini 9) | **P1** | 第二大脑信任基石 |
| forage queue (SQLite) | **P1** | Sonnet 修正版 accept |
| `compost.config.yaml` SSoT | **P2** | 有 profile 版本够用, 锦上添花 |
| Semantic Cohort | **P2** | 效果好但实现巨, 先不动 |
| Milestone retrospective | **P2** | Phase 5 再说 |
| B 29 维 lint | **Reject** | 双真相源, 重复 TS 类型 |
| F Cross-Project Distillation | **Reject** | 需 multi-host 基础设施 |
| H auto-execute action | **Reject** | Agent-first 假设错位 + 无 audit |
| I forage autonomous crawl | **Reject** | 爬取污染 first-party |
| evolve.py L 成本 | **Reject** | 现有 profile 版本化已覆盖 |
| Craft Protocol 整套 ceremony | **Reject** | 仪式成本 > 收益 |

**P0 = 5, P1 = 7, P2 = 3, Reject = 6**. 通过量化约束.

---

## 4. 自我修正

**撤回**: Opus R1 把 "Cross-Project Distillation" 标 P0 + 列入 Top 10 #6 是错的. Sonnet R1 §R3 的反驳成立 — Compost 无 project 表, 实现需要 Phase 5+ 基础设施. 这项是 Myco 的 g4-candidate tag 机制的皮, 我没评估底层骨架. 降为 **Reject** 或**简化为 `shareable` 字段 + 手动 export** (P2 观望).

**同时撤回**: Opus R1 #10 `_canon.yaml` SSoT. 我把它算 S 成本, 但 Compost 的 profile 表已经做了同样的事 (ranking_profile 有 version + weights). 再加 YAML 就是 Gemini 错误的轻量版. 降为 **P2 观望** 或**并入 profile 表的扩展**.
