# Synthesis v2 — Final Convergence (四方完整 R2)

> 🐙 Opus 主持综合 · 2026-04-14 (v2)
> Full 4-way convergence: 🔴 Codex + 🟡 Gemini + 🟠 Sonnet + 🐙 Opus (all R1 + R2)
> 此 v2 替代 synthesis.md — 包含 Codex R2 和 Gemini R2 的最终仲裁

---

## 一致共识 (4/4 通过)

### P0 共识 (4 项)
| # | 项 | 共识证据 |
|---|---|---|
| 1 | `compost triage` (health_signals) | 4/4 P0/accept |
| 2 | `decision_audit` + 置信度阶梯 | 4/4 P0 |
| 3 | `v_graph_health` SQL view | 4/4 P0 |
| 4 | 压缩三判据 + tombstone_reason | Opus/Sonnet/Codex P0, Gemini P1 — 3/4 P0 |

### Reject 共识 (5 项)
| 项 | 共识 |
|---|---|
| 29 维 YAML lint (B) | 4/4 Reject |
| `hunger(execute=true)` auto-action (H) | 4/4 Reject |
| `forage` 外部自动爬取 (I) | 4/4 Reject |
| `evolve.py` 整套 (L 成本) | 4/4 Reject (Gemini 自己撤回 R1 立场) |
| Craft Protocol 完整 ceremony | 4/4 Reject (没人 accept 整套) |

---

## 仲裁三大悬案

### 悬案 A: Cross-Project Distillation (候选 F)

| 参赛者 | R1 立场 | R2 立场 | 最终 |
|---|---|---|---|
| Sonnet | reject (R3) | **P0** 坚持 | 分歧 |
| Opus | P0 | P1 simplified | 撤回 |
| Codex | modify procedural | **P1** shareable+export | 撤回 |
| Gemini | reject | **Reject** 隐私隔离 | 坚持 |

**投票**: 3/4 愿意接纳某种形式. Gemini 的隔离论有道理 (multi-namespace 泄漏风险), 但 Codex 和 Opus 仲裁同意的是**手动 export** (用户显式触发), 不是 auto-sync, 隐私论不成立.

**裁决**: **P1 — simplified `shareable` tag + `compost export --shareable` markdown bundle**. 不做任何跨库自动同步. 实现:
- `facts` 表加 `shareable BOOLEAN DEFAULT 0`
- `compost tag --shareable <fact_id>` 手动标记
- `compost export --shareable --format md --out bundle.md` 导出
- 不引入 `project` 表 (Compost 保持单 namespace), 用户可手动 import 到另一个 Compost 实例

### 悬案 B: Inlet Provenance Contract

| 参赛者 | R2 立场 |
|---|---|
| Gemini | **P0 强制** (矛盾仲裁法官) |
| Codex | **P1** 加列, 机器写入必填 |
| Sonnet (R2 CC-3) | **Reject 强制**, 仅 opt-in |
| Opus | P1 opt-in |

**裁决**: **P1 — opt-in, 机器-origin 必填, 人-origin 可空**.
- `observations` 表加 `origin_hash TEXT NULL` (sha256 of upstream source) + `method TEXT NULL` (enum: `claude-hook`, `cli-manual`, `import-file`, `crawl`)
- hook 层自动填充 (机器 origin)
- 用户手动 `compost add` 可空 (人-origin 信任用户自述)
- 冲突仲裁时 origin_hash 存在的 fact 权重更高, 不存在时 fallback 到 confidence

Gemini 的"强制"过严, Sonnet 的 "opt-in 无强制" 过松. Codex 的"机器必填人可空"是最准判断.

### 悬案 C: Semantic Cohort Intelligence (候选 J)

| 参赛者 | R2 立场 |
|---|---|
| Gemini | P1 query-side |
| Sonnet | P1 query-side only |
| Codex | **P2** 检索试验 |
| Opus | P2 |

**投票**: 2/2 split. Codex 作为技术视角说 "仅作为检索试验" 更保守.

**裁决**: **P2 — 只在 `ask.ts` 查询路径加一个 experimental flag**, 不建后台 cohort 表. Phase 4 先不做, 等 Phase 5 有实际 noise 证据再启动.

---

## 最终 P0 清单 (5 项, 满额)

| # | 项 | 成本 | 涉及文件 |
|---|---|---|---|
| 1 | `compost triage` — health_signals table + 5 signal sources | M | `cognitive/triage.ts`, migration 0010 |
| 2 | `decision_audit` + confidence ladder (0.90/0.85/0.75) | M | `reflect.ts`, `wiki.ts`, migration 0010 |
| 3 | `v_graph_health` SQL view + daily snapshot | S | Phase 4 fact-links 之上 |
| 4 | Compression 3-criteria + `tombstone_reason` enum | S | `reflect.ts`, migration 0010 |
| 5 | Self-correction event capture (regex) | S | `hook-shim`, `correction_events` table |

**注**: 所有 5 项走一个 migration `0010_phase4_myco_integration.sql`, 一个 feature branch.

---

## 最终 P1 清单 (8 项, 满额)

| 项 | 四方投票 | 实现要点 |
|---|---|---|
| `open_problems` 表 + CLI | 4/4 P0/P1 | 盲点登记 (≠ backlog); `compost problems add/list/resolve` |
| Session FTS5 + episode 聚合 | 4/4 P1 | Phase 4 episodic 原计划; session_summary 字段 |
| Compression pressure metric (view) | 4/4 P1 | triage 的信号输入, 不触发 auto-action |
| Cross-project `shareable` tag + export | **仲裁通过** | 见悬案 A |
| `crawl_queue` SQLite | Sonnet/Codex P1 | 持久化 curiosity intent, 手动 trigger |
| Inlet provenance (opt-in) | **仲裁通过** | 见悬案 B |
| Four-layer dashboard (只 A 库存 + C 退化) | 3/4 P1 | 一个 SQL view + `compost stats` CLI |
| tombstone_reason + replaced_by + revival | 3/4 P1 (合并到 P0-4) | 与 P0-4 同 migration, 加字段 |

---

## 最终 P2 清单 (3 项)

| 项 | 为什么 P2 |
|---|---|
| Semantic Cohort (query-side experimental) | 悬案 C 仲裁结果. Phase 5+ 启动 |
| Milestone retrospective scheduler | 单用户, weekly diff 价值待证 |
| Craft Protocol lite (kernel-only) | 已有 /octo:debate + P0-2 audit, 仪式成本过高 |
| ~~`compost.config.yaml` SSoT~~ | **降级 Reject** — Codex 指出 "仍是双真相源, profile 表已覆盖" |

---

## 最终 Reject 清单 (6 项)

| 项 | 4/4 共识理由 |
|---|---|
| 29 维 YAML lint | SQLite schema + TS 类型已内化 80%, 叠层 = 双真相源 + L 维护 |
| `hunger(execute=true)` auto-action | agent-first 假设错位; LLM 幻觉信号转 write 无 audit; Codex "不直写" |
| `forage.py` autonomous external crawl | Codex "越权"; first-party 原则破坏 |
| Myco 生物学术语在 CLI/schema | Sonnet R2 CC-4 列出 Gemini R1 六处违规; Gemini 自承 |
| `evolve.py` 整套进化引擎 | migration + profile 版本化 rebrand, 无增量 (Gemini 自己撤回 R1 Item 8) |
| Craft Protocol 完整 ceremony | 单用户仪式成本 > 决策; decision_audit 已够 |

---

## 关键 Cargo Cult 记录 (警示未来)

所有参赛者 R2 共同识别的 cargo cult 陷阱:

1. **Gemini R1 Item 3 (29 维 lint)**: Sonnet + Codex + Opus 独立指出 — 把文件系统补丁搬进 DB
2. **Gemini R1 Item 8 (evolve.py)**: Sonnet + Opus + Codex + Gemini R2 自认 — migration 改名
3. **Gemini R1 全文生物学术语**: Sonnet R2 CC-4 列 6 处违规 — Gemini R2 未明确自认但 R2 文本术语减少
4. **Sonnet R2 F 标 P0**: Codex R2 指出 — 成本失真, 忽略 project/export/conflict
5. **Sonnet R2 `config.yaml` SSoT**: Codex R2 指出 — 仍是双真相源
6. **Opus R1 Cross-Project P0**: Opus R2 自承 — 抄 tag 皮没看底层基础设施

**元教训**: 有 3 人以上交叉指出的项, 就是真 cargo cult. 单人看出的, 可能只是风格偏好.

---

## 取骨去皮综述 (修订版, ≤ 500 字)

**Myco 给我们的真金是"五个失败模式的形式化"**: (1) 入库但不反思 (2) 反思但不审计 (3) 矛盾但不仲裁 (4) 整体退化但无感知 (5) 知道缺口但不追踪. 这五个问题每个知识系统都会遇到, Myco 把它们明确命名是贡献.

**Compost Phase 4 的 5 个 P0 对应这五个失败模式**:
- triage → 失败 1 (被动 surface → 主动)
- decision_audit → 失败 2 (审计链)
- graph_health → 失败 4 (结构退化)
- 压缩三判据 + tombstone_reason → 失败 3 (矛盾 + 冗余仲裁)
- self-correction + open_problems (P1) → 失败 5 (缺口追踪)

**Myco 必须拒绝的是"agent-first 部署形态"**: 25 MCP tools / 单文件 150KB / markdown+YAML SSoT / 29 维 lint / auto-execute hunger / forage 爬取 / 生物学术语. 这些是 Myco 服务 agent 的方式选择, 不是认知设计的必要成分. 第二大脑的主角是**人**.

**4 方共同达成的元原则**:
- **嵌入而非开新轴** (Opus): 所有 Myco 借鉴嵌入 Phase 4 已有 5 大主题
- **signal → queue → bounded worker → audit row** (Codex): 任何自驱能力都必须走这个四阶段
- **SQLite 是唯一真相源** (Sonnet): 不叠 YAML lint, 不加 markdown SSoT
- **导出而非同步** (仲裁 A): 跨边界一律手动 export, 无 auto-sync

**Myco 的 identity 文档比代码值钱**. 它的 `identity.md` / `open_problems.md` / `vision_recovery_craft` 三份文档有长期价值 — 读完就能用, 不留 Myco 代码 / MCP / YAML. 让 Compost 被这五个失败模式教育过后, 留下 schema 和 view 就够了.

**风险观察**: 本次集成最容易的失败模式是"借 Myco 皮扩大 Phase 4 范围". 4 方共同识别的 6 个 cargo cult 点都是这种扩张冲动. P0 死守 5 项, P1 做不做等 Phase 4 落地反馈, P2 不做承诺. 这是本次辩论最重要的非技术产出.

---

## 执行路线 (下一步具体 PR 序列)

### Phase 4 Batch D — Myco P0 Integration

**Branch**: `feat/phase4-batch-d-myco-integration`
**Migration**: `0010_phase4_myco_integration.sql`
**Scope**: 所有 5 个 P0 合并一个 branch

**表结构**:
```sql
-- P0-1: health signals
CREATE TABLE health_signals (
  id INTEGER PRIMARY KEY,
  kind TEXT CHECK(kind IN ('stale_fact','unresolved_contradiction','stuck_outbox','orphan_delta','stale_wiki')),
  severity TEXT CHECK(severity IN ('info','warn','error')),
  message TEXT NOT NULL,
  target_ref TEXT,  -- fact_id / wiki_id / etc
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);

-- P0-2: decision audit
CREATE TABLE decision_audit (
  id INTEGER PRIMARY KEY,
  kind TEXT CHECK(kind IN ('contradiction_arbitration','wiki_rebuild','fact_excretion','profile_switch')),
  target_id INTEGER NOT NULL,
  confidence_floor REAL NOT NULL,  -- 0.90/0.85/0.75
  confidence_actual REAL NOT NULL,
  rationale TEXT,
  evidence_refs_json TEXT,
  decided_at INTEGER NOT NULL,
  decided_by TEXT  -- 'reflect' / 'user' / 'agent'
);

-- P0-3: graph health (view, no table for runtime)
CREATE VIEW v_graph_health AS ...;
CREATE TABLE graph_health_snapshot (taken_at INTEGER PRIMARY KEY, total_facts INT, orphan_facts INT, density REAL, cluster_count INT);

-- P0-4: tombstone reason
ALTER TABLE tombstones ADD COLUMN reason TEXT CHECK(reason IN ('stale','superseded','contradicted','duplicate','low_access'));
ALTER TABLE tombstones ADD COLUMN replaced_by_fact_id INTEGER REFERENCES facts(id);
ALTER TABLE tombstones ADD COLUMN revival_event_id INTEGER;

-- P0-5: correction events
CREATE TABLE correction_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  retracted_text TEXT,
  corrected_text TEXT,
  related_fact_ids_json TEXT,
  created_at INTEGER NOT NULL
);
```

**新 TS 模块**:
- `packages/compost-core/src/cognitive/triage.ts` (P0-1)
- `packages/compost-core/src/cognitive/audit.ts` (P0-2)
- `packages/compost-core/src/cognitive/graph-health.ts` (P0-3)
- 扩展 `packages/compost-core/src/cognitive/reflect.ts` (P0-4)
- 扩展 `packages/compost-hook-shim/src/hook.ts` (P0-5)

**CLI 新命令**:
- `compost triage` — 输出健康简报
- `compost audit list` — 查 decision_audit
- `compost stats graph` — graph health 当前快照
- `compost correction list` — 近期 self-correction 事件

**测试**: 每个 P0 必须有单元测试 + 一个 end-to-end 场景

---

## 状态

- R1: 4/4 完成 ✅
- R2: 4/4 完成 ✅
- Synthesis v2: 完成 ✅
- 辩论完结 — 可执行 P0 落地 或 进入 /ship 准备 PR 骨架

---

## 最终投票矩阵 (R2 完整)

| 候选 | Opus R2 | Sonnet R2 | Codex R2 | Gemini R2 | **最终** |
|---|---|---|---|---|---|
| A triage | P0 | P0 | P0 | P0 | **P0** |
| B 29-lint | Reject | Reject | Reject | Reject | **Reject** |
| C audit | P0 | P0 | P0 | P0 | **P0** |
| D graph | P0 | P0 | P0 | P0 | **P0** |
| E compression 3c | P0 | P1 | P0 | P1 | **P0** (3/4) |
| F cross-project | P1→R | P0 | P1 | Reject | **P1 (仲裁)** |
| G self-model | P1 (A+C) | P1 | P1 | - | **P1** |
| H auto-action | Reject | Reject | Reject | - | **Reject** |
| I forage | P1 (queue) | Reject | Reject | - | **Reject (crawl); P1 (queue only)** |
| J cohort | P2 | P1 | P2 | P1 | **P2 (仲裁)** |
| correction | P0 | P1→P0 | P0 | P1 | **P0** (3/4 with upgrade) |
| open_problems | P1 | P0 候补 | P1 | P0 | **P1** (2P0/2P1) |
| tombstone_reason | P1 (并入 P0-4) | P0 | P1 | P1 | **P1 bundled** |
| session FTS5 | P1 | P1 | P1 | P1 | **P1** |
| provenance | P1 opt-in | Reject 强制 | P1 机器必填 | P0 强制 | **P1 (仲裁)** |
| config.yaml SSoT | P2 | P1 | Reject | P2 | **P2 (降级)** |
