# R2 Codex

## 1. Cargo Cult
- Gemini-B：29 维 lint 把文件系统补丁搬进 DB；替：5 个 SQL 检查。
- Gemini-H：signal 直连写入，照搬 agent-first；替：triage+手动。
- Sonnet R2-B：`config.yaml` 仍是双真相源，仲裁过软；替：profile 表。
- Sonnet R2-F：给 P0 且成本失真；缺 project/export/conflict。替：P1 `shareable+export`。

## 2. 真 Insight
- Sonnet-E：三判据应直接进 `reflect.ts`；我撤回 R1 对 J 的后台化。
- Opus：`correction_event` 应升优先级；我撤回 R1 低估。

## 3. 三悬案
- A F：**P1**，只做 `shareable+export`。
- B Provenance：**P1**，加列；机器写入必填。
- C J：**P2**，仅 query-side。

## 4. 最终投票
| 项 | Tier | 理由 |
|---|---|---|
| A brief | P0 | 入口自检 |
| B lint | Reject | 双真相 |
| C audit | P0 | 写入留痕 |
| D graph | P0 | 退化感知 |
| E 3c | P0 | 纯 SQL |
| F export | P1 | 仅导出 |
| G model | P1 | 只做 ABC |
| H action | Reject | 不直写 |
| I crawl | Reject | 越权 |
| J cohort | P2 | 检索试验 |
| correction | P0 | 显式改口 |
| open_problems | P1 | 记录未知 |
| tomb_reason | P1 | 防反复 |
| session | P1 | 补时间线 |
| provenance | P1 | 机器溯源 |

## 5. 自我修正
- 撤回 Codex R1“F 只沉淀 procedural memory”；改为“只允许 shareable 导出”。

DONE_R2_CODEX
