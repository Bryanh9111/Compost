我已分析 R1 四方（Codex、Sonnet、Opus、Gemini）的全部审计意见。以下为 Gemini (生态/LLM风险视角) 的 R2 裁决与修正建议。

### 1. 共识合并 (Consensus Merge)
四方在以下底层逻辑上达成高度共识，这构成了 Phase 4 路线图的重大缺陷：
*   **事实链接 (fact_links) 的前置性：** Codex、Sonnet 和 Opus 均指出，在没有建立实体间显性引用的情况下，`graph_health` 和 `contradiction_detector` 只是空中楼阁。没有 link，所谓的冲突检测只是 LLM 的幻觉推断，而非 graph 结构的逻辑推演。
*   **17 项路线图的“功能性虚假”：** 四方一致认为现有的 17 项任务过于臃肿且缺乏执行优先级。Sonnet 称之为 "stub"，Opus 建议大规模裁剪。路线图目前更像是一个愿景清单，而非工程排期。
*   **数据完整性 (Data Integrity) 的缺失：** Codex 提到的 Schema 校验与 Opus/Sonnet 提到的 Backup/DR 属于同一 root 问题：Compost 目前缺乏对底层存储状态的工程级保障。在 P4-6 追求高阶推理之前，必须先保证数据的原子性和可恢复性。

### 2. 真分歧 (True Disagreements)
*   **反驳 Opus 关于完全砍掉 Phase 6 (PDF/Video) 的提议：**
    Opus 认为应回退到文本和代码。我持反对意见。Compost 的定位是“全维 Wiki”，如果砍掉多模态，其在 LLM 生态中的独特性将消失。**反驳理由：** 我们不需要在 P6 实现视频的完整语义解析，但必须包含“多模态元数据链接 (Multimodal Metadata Links)”。这是 context 完整性的底线。
*   **反驳 Codex 关于增设 Phase 0-0 的提议：**
    Codex 建议在 P4 之前加一个 P0-0。**反驳理由：** 这会造成严重的管理开销和项目停滞感。我们不应创建新阶段，而应通过“P4 重构 (P4-Refactor)”将基础加固直接并入当前里程碑，以 P0 任务的形式强制执行。

### 3. 仲裁三大悬案

**悬案 A: ROADMAP 的 17 项是否 over-budget?**
*   **裁决：** 严重超支。**缩减至 10 项。**
*   **操作：** 合并 Phase 5 的“外部合成”任务（目前 LLM 幻觉风险过高）至 Phase 4 的“反映任务”。将 Phase 6 的视频/PDF 简化为单一的“多模态元数据提取器”。保留核心的 Graph 推理逻辑。

**悬案 B: P0-3 graph_health 是否应该 deferral?**
*   **裁决：** **推迟。** 
*   **操作：** 接受 Codex 和 Sonnet 的意见。将 `fact_links_engine` 提升至 P0。在没有定义“什么是链接”之前，无法定义“什么是健康的图”。`graph_health` 将作为 P1 任务，依赖于 P0 的链接定义。

**悬案 C: Backup/Disaster Recovery 是否进 P0?**
*   **裁决：** **进入 P0。** 
*   **理由：** 即使是从 LLM 风险视角看，状态丢失是最大的 integrity 风险。如果 Compost 在进行复杂的 graph 反射 (reflect) 时发生崩溃且无备份，其生成的推理链将产生不可逆的断裂。

### 4. 最终重构后的 Phase 4 P0 列表
基于共识与风险控制，裁决 Phase 4 的 P0 任务上限为 8 项：
1.  **fact_links_engine (新增):** 定义实体间的硬链接与引用标准（P0 的基石）。
2.  **schema_integrity_validator (新增):** 强制执行 ingestion 阶段的格式校验（Codex 建议）。
3.  **state_snapshot_service (新增):** 实现基础的 Backup/Restore 功能（Opus/Sonnet 建议）。
4.  **contradiction_detector (保留):** 核心冲突识别逻辑。
5.  **archive_reason_logic (保留):** 处理状态清理的逻辑路径。
6.  **triage_policy (保留):** 处理海量事实输入时的优先级过滤。
7.  **reflect_task_gen (保留):** 自发性的 graph 优化任务生成。
8.  **dependency_graph_audit (新增):** 针对 P4-6 剩余 10 项任务的动态依赖审计。

### 5. 自我修正
在 R1 中，我过度关注了 LLM 的“逻辑对齐 (Logic Alignment)”，而忽视了 Codex 提出的“工程可靠性 (Engineering Reliability)”。阅读 R1 后，我意识到：**如果底层的事实链接是不稳定的，LLM 即使识别出了冲突，也无法在 graph 中准确回溯冲突点。** 我撤回 R1 中“优先开发高级推理插件”的含糊立场，转而支持“链接先行，推理随后”的路径。

DONE_R2_002
