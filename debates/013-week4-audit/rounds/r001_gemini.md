# Audit Round 1 — Gemini (LLM / Failure Modes)

## 1. Top 4 Defects

### [MEDIUM] `ask()` hits=0 slug mismatch (Functional Regression)
**Location**: `packages/compost-core/src/query/ask.ts:133-143`
**Description**: The "hits=0" wiki fallback path uses `question.toLowerCase().trim()` as a slug. However, `wiki.ts:98` generates slugs using `topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")` (regex-based).
**Impact**: If a user asks "Paris France", the fallback looks for `path = 'paris france'` or `'paris france.md'`, but the actual file is `'paris-france.md'`. This renders the Day 5 "Known-risk row 3" fix broken for any multi-word or special-character topic.
**Fix**: Import a shared `slugify` helper or copy the regex from `wiki.ts` into `ask.ts`.

### [LOW] `scanStaleWiki` ignores NULL `last_synthesis_at`
**Location**: `packages/compost-core/src/cognitive/triage.ts:241`
**Description**: The WHERE clause `last_synthesis_at < datetime(...)` evaluates to `UNKNOWN` (effectively false) if `last_synthesis_at` is NULL.
**Impact**: Newly discovered topics that have never been synthesized (NULL `last_synthesis_at`) will not be surfaced as `stale_wiki`. These are arguably the most "stale" (or "missing") items that should be triaged.
**Fix**: Change to `(last_synthesis_at IS NULL OR last_synthesis_at < ... )`.

### [LOW] `doctor --check-llm` is too optimistic
**Location**: `packages/compost-cli/src/commands/doctor.ts:240-276`
**Description**: The check only verifies that `llm.generate("ping")` returns *something* without throwing. It does not check if the content is an error message (common with proxy 200 OK errors) or if the model name returned by Ollama matches the configured model.
**Impact**: False positives where `doctor` says OK but the LLM is actually returning "Model not found" or proxy errors as plain text.

### [LOW] `triage scan` output JSON format inconsistency
**Location**: `packages/compost-cli/src/commands/triage.ts:47`
**Description**: `process.stdout.write(JSON.stringify(report, null, 2) + "\n")` outputs the full report including the `signals` array.
**Impact**: If a user has 500 signals, `compost triage scan` (intended as a summary command) will dump a massive JSON blob to stdout.
**Fix**: Default to a summary view (counts by kind) and require `--verbose` or similar for the full signal list, or just align with `compost audit list` behavior.

---

## 2. Tech Debt 清单

| 位置 | Cost | Benefit | 推迟触发条件 |
|---|---|---|---|
| `ask.ts:54, 185` | Low | 将 LLM/CircuitBreaker 失败从 `console.warn` 转移到 `health_signals` (kind: `llm_failure`)，提高系统自愈可观测性。 | 信号量达到 >1k/day 导致日志洪泛时 |
| `doctor.ts:240` | Low | 在 `--check-llm` 中加入 "Sanity Check" (例如: 问 "1+1=" 检查是否返回 "2")，验证模型智能而非仅网络连通性。 | 出现 Ollama 挂载错误模型但进程存活的故障案例 |
| `ask.ts:35` | Med | Expansion prompt (`EXPANSION_PROMPT`) 固定在代码中。应允许通过 `ranking_profile` 或外部 config 调整，以适应不同模型的提示词偏好。 | 需要支持非 Ollama (如 Claude/OpenAI) 模型作为后台时 |

---

## 3. 契约偏离

- **`contract.md` 锁定 vs 代码**: 
  - **对齐**: `SignalKind` (6 种) 在 `triage.ts` 和 `0012` migration 中完全对齐。
  - **对齐**: `BreakerRegistry` 单例在 `main.ts` 构造并正确注入 `mcp-server.ts` 和 `scheduler.ts`。
- **`ARCHITECTURE.md` drift**: 
  - **对齐**: LLM Call Sites 表与 `breaker-registry.ts` 的 site keys (`ask.expand`, `ask.answer`, `wiki.synthesis`) 严格一致。

---

## 4. Merge-blocker vs nice-to-have

### Merge-blocker
1. **`ask()` slug mismatch**: 必须修复，否则 ROADMAP 里宣称已解决的 "known-risk row 3" (hits=0 path) 实际上是坏的。

### Nice-to-have
1. **`scanStaleWiki` NULL check**: 建议在 PR 中顺手修了，改动仅 1 行。
2. **`doctor --check-llm` sanity check**: 可以留到 Week 5。

---

## 5. 一句话总评
Week 4 交付质量极高，单 Registry 契约完美落地，Breaker 与 Fallback 链路逻辑闭环；唯一瑕疵在于 `ask()` 路径的 Slug 处理过于简单，导致空搜索回退功能对多词主题失效。

DONE_R1_013
