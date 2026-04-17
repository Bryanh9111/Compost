## 排序
1. A: `length(content) <= 4000` 是足够保守的全局硬上限，能保住现有 7 条合法高价值长记忆，同时不把 archive/双路径复杂度提前写进当前单表 + 单 FTS 模型。
2. D: 它在工程效果上几乎等于 A 且能立即通过 migration，但把永久决策伪装成临时 TODO 只会制造文档债。
3. C: 截断主表并把原文移到 archive 会打破 `src/engram/db.py` 里 `memories` + `memories_fts` 的单一事实源，让迁移、双表查询和跨表召回都明显更复杂。
4. B: 2000 会直接拒绝当前已审计出的 7 条合法长记忆，而我没有看到来自 SQLite/FTS5 的硬技术依据能支持这种数据损失。

## Q1 (2000 字依据): 没有看到可信硬依据；从 SQLite/FTS5 官方行为看，FTS5 `bm25` 按 token 长度归一而不是按字符阈值工作，SQLite 行溢出也取决于 page size 与整行字节数而不是 `2000` 这个常数，所以 `2000` 最多只是经验值，不应当被当作不可违背的 schema 常量（https://sqlite.org/fts5.html, https://sqlite.org/fileformat.html）。另，Engram 当前并没有做过 2K vs 4K 的真实召回 benchmark，因此“2K 有明显检索优势”这件事未验证。

## Q2 (长记忆是否 anti-pattern): 不是天然 anti-pattern，但它必须是低频、经过整理、需要整块读取的例外；像 session handoff、debate outcome、spec 这类 `decision`/`procedure` 记忆在 Engram 里是合法的，而把原始日志、长聊天、wiki 式段落无限灌进主表才是 anti-pattern。

## Q3 (kind-specific length): 不建议把 kind-specific 长度写成 SQLite `CHECK`；`src/engram/store.py` 里的 dedup/recall 先用 Python 的空白 `.split()` 构 query，`src/engram/db.py` 的 FTS5 也没有自定义 tokenizer，字符数、字节数和 token 数在英文/CJK 下都不对齐，未来再改阈值还要 rebuild table，收益小于迁移成本。若真要区分 `kind`，更适合做应用层 soft lint，而不是 schema 层 hard constraint。

## 最终推荐: E
推荐 `全局 4000 字符硬上限 + 应用层 2000 软警告/提示拆分，不引入 archive 表，不做 kind-specific CHECK`。理由是 2K vs 4K 在 Engram 当前规模下没有已验证的召回断崖，而 4K 足以覆盖现有合法长记忆；同时在 SQLite 默认 4KB page 下，table leaf 本地 payload 上限约为 4061B、index 本地 payload 上限约为 1002B，4000 ASCII 字符已接近单页、4000 CJK 字符按 UTF-8 可推到约 12KB，因此 4K 更像“硬顶”而不是鼓励值。需要变更阈值时，直接按 SQLite 官方推荐走 rebuild-table 即可，不要把 archive 双表复杂度永久写进数据模型（https://sqlite.org/fileformat.html, https://sqlite.org/lang_altertable.html）。

```sql
CREATE TABLE memories (
    id            TEXT PRIMARY KEY,
    content       TEXT NOT NULL CHECK(length(content) <= 4000),
    summary       TEXT NOT NULL,
    kind          TEXT NOT NULL,
    origin        TEXT DEFAULT 'human',
    project       TEXT,
    path_scope    TEXT,
    tags          TEXT DEFAULT '[]',
    confidence    REAL DEFAULT 1.0,
    evidence_link TEXT,
    status        TEXT DEFAULT 'active',
    strength      REAL DEFAULT 0.5,
    pinned        INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL,
    accessed_at   TEXT,
    last_verified TEXT,
    access_count  INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    summary,
    tags,
    content='memories',
    content_rowid='rowid'
);
```

## Codex 独家警告
- `memories_fts` 是 external-content FTS，绑定的是 `memories.rowid` 而不是 `id`；如果以后 rebuild `memories` 时不保留 `rowid` 或不执行 FTS `rebuild`，搜索会静默失配。
- 不要把 “CJK 1 char ≈ 1 token” 当成当前 schema 的事实；FTS5 默认 `unicode61` 把连续 token 字符串当作一个 token，本地 SQLite 3.51.3 临时验证里 `你好世界` 是单 token，而 `store.py` 的 `.split()` 也会让无空格 CJK 查询退化成单词串。
