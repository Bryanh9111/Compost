# Debate 7: Phase 1 Execution Plan Review — Round 1 Opening Arguments

## 🔵 Sonnet — Opening Argument

**实事求是：这个 10-step 计划有几个真实的 gap，会在 Phase 2 留下痛苦的债务。**

### 1. 最严重：Step 4 漏掉了 is_noteworthy() gates 4+5
计划里 Step 4 完全没提 noteworthy.ts 的 gates 4+5 修复。gate 4 需要先有 embedding service（Step 2）才能实现。建议在 Step 4 后面明确加：noteworthy.ts gates 4+5 实现。

### 2. Step 3 的 proper-lockfile：过度工程
Phase 1 的写入路径只有一条——串行的，没有并发写竞争。建议推迟到 Phase 3。

### 3. Step 6 的 Stage-1→Stage-2 bridge：temp table 性能陷阱
用 json_each() 或 IN 参数化查询替代 temp table，对于 top-K（50-200）快一个数量级。

### 4. BM25 应该在 Phase 1 建 FTS5 索引
Phase 2 才建则需要全量 rebuild。Phase 1 就建索引但 weight=0.0。

### 5. Step 7 缺少 failure path 的 audit log
LanceDB 查询超时时应记录失败原因和实际延迟。

### 6. Step 8 的 doctor --rebuild 需要集成测试
构造 L0/L1 不一致场景并验证修复。

---

## 🟡 Gemini — Opening Argument

### 1. Decouple from Ollama to Ensure Portability
Ollama 是重量级外部依赖。应建 EmbeddingService 接口 + 纯进程内 fallback（如 ONNX runtime）。

### 2. Enforce Single-Writer Architecture
compost-core (Bun) 必须是所有 DB 写入的唯一 owner。Python 是纯数据转换器。消除 proper-lockfile 需求。

### 3. Guarantee Consistency with Atomic Rebuilds
doctor --rebuild 应先建新索引到临时位置，完成后原子 swap。零停机重建。

### 4. Explicitly Integrate BM25 via SQLite FTS5
Phase 1 就实现 FTS5，query 从一开始就做 hybrid 查询。

---

## 🔴 Codex — Opening Argument

### 1. ingest.ts layer='L1' 标错
Line 132 应该是 L2（facts），不是 L1（embeddings）。影响 doctor --rebuild 范围判断。

### 2. 没有 L1 manifest / chunk 表
没有 (observe_id, transform_policy, chunk_id) → LanceDB row 的持久映射。rebuild 和 reconcile 无法工作。

### 3. 缺少 BM25/FTS5 混合检索
ANN-only 对 code symbols、日期、文件名、error strings 不够。SLO 目标下 hybrid 不是可选的。

### 4. is_noteworthy gates 4+5 缺失
近似重复内容会膨胀 vector store，降低 ranking 质量。

### 5. 库边界约束违反风险
Ollama/LanceDB adapter 需要显式接口，否则 kb-core "纯库" 约束被侵蚀。

### 建议：重排 Phase 1
Fix ingest correctness → Add L1 metadata model → Add hybrid retrieval → Wire embeddings/rebuild/audit/feedback.

---

## 🟢 Opus — Opening Argument

### 1. derivation_run.layer 标错
ingest.ts:132 写 layer='L1'，但提取的是 facts (L2)。必须在 Step 4 前修复。

### 2. facts INSERT 是前置条件
Step 4 把三件事混在一起。正确顺序：4a facts INSERT → 4b embedding 生成 → 4c LanceDB 写入。

### 3. BM25/FTS5 应在 Phase 1 建索引（weight=0）
避免 Phase 2 全量 rebuild。

### 4. proper-lockfile 范围错误
LanceDB v0.27+ 已有原子 manifest。真正需要 lock 的是 rebuild 期间阻止写入。用 SQLite advisory lock。

### 5. SLO 验证缺失
需要 100K facts fixture 生成器 + benchmark harness + CI latency gate。

### 6. compost.feedback 范围不清
建议仅设置 result_selected=TRUE，不做 RLHF。

### 7. is_noteworthy gate 4 的实现细节
gate 4 在 drain 阶段调用，此时 fact 还没写入。只能比较 raw text chunks 的 embedding。
