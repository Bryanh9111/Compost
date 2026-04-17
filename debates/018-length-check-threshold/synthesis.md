# Debate 018 Synthesis — length(content) CHECK 阈值

**Date**: 2026-04-16
**Participants**: Opus 4.7, Codex, Sonnet (Gemini 配额耗尽)
**Rounds**: 1

## 排序汇总

| 排名 | Opus | Codex | Sonnet |
|------|------|-------|--------|
| 1 | D | A | A |
| 2 | A | D | C |
| 3 | C | C | D |
| 4 | B | B | B |

**共识**: B（严格 2000）**全方否决**。A/D 前二（都是"放宽到 4000"的变体）。C（archive 表）全方最低（仅 3/4）。

## Q 立场

| Q | Opus | Codex | Sonnet | 共识 |
|---|------|-------|--------|------|
| Q1 2000 依据 | 无 | 无 | 无 | **3/3 无硬依据** |
| Q2 长记忆 anti-pattern | 否（受控例外）| 否 | 否 | **3/3 合法用例** |
| Q3 kind-specific CHECK | 反对 schema 层 | 反对 | 支持 | **2:1 反对 schema 层 kind-specific** |

## 关键分歧：kind-specific 在哪一层？

- **Codex**: 不要 kind-specific，schema 一刀切 4000 + 应用层 soft lint
- **Sonnet**: schema 层 kind-specific CHECK（OR 嵌套）
- **Opus**: schema 一刀切 4000（Codex）+ 应用层 kind-specific warning（Sonnet 数值）→ **融合方案 E**

**2:1 反对 Sonnet 的 schema 层 kind-specific**。核心反对理由：
1. FTS5 rebuild 成本（每次改 CHECK 要重建 FTS）
2. CJK vs 英文 token 不对齐（字符数 ≠ token 数 ≠ 语义长度）
3. `engram lint` 已在应用层做 kind-specific 质量检查——正确分层
4. schema 层应守**数据完整性红线**，不是风格偏好

## 最终方案：E（三方融合）

### Schema 层（硬约束）
```sql
CREATE TABLE memories (
  ...
  content TEXT NOT NULL CHECK(length(content) <= 4000),
  ...
);
```

单一全局硬上限 4000，基于 SQLite 4KB page size 的物理边界（Codex 引用官方文档）。

### 应用层（soft warning）
`MemoryStore.remember()` 接受 kind-specific 建议值：
- `fact`: 500 chars
- `guardrail` / `constraint`: 800 chars
- `decision`: 3000 chars
- `procedure`: 4000 chars

超建议值但 ≤4000 时：**写入成功 + 记入 ops_log + 返回 warning**。

### Lint 层（可见诊断）
`engram lint` 新增一类报告：
```
Kind length violations (N):
  [decision] abc123 (3200 > 3000 suggested): ...
  [fact] def456 (600 > 500 suggested): ...
```

和 kind-specific staleness 同级别（只警告不删）。

### Server/MCP 层（error 可操作性）
CHECK 失败时（极罕见，只在 >4000 时）返回可操作的 error：
```
ERR_CONTENT_TOO_LONG: content is {N} chars, max 4000.
Suggestions:
  1. Split into multiple atomic memories
  2. Use compost ingest for long content (if Compost is available)
  3. Truncate to 4000 chars (data loss warning)
```

这是 Sonnet 独家警告的实装——agent 不能静默丢弃长内容。

## 现状处理（migration 内）

Step 0 audit 的 7 条 >2000 字：

| ID | Len | Kind | 4000 CHECK | Kind Warn | 处理 |
|----|-----|------|-----------|-----------|------|
| a60bebd71bea | 3468 | procedure | ✅ 过 | ≤4000 过 | 迁移 |
| 67c9535e4d69 | 3466 | decision | ✅ 过 | >3000 warn | 迁移 + warn |
| 693fd79e2aec | 2375 | decision | ✅ 过 | ≤3000 过 | 迁移 |
| 9f6b445d5aa2 | 2163 | decision | ✅ 过 | ≤3000 过 | 迁移 |
| 03be2d3d8db8 | 2153 | fact | ✅ 过 | >500 warn | 迁移 + warn（建议改 kind） |
| a6d8a85b8d07 | 2129 | decision | ✅ 过 | ≤3000 过 | 迁移 |
| 036bb933859d | 2062 | fact | ✅ 过 | >500 warn | 迁移 + warn（建议改 kind） |

**全部 7 条通过 schema CHECK，无一被拒**。2 条 fact 会触发 kind warning（建议改成 decision 或 procedure），用户审查后手动 re-kind。

## 不变量文档

新增到 ARCHITECTURE.md:
> **Schema CHECK = 数据完整性红线，不是风格偏好。**
> 风格偏好（kind length, tag 格式, confidence 区间）走应用层 lint，
> 未来演进可改应用层不动 schema。

## v3.3 执行清单更新（补丁）

Slice A Step 1 migration SQL:
- `CHECK(length(content) <= 4000)`（替换 2000）

Slice A Step 2 invariant test:
- assert schema `CHECK(length(content) <= 4000)`
- assert 无 kind-specific length CHECK 在 schema 里

Slice B 新增:
- 应用层 kind-specific length warning（`_apply_kind_rules()` 扩展）
- `engram lint` 新增 kind-length 违规报告
- Server error message 标准化

## 独家警告收录

**Codex W1** (FTS5 external-content): migration rebuild FTS 必须保留 rowid 映射，否则搜索静默失配
**Codex W2** (CJK token): `你好世界` 在 `unicode61` 下是单 token，不要假设 "1 char ≈ 1 token"
**Sonnet W1** (agent error handling): CHECK 失败对 agent 等于静默丢弃，Server 层 error message 必须可操作
