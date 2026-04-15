## 1. 共识合并
- `fact_links`是P0-3前置。Sonnet说`snapshot`会撞约束，Opus说17项会膨胀，我R1已称其为假交付。
- Batch D多项仍是stub。Sonnet砍dashboard，Gemini要`correction_events`先进triage，不应直改事实。
- Backup/DR缺失。Sonnet提`VACUUM INTO`，Opus提24h备份，我R1提`doctor`恢复。

## 2. 真分歧
- 反对Opus整砍Phase 5；应砍`HTTP transport`和`multi-host concurrency`，保留`export/import`。
- 反对Gemini先做`triage`；没有`archive_reason`/`decision_audit`/`fact_links`，它只读空信号。

## 3. 仲裁
- A: 17→11。砍P4 `crawl_queue`/`dashboard`/`memory_procedural`；砍P5 `HTTP transport`/`multi-host concurrency`；砍P6 `video`/`PDF`。
- B: `graph_health`后移，`fact_links`升P0-0。
- C: Backup/DR进Pre-P0。

## 4. 最终P0
1. `fact_links`
2. `backup/restore`
3. `archive_reason`
4. `decision_audit`
5. `correction_events`
6. `triage`
7. `graph_health`

## 5. 自我修正
- 我R1把Backup/DR写成跨phase；现改判为Pre-P0。
