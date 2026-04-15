# Debate 010 R1 — Gemini (LLM Failure Modes / Security)

## 1. Top 4 缺陷

### 1.1 `circuit-breaker.ts:102` — Half-open 状态下的并发饥饿 (Concurrency Starvation)
- **描述**: 当 Breaker 进入 `half-open` 并在等待第一个 probe 调用返回时，**所有**其他并发调用都会立刻 throw `CircuitOpenError`。
- **风险**: 对于耗时较长的 LLM 调用（如 `wiki.ts` 的全量重建，可能耗时 >10s），这会导致 Breaker 实际上保持了更久的 "Open" 状态。用户简单的 `ask` 查询会因为一个后台的 wiki 重建正在 probe 而被错误地拒绝服务。
- **修复**: 在 `half-open` 时，允许少量（如 2-3 个）并发 probe，或者优先让短任务（`ask`）作为 probe，而非长任务（`wiki`）。

### 1.2 `ask.ts:186-198` — 异常吞噬导致诊断困难
- **描述**: `ask` 函数捕获了 `answerLLM.generate` 的所有异常并返回 `[LLM unavailable]`。
- **风险**: 它无法区分 "LLM 暂时超时"、"Breaker 已熔断" 还是 "API Key 错误"。在 `half-open` 状态下（见 1.1），用户看到的是 fallback，完全不知道是因为 Breaker 正在尝试恢复。这种“软失败”虽然保证了可用性，但由于缺乏对 `CircuitOpenError` 的显式日志记录，给 SRE/开发者留下了运维黑洞。
- **修复**: 至少在 `log.warn` 中区分 `CircuitOpenError` 和普通 `Error`。

### 1.3 `scheduler.ts:121` — Wiki Hook 异常隔离不足
- **描述**: 虽然有 `try-catch` (line 123)，但 `synthesizeWiki` 内部并没有对单个 topic 的细粒度保护。
- **风险**: 如果某个 wiki topic 触发了 LLM 的特殊拒绝（例如敏感词被拦截导致 400 错误），当前的 `synthesizeWiki` 可能会直接中途 crash，导致后续的所有 topic 都不被更新。尽管 scheduler 循环不会停，但 wiki 状态会整体卡死。
- **修复**: `wiki.ts` 内部循环应有 try-catch，并在 `wiki_pages.stale_at` 中记录失败时间。

### 1.4 `cross-p0-integration.test.ts` — 缺乏“真实抖动”模拟
- **描述**: Day 4 的集成测试全部基于 `MockLLMService`。
- **风险**: `MockLLMService` 无法模拟 TCP 502、Ollama 的排队延迟（Queuing latency）以及 Partial Response (Streaming failure)。
- **修复**: 应增加一个 `OllamaIntegration` 测试类（默认 skip，手动开启），验证在真实高负载/连接重置下的 Breaker 表现。

## 2. Tech Debt 清单

1.  **Union Signature Hack (`ask.ts:62`, `wiki.ts:207`)**
    - **位置**: `LLMService | BreakerRegistry` 的参数类型。
    - **Cost**: 每次增加新的 LLM 包装器（如 Retry/RateLimit）都要在所有调用处增加 `instanceof` 分配。
    - **Benefit**: 消除类型分歧，实现统一的 `ILLMProvider` 接口。
    - **推迟**: Week 4 OK。

2.  **`CircuitBreaker` 并发测试的时钟依赖 (`circuit-breaker.test.ts:179`)**
    - **位置**: 测试中使用 `setTimeout(30)`。
    - **Cost**: 在 CI 环境中（如 GitHub Actions）30ms 可能不足以完成线程切换，导致测试 flaky。
    - **Benefit**: 使用 `FakeTimers` 彻底消除非确定性。
    - **推迟**: Pre-PR 必须修复。

3.  **Self-Consumption 路径正则的跨平台性**
    - **位置**: `CircuitBreakerLLM` 内部正则。
    - **Cost**: Windows 用户（虽然不是首选）可能无法触发 self-consumption 拦截，导致死循环。
    - **Benefit**: 支持 `\` 路径。
    - **推迟**: Week 5 (Windows Support Phase)。

## 3. 契约偏离

1.  **`ARCHITECTURE.md:280` vs `scheduler.ts:101`**:
    - 文档说 `startReflectScheduler` 接受 `{ llm, dataDir }`，但代码中 `llm` 是 optional 的且命名为 `ReflectSchedulerOpts`。虽然功能对齐，但参数解构的文档描述略显滞后。
2.  **`ROADMAP.md` 风险表 (Row 5)**:
    - 提到 "reconstructConfidenceTier float equality" 风险。但在 `audit.ts` 相关的比较中，依然没看到显式的 `EPSILON` 比较。

## 4. Merge-blocker vs Nice-to-have

-   **Merge-blocker**:
    1.  `ask.ts` 的 fallback 必须至少输出一条 `console.warn` 包含 `err.message`，否则无法排查 Breaker 状态。
    2.  `circuit-breaker.test.ts` 的 `setTimeout(30)` 必须改为更稳定的同步 Mock 时钟或增加间隔。
-   **Nice-to-have**:
    1.  Refactor `LLMService | BreakerRegistry` 为统一接口。
    2.  Wiki topic-level 隔离。

## 5. 一句话总评
Week 3 完成了高难度的 Breaker 注入，但在 `half-open` 状态的并发语义处理上过于粗犷，存在“长任务饿死短任务”的风险；代码健壮性已达标，但运维透明度（Error Visibility）仍需在 Pre-PR 阶段补强。

DONE_R1_010
