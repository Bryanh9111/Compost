# R1 — 🟡 Gemini (Ecosystem / Long-term / Security)
### 1. Top 5 问题 (按严重度降序)

*   **问题**: `restore` 缺乏进程内并发保护，可能导致数据库损坏。
    *   **触发场景**: 在同一个进程中（如 Daemon 内部或集成了 core 的应用）调用 `restore` 时，若仍有活动的 SQLite 连接句柄未关闭，直接覆盖文件会导致 WAL 模式下的数据库状态不一致。
    *   **影响**: 数据损坏 (Data Corruption)。虽然 CLI 有 PID 检查，但 `compost-core` 作为库未在底层强制执行此安全约束。
    *   **修复**: `packages/compost-core/src/persistence/backup.ts:109`
        ```typescript
        // 在 restore 开始处添加：
        if (existsSync(targetPath)) {
          try {
            // 尝试以独占模式打开，若失败说明文件被占用
            const lockDb = new Database(targetPath, { readonly: false });
            lockDb.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; ROLLBACK;");
            lockDb.close();
          } catch { throw new Error("target database is in use by another connection"); }
        }
        ```

*   **问题**: Wiki 重建逻辑无法感知因 Sensory GC 导致的事实缺失。
    *   **触发场景**: `reflect.ts` Step 1 执行 Sensory GC 删除 7 天前的事实后，`wiki.ts` 的 `findTopicsNeedingSynthesis` 仅根据**现有**事实的 `MAX(archived_at, created_at)` 判断。
    *   **影响**: Wiki 内容失效 (Stale Data)。被删除的事实依然会留在旧的 Wiki 页面中，直到该 Topic 有新事实产生。
    *   **修复**: `packages/compost-core/src/cognitive/wiki.ts:25`
        ```sql
        -- 修改子查询，加入对 topic 对应事实总数变化的追踪
        -- 或在 reflect.ts Step 1 后显式标记受影响的 topic 为 stale
        UPDATE wiki_pages SET last_synthesis_at = '1970-01-01' WHERE title IN (SELECT DISTINCT subject FROM facts_deleted_in_last_gc);
        ```

*   **问题**: 冲突仲裁 (Contradiction Arbitration) 未实现 "Multi-source" 权重策略。
    *   **触发场景**: 当两个冲突事实的 `confidence` 和 `created_at` 完全一致时，逻辑退化为 `fact_id` 随机对比。
    *   **影响**: 决策质量下降。偏离了 `docs/ARCHITECTURE.md` 和 Debate 9 约定的 "multi-source > recency" 原则。
    *   **修复**: `packages/compost-core/src/cognitive/reflect.ts:141`
        ```sql
        -- 修改 SQL 加入对 source 计数的对比
        JOIN (SELECT observe_id, COUNT(*) as src_count FROM observations GROUP BY observe_id) o1 ON f1.observe_id = o1.observe_id
        -- 在 ORDER/CASE 中优先对比 src_count
        ```

*   **问题**: `fact-links` 递归 CTE 的环路检测在大规模图结构下性能呈 $O(N^2)$ 衰减。
    *   **触发场景**: 当图深度增加或存在复杂环路时，使用字符串 `INSTR` 进行路径匹配会导致 SQLite 查询计划器压力剧增。
    *   **影响**: 性能。随着 Facts 达到 10^5 级别，`traverse` 将成为系统瓶颈。
    *   **修复**: `packages/compost-core/src/cognitive/fact-links.ts:178`
        ```typescript
        // 建议在 maxDepth > 5 时，弃用 CTE 改为在内存中进行 BFS，利用 Set<string> 进行环路过滤。
        ```

*   **问题**: 备份调度器 (Backup Scheduler) 存在潜在的重复执行或漂移风险。
    *   **触发场景**: `scheduler.ts:462` 在成功备份后使用了 `Bun.sleep(BACKUP_INTERVAL_MS - 60_000)`，这与循环开头的 `msUntilNextWindow()` 计算逻辑冗余且可能因系统时钟漂移导致跳过或提前进入下一个窗口。
    *   **影响**: 运维可靠性。虽然不影响数据安全，但会导致备份日志出现不确定性。
    *   **修复**: `packages/compost-daemon/src/scheduler.ts:462`
        ```typescript
        // 移除冗余的 sleep，仅保留 loop 开头的 msUntilNextWindow 等待逻辑。
        await Bun.sleep(60_000); // 仅退出当前分钟窗口，确保下次计算 msUntilNextWindow 时已跨过当前时间
        ```

### 2. 测试覆盖盲点

*   **多进程/多连接恢复冲突测试**:
    *   **缺什么**: 验证当数据库正在被 `query` 或 `reflect` 占用时，执行 `restore` 是否会抛出预期的错误或导致损坏。
    *   **文件**: `packages/compost-core/test/backup.test.ts`
    *   **断言**: `expect(() => restore(snap, activeDbPath)).toThrow()`。

*   **Sensory GC 后的 Wiki 一致性测试**:
    *   **缺什么**: 验证当一个 Topic 的所有事实都是 Sensory 且被 GC 后，Wiki 是否能正确反映“无内容”或被更新。
    *   **文件**: `packages/compost-core/test/wiki.test.ts` (需新建)
    *   **断言**: `expect(findTopicsNeedingSynthesis(db)).toContain(gcTopic)`。

### 3. 性能担忧

*   **场景**: `connectedComponents` 在全量 Facts 上的 Union-Find 操作。
*   **规模**: 1M Facts + 5M Links。
*   **担忧**: 目前在内存中构建 `Map<string, string>` 存储父节点。100万个 UUID 字符串作为 Key 约占用 200MB+ 内存，加上 Links 的迭代，GC 压力巨大。
*   **建议**: 在 `packages/compost-core/test/benchmark/graph.bench.ts` 添加针对大规模连通分量计算的基准测试。

### 4. Week 2 Conditional Go

*   **条件 1**: 修复 `restore` 的原子性/并发保护，禁止在有活跃连接时覆盖文件。
*   **条件 2**: 修正 Wiki `stale` 检测算法，确保删除事实（Sensory GC）能触发重绘。
*   **条件 3**: 完善 `reflect.ts` 中的冲突仲裁 SQL，按约定引入多源计数。

### 5. 一句话告诫

事实归档 (Archive) 是系统的“遗忘”机制，若查询层 (Query) 与清理层 (Reflect) 的过滤步调不一致（如 Wiki 漏掉 GC 信号），会导致系统产生“幻觉”或数据残留，破坏 Fact-Link 图的整体一致性。

DONE_R1_004
