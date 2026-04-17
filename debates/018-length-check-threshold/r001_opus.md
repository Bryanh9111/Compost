# Debate 018 — Opus 4.7 立场

## 排序
1. **D**: 和 A 等价但留了文档，5 年后回头看能知道为什么放宽（Codex 说 TODO 永远是 TODO，但决策记录本身有价值，不是执行承诺）
2. **A**: 干净但没记录"为什么从 2000 改到 4000"的 audit trail
3. **C**: archive 表引入双表复杂度，违反 Slice A 的最小改动原则
4. **B**: 信息损失 + migration 阻塞，3/3 方都反对

## Q1 (2000 依据)
**无硬依据**。debate 016 当时没 audit，阈值是从"便条夹"叙事反推的，不是从数据推出来的。Codex 引用 FTS5 官方文档证明 `bm25` 按 token 归一不按字符切——2000 字符在 CJK/英文混合场景下对检索质量没有已验证影响。

## Q2 (长记忆是否 anti-pattern)
**不是**，但必须是受控例外。Sonnet 的场景分类到位：session handoff / debate outcome / spec 必须原子读取，拆开就断 context。Compost 的 observation → L2 fact 路径可以容纳这类内容，但 Compost 还没 ingest，强行拆只是把负担推给用户写 CLAUDE.md，失去 Engram 价值。

## Q3 (kind-specific CHECK)
**反对 schema 层 kind-specific**，支持应用层 soft lint。理由：
- Codex 的技术反对（FTS5 rebuild 成本 + CJK token 错位）站得住
- Sonnet 的 CHECK 写法（OR 嵌套）维护噩梦
- Engram 已有 `engram lint` 做 kind-specific 质量检查——这是正确位置
- schema 是 hard 约束（数据完整性），lint 是 soft 约束（风格建议）。分层对

## 最终推荐：E（融合 Codex + Sonnet）

**Schema 层**: `CHECK(length(content) <= 4000)` 全局硬上限（采纳 Codex）
**应用层**: kind-specific soft warning（采纳 Sonnet 的数值）
- `remember()` 超 kind 建议值但 ≤4000 时：**写入成功** + warning log
- kind 建议值：fact 500, guardrail/constraint 800, decision 3000, procedure 4000
**Lint 层**: `engram lint` 新增 kind-length 违规报告（和 staleness 同类，只警告不删）
**Server 层**: CHECK 失败时返回清晰 error message（采纳 Sonnet 警告 #1）：
  ```
  Content exceeds 4000 chars (got N). Consider:
  1. Split into multiple memories (atomic claims)
  2. Use compost ingest for long content
  3. If truly needed, this is your soft cap.
  ```

## Opus 独家补充

**5 年视角**: 4000 字符阈值 + 应用层 warning 的组合，比任何 schema 层 kind-specific 都更容易演进。未来发现 CJK 记忆系统性超标，只需改 1 行应用层 warning 阈值，不需要 rebuild FTS5。schema 层只守**绝对红线**（不是风格线）。

**迁移 invariant**: "schema CHECK = 数据完整性，不是设计偏好" 应该写进 ARCHITECTURE.md。这样未来加字段时不会把"应该短"这种偏好塞进 CHECK。
