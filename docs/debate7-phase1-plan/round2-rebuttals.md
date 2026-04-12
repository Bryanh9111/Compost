# Debate 7: Phase 1 Plan Review — Round 2 Rebuttals

## 🔵 Sonnet — Rebuttal

- **Codex 重排序**: 部分同意。ingest bug 是真实的，但完整序列化 Phase 1 过于保守。bug 和 chunk table 可并行修复。
- **Codex chunk table**: 同意缺口存在，但建议收窄范围——在 derivation_run 加 source_chunk_hash + 新增 chunks 表，不需要独立抽象层。
- **Gemini ONNX**: 不现实。macOS ARM ONNX native bindings 不稳定，Phase 1 应该抛清晰错误而非静默降级。
- **Opus 4a/4b/4c**: 轻度 over-engineering。动机正确但拆成三个编号步骤把实现文档变成状态机。更简单：gate 4 注释明确 "operates on raw chunk"，gate 5 作为 extraction 后独立 validation pass。
- **确认共识**: FTS5 在 Phase 1、failure path audit、doctor --rebuild 集成测试。

## 🟡 Gemini — Rebuttal

- **layer bug**: 在 single-writer 模型下变得 trivial。单一权威进程管理 L1→L4 整个流程。
- **Atomic rebuild**: 需要创建 L1 manifest 来构建新版本，因此 by design 解决了 Codex 的 chunk table 问题。
- **Gate 4 timing**: Single-writer 保证 noteworthiness check 在 facts 写入之后运行，消除 race condition。
- **json_each**: 同意 Sonnet，更优雅的方案。
- **ONNX**: 坚持。不是 premature optimization，是分发的基础保障。

## 🔴 Codex — Rebuttal

- **Opus 4a/4b/4c**: 必要的局部修正，但不替代整体重排序。还需要 L1 metadata 才能完整。
- **Sonnet json_each**: 不完全正确。Stage-1 返回 (fact_id, semantic_score)，Stage-2 需要 JOIN 两个值。json_each 只能传一维数组，temp table 在这个场景下是正确设计。
- **Gemini ONNX**: 接口抽象正确，ONNX 实现是 scope creep。先发一个 provider behind interface。
- **Chunk table**: 没有人正面解决。derivation_run 不够——需要 chunk 级 (observe_id, transform_policy, chunk_id) 元数据。
- **SLO benchmark**: 支持 Opus 的 100K fixture 提案，但 corpus 必须包含 filenames、symbols、dates、error strings。

## 🟢 Opus — Rebuttal

- **Codex chunk table**: 同意核心论点。接受 Sonnet 的实现方案：chunks 表 + derivation_run 扩展。
- **Codex temp table 辩护**: 正确。json_each 无法携带 per-candidate scores，temp table 是正确设计。
- **Gemini ONNX**: Phase 1 不做。EmbeddingService 接口做。
- **SLO corpus**: 接受 Codex 补充——必须混合 prose + structured data (code, dates, errors)。
