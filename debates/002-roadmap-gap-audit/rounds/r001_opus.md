# R1 — 🐙 Opus (架构主持 / 跨 Phase 一致性视角)

身份: Roadmap 长期一致性的守门员. 关注未在 Phase 4-6 各 P0/P1 列表中显形, 但一旦发生会让前面所有工作打折扣的**架构层缺陷**.

---

## 1. Top 5 盲点 (按严重度降序)

### 盲点 1: P0-3 graph_health 的 fact_links 依赖未排序 (P4 P0)
- **描述**: migration 0010 创建了 `v_graph_health` view, 但 view body 注释明说 "stub. 实际指标 NULL until fact_links table exists". `cognitive/graph-health.ts` 三个函数全部 return null 或 throw. 而 fact_links 表是 Phase 4 carried 列表里 "Fact-to-fact links graph + recursive CTE traversal" — 没有 P0 标签.
- **触发条件**: 实现 P0 顺序时, 想做 graph_health 但发现 fact_links 不存在. 写 fact_links 是中等工程 (设计 edge schema + 双向 vs 单向 + 边类型枚举 + 递归 CTE 测试 + 反向索引), 至少 2-3 天.
- **影响**: P0-3 实际是 L 成本伪装成 S, 拖垮 4 周 Phase 4 时间表. 现在 ROADMAP 的 17 项规模可能是 22+ 项.
- **最小修复**: 把 "fact-to-fact links graph" 从 carried 提到 **P0-0 (prerequisite)**. ROADMAP 里加显式依赖箭头.
- **应放入**: P4 P0 (最优先)

### 盲点 2: 备份 + 灾难恢复完全缺失 (跨 Phase)
- **描述**: ledger.db 在 `~/.compost/`, WAL 模式. 没有自动备份, 没有 checkpoint 计划, 没有"如何从 corrupt db 恢复" runbook. 用户机器的 SSD 故障 / Time Machine 崩溃 / 不小心 `rm` / 被勒索软件加密 → 第二大脑全没.
- **触发条件**: 用户在 Phase 4 完成后开始日常依赖, 6 个月后 SSD failed. ledger.db 损坏. Compost 第二大脑全部丢失. 用户对工具失去信任.
- **影响**: 所有 Phase 0-6 投入的工程价值在数据丢失瞬间归零. 比任何技术债都严重. 这是 second brain 的**信任契约**.
- **最小修复**: P4 P0 加 1 项: **每 24h 自动 SQLite `.backup` 到 `~/.compost/backups/YYYY-MM-DD.db`, 保留 30 份**. 加 `compost restore <date>` CLI. 都是 SQLite 一行命令.
- **应放入**: P4 P0 (与 triage / audit 同等优先级)

### 盲点 3: 性能基线缺失 — 不知道在多大规模会崩 (P4 P1, blocking go-live)
- **描述**: 当前 156 tests 都是空 db 或 ~10 facts 的 fixture. 没人知道 reflect() 在 10K facts 要多久, 100K 是否会卡, multi-query expansion 在 1M facts 是否会超时. P0-3 graph_health 的 recursive CTE 在大图上是性能炸弹.
- **触发条件**: 用户连续用 3 个月, ledger.db 涨到 50K+ facts. 某天 reflect 跑了 5 分钟, daemon 看似挂住, 用户 kill 了进程, WAL 损坏.
- **影响**: 第二大脑在用户最依赖的时刻变慢/崩溃. 比"启动慢"更可怕的是"用着用着越来越慢"的退化感.
- **最小修复**: 加 `bench/` 目录, 至少 3 个 benchmark: `reflect-1k.bench.ts`, `reflect-10k.bench.ts`, `reflect-100k.bench.ts`. 每个 PR 跑一次, 写入 `benchmarks.json`. 回归 > 50% 报警.
- **应放入**: P4 P1 (Phase 4 收尾前必须有 baseline)

### 盲点 4: 隐私 / PII 数据捕获完全无防护 (P4 P0, security blocker)
- **描述**: hook-shim 捕获 Claude Code 的所有 tool use payload. 用户在 chat 里 paste API key / 信用卡号 / 密码 → 全部进 observations 表 → embedding → 永久存储. Compost 反而成为信用卡泄漏中心.
- **触发条件**: 任何一次用户在 Claude 里粘贴 .env 文件 / 调试时复制 token / 论坛贴密码请求 debug. 一次就够.
- **影响**: (a) 法律风险 (GDPR / CCPA 的 PII 长期保留); (b) 安全风险 (ledger.db 被读 = 信用卡库被读); (c) 翻 public 开源时, 维护者不能要求用户 share ledger 进 issue.
- **最小修复**: hook-shim 加 redact pass (regex: 信用卡 / SSH key / API key 常见 prefix sk-/ghp_/ya29 / .env 行 / "password:" 行) → 命中即跳过写入或写入 `[REDACTED]` 占位. 100 行代码.
- **应放入**: P4 P0 (公开发布前不可缺)

### 盲点 5: LLM 提取器单点依赖 (Ollama gemma3:4b) (P4 P1)
- **描述**: tp-2026-04-03 talking_profile 强绑定 Ollama gemma3:4b. Ollama 守护进程未启动 → 提取队列堆积 → triage 报 stuck_outbox 但无 fallback. gemma3 模型未来被 Ollama 删除 / 被禁用 → fact 提取整条链路死.
- **触发条件**: (a) 用户重启系统忘开 ollama; (b) ollama upgrade 删除 gemma3:4b; (c) 用户网速不够下载 4GB 模型; (d) 想换公司 (Anthropic API / OpenAI / Gemini) 但 talking_profile 没有 provider 抽象.
- **影响**: 提取静默失败, fact 不入库, 用户感觉"系统什么都没记". triage 会报警但用户不知道怎么修.
- **最小修复**: (a) talking_profile 加 `provider TEXT NOT NULL DEFAULT 'ollama'` + `endpoint TEXT`; (b) 至少抽象一个 `IExtractorClient` 接口, ollama-impl 是默认; (c) 加一个 `compost doctor --check-llm` 检查 ollama 联通和模型存在. P0-1 triage 可以直接消费这个信号.
- **应放入**: P4 P1 (与 P1 列表的其他项同等)

---

## 2. P0 顺序与依赖图

```
Pre-P0 (必须先做):
  0. Backup script (盲点 2): 没有它后面所有工作的数据都在裸奔
  1. fact_links 表 + 双向 link API (盲点 1, 原 carried 提到 P0-0): 解锁 P0-3
  2. PII redact pass in hook-shim (盲点 4): 公开前不可缺

然后 P0 主体 (按依赖):
  3. P0-1 triage  → 依赖: 0009 (contradiction), 0008 (ranking), 0007 (FTS5)
                    输出: health_signals 表, signals → audit
  4. P0-2 decision_audit → 依赖: 触发点是 reflect.ts + wiki.ts 现有写路径
                            P0-1 的 resolveSignal 也可以走 audit
  5. P0-4 archive_reason + tombstone meta → 依赖: facts 表 (已有)
                                              触发点: reflect.ts step 2
  6. P0-5 correction_events → 依赖: hook-shim (已有)
                              processed_at 字段被 reflect 消费
  7. P0-3 graph_health → 依赖: fact_links 表 (Pre-P0 #1)
                          触发点: triage 消费 orphan_delta 信号

最后 P1 启动:
  8. open_problems (consolidates 旧 curiosity + gap)
  9. compression_pressure metric
 ...
```

**关键裁决**: fact_links 必须在 P0-3 之前 land. ROADMAP 里 carried 列表的"fact-to-fact links graph + recursive CTE"应明确标记 **prerequisite for P0-3**, 否则 P0-3 是 stub.

---

## 3. 应该砍掉/降级的

### Cut 1: Phase 5 整体降级到 "evaluate later" (从 next phase → backlog)
- **当前 tier**: Phase 5 (next planned)
- **建议 tier**: Backlog, no schedule
- **理由**: Multi-host sync 是 enterprise 需求. 用户是单人单机. ROADMAP 现在写"Multi-host concurrency coordination" 暗示要做协议, 但没有任何用户反馈说需要. 这是给虚拟未来用户做的功能. 砍到 "等出现明确需求再启动".
- **替代**: 留一个 "compost export markdown" (P1 已有) 作为最简 portability. 想换机就 export → import. 不做协议.

### Cut 2: Phase 6 PDF/video/code-repos source types
- **当前 tier**: Phase 6
- **建议 tier**: 完全删除, 不进 ROADMAP
- **理由**: 个人大脑用户不会喂 Compost 视频. PDF 偶尔有用但 docling 集成是 L 工程. Code repos 已经在 GitHub, 不需要 Compost 备份. 这些是"看起来 second brain 应该做" 而不是用户真要.
- **替代**: 不替代. 用户真需要 PDF 时手动 `pdftotext file.pdf | compost add -`.

### Downgrade: P1 "four-layer self-model dashboard" → P2
- **当前 tier**: P4 P1
- **建议 tier**: P4 P2
- **理由**: synthesis_v2 已经 modify 为 "只 A 库存 + C 退化". 这两个本质是 SQL view 输出, P0-1 triage 就会显示库存 + orphan_delta. 单独的 dashboard 是 Myco 思维的残留. 真要做时一个 `compost stats` 即可, 不需要 P1 投入.

---

## 4. 应该新增的 (路线图完全没提)

### New 1: Backup/Restore (盲点 2 重述, 必须 P4 P0)
- 每 24h `db.backup()` 到 `~/.compost/backups/`, 保留 30 份
- `compost restore <date>` CLI
- `compost backup --now` 手动触发
- 100 行代码, 阻断数据丢失

### New 2: Performance Benchmark Harness (盲点 3, P4 P1)
- `bench/` 目录 + bun:test 兼容的 `*.bench.ts`
- 至少 3 规模: 1K / 10K / 100K facts
- 每 PR 自动跑, 回归 > 50% 报警
- 写入 `benchmarks.json` 跟踪趋势

### New 3: PII Redactor in hook-shim (盲点 4, P4 P0)
- `redact.ts` 模块 (regex-only, 不引入 LLM)
- 命中模式 (CC / SSH key / API token / .env line / "password:") → 写入 `[REDACTED:type]` 占位
- 单测 + 红队 fixture 库

### New 4: Migration Rollback Pattern (P4 P1)
- migrator.ts 加 `revertMigration(name)`
- 每个 0010+ migration 配一个 `*.down.sql` (可选, 但鼓励)
- 当前 10 migrations 可以不补 down (太多 ALTER TABLE), 但 0010+ 必须有
- 阻断"发布后才发现 bug 但回不去"

### New 5: LLM Provider Abstraction (盲点 5 子集, P4 P1)
- `IExtractorClient` 接口在 compost-core
- ollama-impl 是默认, 后续可加 anthropic-impl / openai-impl
- talking_profile 加 provider 列
- 解锁未来 LLM 替换不需要重写代码

---

## 5. 独特视角 (Opus 长期架构)

**12+ 月最大风险**: **Compost 长大成 "everything bucket" 然后死于过载**. 现在每个 Phase 都在加表加 view 加 P0. Phase 4 有 5 P0 + 4 carried + 6 P1. Phase 5/6 还会更多. 三年后 ledger.db 有 30 个表, 需要团队维护. 但 Compost 永远是单人副项目 — **没有团队**. 工程负担会反过来让用户停止 dogfood.

**反向锚点**: ROADMAP 应该有一个**"砍东西"机制** — 每个 Phase 收尾时强制评估"哪个表/view/CLI 命令上季度被使用 < 5 次? 删掉它". 目前 ROADMAP 只 add never delete. 这与 P0-4 的 archive_reason ("compost 知道 fact 应该排出") 是同构问题, 但作用在**代码本身** — 代码也是会 stale 的 fact, 也需要 tombstone.

具体: Phase 4 完后做一次 "feature retro", 删掉 0 用的 P1/P2 项. 这个 metafeature 比任何具体 P0 都长期重要.
