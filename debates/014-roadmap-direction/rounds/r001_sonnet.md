# R1 Sonnet — KISS / 用户实际使用路径

## Q1 裁决 (排序)

1. **dogfood-pause 2 周** — 自己天天用 ask/query/triage, 让真实摩擦决定 P1 顺序. 8 个 P0 没一个被真实使用过, 现在排 P1 是猜.
2. **PII redactor** — 唯一硬阻塞项. 开源 / 分享 / 给朋友看 demo 前必须有, 不依赖 dogfood 数据.
3. **bench harness** — 没 baseline 谈不上回归. 但只有发现真的慢才值得做, 优先级低于 1+2.
4. **open_problems** — 用过 triage 才知道 gap tracker 长什么样, 现在做就是二次发明.
5. **origin_hash** — 纯 schema 加列, 没 query 消费者, 最后做.

Phase 5 export/import: 等真换机器再做, 现在零用户需求.

## Q2 评判 (过度工程)

**graph_health_snapshot 每天 04:00 跑**: 单用户 31 文件量级, Union-Find 一天没人看. 是预防性但 cron 频率过高, 改 weekly 或 on-demand.

**backup 30 日轮 + daemon scheduler**: macOS 用户已有 Time Machine + iCloud + git. SQLite VACUUM INTO 价值在跨机器迁移, 不在每日快照. 保留 CLI, 砍 daemon cron.

**decision_audit 双 writer (contradiction + wiki_rebuild)**: recordDecision 写了但 listDecisions 没人在 ask/triage 调用. 写入路径完备, 消费路径不存在 — 典型 build-it-and-they-will-come.

**必要保留**: 熔断器 (Ollama 单 fallback 真会挂); Self-Consumption guard (wiki rebuild 反馈环是真 bug); triage 6 信号 (是 dogfood 入口本身).

## Q3 漏洞 (硬上限 3)

1. **Eval harness**: 没指标判断 ask() 答得对不对. 改 ranking_profile / 换 LLM / 加多查询 全凭感觉. 比 bench 更紧迫 — bench 测速度, eval 测正确性.
2. **空查询降级 UX**: `query` 零结果只回 "I don't know", 应该建议 "你 archive 了 X" / "类似 slug 是 Y" / "要不要 add". 这是 dogfood 第一周必撞的墙.
3. **Hook p99 + 失败可见性**: p95<30ms 但 hook fatal 静默 swallow 后用户不知道知识没进库. 至少加 `compost doctor --hook` 看最近失败.

## 一句话总评

**部分对**: 地基扎实但工程节奏跑在使用前面 — 现在该停手用 2 周, 让真实摩擦淘汰一半 P1, 而不是按 myco 借鉴清单继续往前推.

DONE_R1_014
