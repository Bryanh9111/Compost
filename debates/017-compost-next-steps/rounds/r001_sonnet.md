# r001_sonnet — Compost 下一步 (Sonnet, 实现可行性视角)

**立场: 做 B + bench 两项, 其余推后. 原因如下.**

---

## 6 判决点

### 1. 当前优先级基线: "稳+开源" vs "深+Phase 4 功能"
**立场: 稳+开源, 但只做最小开源集.**

318 tests pass, core 稳. 但凡开源前没做 PII redactor, 第一个贡献者 clone 下来一跑, 自己的 API token 就进了 KB. 那不是 bug, 是安全事故. 所以"稳"本身要求先堵这个洞. "深"功能在没有 bench 数据的情况下全加, 就是在黑暗里做优化. 先测量再动.

### 2. PII redactor 真的是开源门槛?
**立场: 是, 且是最硬的门槛. 比 LICENSE/docs/examples 都硬.**

LICENSE 一行就加. docs 可以 TODO. PII 泄漏一旦进 DB 就得 migration. `packages/compost-hook-shim/src/index.ts:108` 处 `JSON.stringify(envelope)` 直接把整个 envelope 存入 `observe_outbox.payload`. Claude Code hook 的 payload 包含 tool_input, 里面可以有任意字符串. 现在唯一防线是 "用户知道不要 compost add password". 这不够.

真实 LoC 估计 (不乐观版):
- regex blocklist + scrub() 函数: 60 LoC
- hook-shim 集成 (scrub before INSERT): 15 LoC  
- unit tests (CC/SSH/envvar/apikey/password, 边界, unicode bypass): 80 LoC
- CLI `compost doctor --check-pii` 检查 existing outbox: 40 LoC
- 文档 + CHANGELOG: 20 LoC
- **合计: ~215 LoC**, 不是"30-50 LoC".

### 3. Phase 4 P1 4 项内部排序
**立场: PII > bench > open_problems > origin_hash. bench 不应该排第三.**

没有 bench, P1 后三项改完你不知道有没有回归. `bench/reflect-1k/10k/100k.bench.ts` 是保险, 不是功能. 真实估计:
- bench harness: 120 LoC TypeScript + 3 fixture files (~2000 行 synthetic data) + CI 配置 30 LoC
- `open_problems` 表: migration SQL 40 LoC + CLI 子命令 80 LoC + tests 100 LoC = 220 LoC
- `origin_hash` + `method`: `packages/compost-core/src/schema/` 加一个 migration (0014_origin_hash.sql, ~30 LoC) + pipeline 写入路径改动 ~50 LoC + tests 60 LoC = 140 LoC

**隐藏依赖**:
- `origin_hash` 依赖 bench (需要知道 hash 计算对 ingestion 性能影响多少)
- `open_problems` 依赖 `origin_hash` (gap 记录需要指向 source observation, 否则 provenance 断链)
- bench 依赖 PII redactor (benchmark fixture 里的 fake data 不能意外触发真实 pattern)

因此真正的顺序是: **PII -> bench -> origin_hash -> open_problems**. ROADMAP 里的顺序错了.

### 4. episodic/memory_procedural 分歧现在解吗?
**立场: 不解. 纯 YAGNI.**

Gemini/Opus 的分歧是架构哲学分歧, 不是 bug. `session_turns` FTS5 需要 hook-shim 在每个 turn 写一行, 再加 episode summary 触发逻辑. 这是一套全新 ingestion path. 在没有用户日常使用数据的情况下设计 episodic, 做出来的 schema 大概率要推翻. 等 3 个月真实 miss log.

### 5. 要不要提前做 cache-provider API?
**立场: 不做. 接口驱动过早抽象.**

Engram v3.5 compost_cache DDL 已定, 但 Compost 侧的 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize` 是什么语义? 现在不知道. 如果等 3-6 个月数据发现 cache miss 模式, 届时加一个 CLI flag 是 1 天的事. 现在加, 是在为一个未知需求做接口合同. 违反 YAGNI.

### 6. 脏数据 audit
**立场: 做, 但作为 `compost doctor` 的一次性扫描, 不是新功能.**

13 个 migration 走下来, `observe_outbox` 里可能有 orphan rows (drain 从未处理). `facts` 可能有无 `source_observation_id` 的孤立 fact. `packages/compost-core/src/schema/migrator.ts` 有 migration 历史, 但没有 integrity checker. 加进 `compost doctor --check-integrity` 已有框架 (Phase 4 Week 4 已做 `--check-llm`), 估计 60 LoC.

---

## 3-Session 执行清单

**Session 1: PII redactor**
- `packages/compost-hook-shim/src/index.ts` scrub() 函数, regex blocklist
- 在 `JSON.stringify(envelope)` 之前调用 scrub
- 80 LoC 测试覆盖 6 类 pattern
- `compost doctor --check-pii` 扫描 existing `observe_outbox.payload`
- 目标: hook-shim tests + doctor tests 全绿, coverage >= 90%

**Session 2: bench harness**
- `bench/` 目录, reflect-1k/10k/100k fixture (synthetic, PII-safe)
- `bun run bench` 输出 p50/p95/p99 + MB/s
- CI step: 与 baseline 对比, >50% 回归 fail
- 顺带跑一次 DB integrity scan, 记录 orphan 数量

**Session 3: origin_hash + method (+ open_problems 设计)**
- `0014_origin_hash.sql` migration
- pipeline 写入路径打 hash (用 bench 数据验证无性能回归)
- `open_problems` 仅做 schema + 空 CLI stub (不实现 query 逻辑) -- 留给 Session 4
- 理由: origin_hash 是 open_problems provenance 的前置条件, 先落地 schema

---

**方案 D (episodic) 和 E (cache-provider API) 本 session 系列不碰.**
把资源花在能每天 dogfood 到的东西上: 挂 hook 的人第一感知是 PII 安全, 第二是"查询变慢了吗", 第三是"这条 fact 从哪来的". 这三个就是 B + bench + origin_hash 的顺序.
