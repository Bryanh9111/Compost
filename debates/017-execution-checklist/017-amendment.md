# Debate 017 Amendment — Q2 Revision

**Date**: 2026-04-16 (post debate 017)
**Reason**: 新证据推翻原裁决前提

## 原裁决（debate 017 Q2）

**问题**: unpin API 是否应该成为永久 API？

**票数**: 2:1 REJECT
- Codex: REJECT（"只为 migration 清理，YAGNI"）
- Sonnet: REJECT（"批量滥用风险"）
- Opus: MODIFY（"加防护但保留"）

**原方案**: 不做永久 API，仅在迁移事务内用一次性 SQL `UPDATE memories SET pinned=0 WHERE ...`

## 推翻前提的新证据

用户在 debate 017 结论后补充了"补丁 4"：

> v3.3 unpin API 第一个实战 = 清掉我这次制造的 4 条 v1 pinned
> (15e2bad36425, b3190c88f62b, 5bfe29263fd0, 66a41d866025)

这揭示了 **unpin 的第二类用户场景**：

| 场景 | debate 017 时 | 补丁 4 揭示 |
|------|--------------|-----------|
| A. Migration 清理 compiled 污染 | 已知（一次性） | ✓ 一次性 SQL 够 |
| B. Supersede-based dogfood 清理 | **未考虑** | ✗ 需要持久化 API |
| C. 用户 pin 后悔机制 | **未考虑** | ✗ 未来需要 |

YAGNI 前提（"只为 A 场景"）被 B 场景推翻。B 场景是 dogfood + supersede 的自然延伸，不是假设需求——**这次对话当场就在使用**。

## 修订后裁决

**SUPPORT unpin API + 原防护条款**。

理由：
1. pin/unpin 是 memory lifecycle 的对称操作，缺 unpin 是设计缺陷
2. B 场景即时成立（用户补丁 4 = 第一个实战）
3. C 场景未来几乎必现（任何 pin 过的记忆都可能需要 unpin）
4. 防护条款消除 Sonnet 担忧的批量滥用：单条、ops_log、CLI confirm

## 实装细节（已执行）

### `src/engram/store.py`
```python
def unpin(self, memory_id: str) -> dict:
    """Unpin a memory, allowing it to be forgotten or age-flagged."""
    # 单条操作，写 ops_log，不支持 batch
```

### `src/engram/cli.py`
```bash
engram unpin <id>           # 交互式 confirm
engram unpin <id> --yes     # 跳过 confirm（脚本用）
```

### `src/engram/server.py`
```python
@mcp.tool()
def unpin(memory_id: str) -> dict:
    """...Use sparingly: prefer superseding via a new memory with supersedes tag.
    Single memory only, not batch."""
```

### 测试（5/5 绿）
- `test_unpin_pinned_memory`
- `test_unpin_allows_forget_after`
- `test_unpin_nonexistent_raises`
- `test_unpin_already_unpinned_returns_noop`
- `test_unpin_logs_operation`

### Dogfood（4/4 成功）
unpin + forget 已清理 15e2/b319/5bfe/66a4 四条 v1 pinned。
`engram search compost` 验证 recall 只返回 v2 (3a04dbe732e6)。

## 教训（写入记忆纪律）

**辩论结论 ≠ 永久真理**。当新证据推翻前提假设（这次是 Codex 的 YAGNI 假设被 B 场景推翻）时，应该修订而非固守。但修订必须：

1. **透明**: 写 amendment 文档，不悄悄改
2. **归因**: 明确指出哪个前提被哪个新证据推翻
3. **成本**: amendment 本身算 debate 决策的一部分，5 年后看能懂

这条本身会在 v3.3 完成后写入 Engram 作为 `decision` memory，evidence_link → 本文件路径。
