# Debate 017: Compost 下一步执行计划

**Date**: 2026-04-16
**Rounds**: 1 (thorough, 500 words/advisor)
**Mode**: cross-critique
**Advisors**: Opus, Sonnet, Gemini, Codex

## 背景
- Compost main @ 72ebb77, Phase 0-3 + Phase 4 Batch D Week 4 全完成 (318 tests pass)
- Engram session 已开工 v3.3 (unpin + scope + CHECK + recall_miss_log + invariant tests)
- Engram↔Compost 协同线 (v3.5 compost_cache) 数据驱动被动触发: 等 Engram 3-6 月 miss log. Compost **现在零动作**.
- 问题: Compost 自身下一步做什么?

## 5 候选方案

### A: 完全静默
不写新代码, 只 bug fix. 等 3-6 月数据.

### B: PII redactor (单项, 推荐)
hook-shim 加 regex blocklist (CC/SSH/API-token/.env/"password:"). 30-50 LoC + 20 LoC test. 开源前置条件 (Phase 4 P1 明写).

### C: Phase 4 P1 全部 4 项
1. PII redactor
2. open_problems 表+CLI (替 Curiosity/Gap tracker)
3. Bench harness (reflect-1k/10k/100k + CI >50% 回归)
4. observations.origin_hash + method 列
2-3 session.

### D: Debate episodic/memory_procedural 解分歧
Phase 3 遗留: Gemini/Opus 对 memory_procedural 是否做分歧, episodic (session_turns FTS5) 悬而未决.

### E: 预先做 compost_cache-provider API
Engram 侧 compost_cache DDL 已定. Compost 需提供 `compost ask --as-cache-entry` 或 `mcp__compost__synthesize`. 风险: 如果数据不需要, 浪费.

## 6 判决点
1. 当前优先级基线: "稳+开源" vs "深+Phase 4 功能"?
2. PII redactor 真的是开源门槛? 比 bench/文档/LICENSE/examples 哪个更关键?
3. Phase 4 P1 4 项内部排序: PII > bench > open_problems > origin_hash 对吗? bench 是不是应该先 (没 bench 不敢跑大数据)?
4. episodic/memory_procedural 分歧现在解还是等用户真要? (YAGNI 风险)
5. Compost 要不要为 v3.5 提前做 cache-provider API?
6. Compost 自己有没有脏数据要 audit (orphan obs / stale facts / 遗留 schema)?

## 输出
≤500 字, 6 判决点各给立场+理由+风险, 结尾 **Compost 未来 3 个 session 具体执行清单**.

Participants 特色:
- Opus: 10 年维护成本
- Sonnet: 实现可行性 + 真实估算
- Codex: SQLite/migration/schema 风险
- Gemini: 生态/开源时机/社区信号

上下文:
- Phase 4 P1: docs/ROADMAP.md:176-180
- Phase 4 Carried: docs/ROADMAP.md:182-184
- Phase 5 Portability: docs/ROADMAP.md:203-215
- Phase 6 Ecosystem: docs/ROADMAP.md:217-229
- Known risks: docs/ROADMAP.md:141-154 (7 个, 2 已 resolved)
