## 1. Top 10
1. 启动分诊｜源 src/myco/notes.py:2484-2509｜落 scheduler.ts+health｜法 信号表+队列｜M｜代 仍被动｜险 越权  
2. 决策审计｜源 docs/craft_protocol.md:214-240｜落 reflect.ts+decision_audit｜法 阈值+证据链｜S｜代 不可回放｜险 写放大  
3. 结构退化｜源 docs/open_problems.md:222-269｜落 reflect.ts+graph_snap｜法 CTE快照｜M｜代 看不到碎片化｜险 新fact误报  
4. 缺口跟踪｜源 src/myco/notes.py:1848-1962｜落 query/search.ts+gap｜法 0-hit落库｜M｜代 不知缺口｜险 噪声高  
5. 外部摄取队列｜源 src/myco/forage.py:66-89｜落 scheduler.ts+crawl_queue｜法 SQLite队列｜M｜代 抓取无状态｜险 预算失控  
6. 压缩压力｜源 src/myco/notes.py:1969-1997｜落 reflect.ts+wiki.ts｜法 pressure归档｜M｜代 噪声累积｜险 召回降  
7. 死知识理由｜源 src/myco/notes.py:831-969｜落 reflect.ts｜法 archive_reason｜S｜代 无法解释/复活｜险 误伤低频  
8. 四层仪表盘｜源 vision_recovery_craft_2026-04-10.md:197-221｜落 stats视图｜法 A/B/C/D聚合｜S｜代 缺统一观测｜险 空dashboard  
9. 写入gate｜源 docs/agent_protocol.md:88-105｜落 outbox/drain/wiki｜法 inline gate｜S｜代 脏数据入库｜险 过严阻塞  
10. procedural memory｜源 src/myco/evolve.py:89-135｜落 proc_mem+ask.ts｜法 只存稳定流程｜M｜代 重复踩坑｜险 无eval漂移

## 2. Reject
- `_canon.yaml`+29维 lint：重复 schema，制造双重真相。  
- `notes.py`/`immune.py` 大单文件：回归面大，难测。  
- `execute=true` 启动自执行：破坏 SQLite 单写者可预测性。  

## 3. A-J
- A modify：要摘要，不要自动执行。  
- B reject：文档 lint 重复 schema。  
- C modify：只取阈值与 audit。  
- D accept：直接服务 Phase4 图。  
- E accept：补 `reflect` 的缺口。  
- F modify：只沉淀到 procedure 表。  
- G accept：适合做 stats 面。  
- H modify：只做 `signal -> queue`。  
- I modify：用 `crawl_queue` 替代 manifest。  
- J modify：做批处理连续整理。

## 4. 独特视角
关键不是“更聪明”，而是可落地：所有自驱能力都应走 `signal -> row -> worker -> audit`，否则难测、难回放，也会先撞上单写者锁。
