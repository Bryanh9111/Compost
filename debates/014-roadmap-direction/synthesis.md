# Debate 014 — Synthesis (Opus, Roadmap Direction)

4/4 R1 landed. Clean convergence on **方向部分对, 但节奏需要停顿 + 补评测**.
无 "方向错了" 异议.

## Q1 Ordering — 4 方意见合流

| Rank | Codex | Gemini | Sonnet | Opus | 合并裁决 |
|---|---|---|---|---|---|
| 1 | PII redactor | PII redactor | dogfood-pause | dogfood-pause | **dogfood-pause** (2 方主选, 另 2 方未反对) |
| 2 | export/import | bench | PII redactor | PII redactor | **PII redactor** (4/4 前三位) |
| 3 | bench | export/import | bench | bench+eval | **eval + bench 合一** |
| 4 | origin_hash | open_problems | open_problems | open_problems | `open_problems` 待 dogfood 后决定 |

- **`PII redactor` 是唯一 4/4 前三位的编码项** — 不依赖 dogfood, 是分享前
  prerequisite. 独立可做.
- **`open_problems` + `origin_hash`** 全部 ≥ 第 4 位 — **不做**, 等 dogfood
  产出后再评.
- **Phase 5 `export/import`** Codex/Gemini 入前三, Opus/Sonnet 降位 — 共识
  "等真换机器场景". 推.

## Q2 Over-engineering — 高共识清单

**(4/4 unanimous) `graph_health_snapshot` 每日 04:00 UTC cron**
所有 4 方都列. 单用户 < 10k facts 量级, 零 reader (v_graph_health 无 caller,
snapshot 无 CLI 展示). **Action**: cron 降 **weekly** 或 **on-demand**
(`compost triage --refresh-graph`). 保留表和 view, 砍定时写入.

**(3/4) `decision_audit` 有 writer 无 reader**
Opus OE2 + Gemini #3 + Sonnet "build-it-and-they-will-come". contradiction /
wiki_rebuild 写了, `compost audit list` 有 CLI, 但 ask / triage / doctor 都
不引用. **Action**: 加 `compost doctor --daily-digest` 汇总 unresolved
triage 信号 + 昨日 audit 增量 + 近 N 次 wiki stale — 一个消费入口让现有写
入路径有价值.

**(2/4) `backup` 30 日轮 daemon cron 与 Time Machine 重叠**
Codex + Sonnet. 不砍功能, 调配置. **Action**: 环境变量 `COMPOST_BACKUP_AUTO=0`
默认开, 文档 "与 Time Machine 互补, 单机 macOS 用户可关". 保留 `compost
backup` CLI 手动路径.

**(1/4 反对) `Self-Consumption guard` 过度**
只 Gemini 列. Codex/Sonnet/Opus 显式保留. **维持现状** — 预防成本低.

**(1/4 反对) `BreakerRegistry` Ollama 本地过度**
只 Codex 列. Ollama 本地超时是真发生 (doctor --check-llm 已观察到). **维持**.

## Q3 Missing — 高价值遗漏

**(4/4 unanimous) Eval harness**
四方一致. Golden questions (10-30 条) + expected facts + recall@k / MRR +
可选 LLM-as-judge. 调 ranking profile / 换 LLM / RRF 参数全靠盲测否则
无进步. **Week 5 优先于 bench** (Sonnet 洞察: eval 测正确性, bench 测速度,
先搞对再搞快).

**(2/4) JSON output + interop**
Opus M2 + Gemini #2. `compost query/ask --json` + `compost export --facts
json` + 可能的 `--since <iso>` 流式. 让 Compost 数据能流到外部 LLM / 脚本,
而非仅 MCP 单路径.

**(2/4) Hook p99 + 失败可见性**
Codex #3 + Sonnet #3. 现在只有 p95 < 30ms SLA, 但 hook fatal 静默 swallow.
**Action**: `compost doctor --hook` 读最近 100 次 hook 事件 (含失败), stderr
失败 rate 警告.

**(1/4 但高价值) Ingestion quality gate**
Opus M3 独家. Python llm_facts.py 抽取正确率零度量, 会污染下游全链. 放入
eval harness 一起做.

**(1/4) Empty query UX / 空查询降级建议**
Sonnet #2. "I don't know" 之外无路径, dogfood 第一周必撞. 小 UX 修.

## Verdict — 一致判定 "部分对"

四方完全同意:
- **地基扎实** (Phase 0-4 P0 都是合理工程选择)
- **节奏偏快** (workers 跑在 users 前面)
- **方向大体对**, 但缺: dogfood 验证 + eval 量化 + 现有写入的消费路径

无人说 "roadmap 错了" 或 "应该推翻 Batch D 重来".

## 最终执行建议

### 立即 (零代码, 2 周)
- **Dogfood pause**: 每天真用 Compost 管自己的知识. 写 `debates/015-dogfood-log.md`
  记录摩擦点. 2 周后用数据决定 Week 5 优先级.
- **同步跑 eval harness bootstrap**: 写 10 条 golden questions + expected
  facts, 每周跑一次看 recall@k 走向. 这本身是 dogfood 的一部分.

### Week 5 编码批 (可与 dogfood 并行)
1. **PII redactor** (3-5 天) — `packages/compost-hook-shim/src/redactor.ts`
   regex blocklist (CC / SSH / API-token / `.env` / `password:`). 纯本地,
   独立.
2. **Eval harness** (3-5 天) — `packages/compost-eval/` + `bench/golden/*.json`
   + `compost eval run` CLI. 并行独立.
3. **`--json` flag** (0.5 天) — query / ask / audit list / triage list 都加.
   微改动, 解锁 interop.
4. **`compost doctor --daily-digest`** (1 天) — 让 triage + audit 有消费
   入口.

### 调整已有 (同 Week 5 顺手, 共 ~1 天)
- `graph_health_snapshot` cron: daily → weekly (主迁调度参数)
- `backup` daemon cron 文档化 Time Machine 关系 + env toggle
- `compost doctor --hook` 加最近失败读取

### 明确 defer
- **`open_problems` / `origin_hash`** → dogfood 后决定是否仍要做
- **Phase 5 export/import** → 真换机器触发时
- **Phase 4 P2** → 继续无限期推

## 风险

- **Dogfood 风险**: 如果 2 周没真认真用, 此 synthesis 给不出信息更新. 需
  用户自律.
- **eval harness 启动成本**: golden set 搭建不精准 → 评测失真. 第一版粗糙
  可接受, 迭代优化.
- **没做 PII 就 dogfood**: 风险很小 (macOS 单机 + git privately).

## 共识总评

Compost **打好了地基, 该从"建筑工地"切换到"装修 + 居住"模式**. 再无脑推
Phase 4 P1 等于盖了第 5 层没人住的楼. dogfood + eval 两把工具先就位, 然
后 PII redactor 解锁分享, 其他按真实摩擦排队.

DONE_014
