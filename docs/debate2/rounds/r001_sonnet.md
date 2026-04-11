# Sonnet — D3+Policy

## D3: Holding Hybrid

Pure Node/Bun is impossible today. Here is the one scenario that kills it:

A user drops a research paper PDF — say, an arXiv preprint with LaTeX-rendered equations, multi-column layout, and embedded tables — into `~/.compost/inbox/`. Node's options are `pdf.js` (a renderer: it gives you character spans with XY coordinates, no table structure, no formula semantics) or `pdf-parse` (text extraction only, destroys all structural information). Neither produces a structured representation of that table. `docling` does: it runs layout detection, identifies table cells, preserves row/column structure, and outputs clean Markdown or JSON-with-bounding-boxes. The resulting L2 facts from that table are meaningless noise under Node vs. accurate structured knowledge under docling.

That is not a capability gap that closes next week. `pdf.js` is a viewer library. The Node ecosystem has no production-grade structural PDF parser in 2026. The subprocess boundary is clean — Node calls `compost-ingest extract --input /path/to/file.pdf --policy tp-2026-04` and reads JSON on stdout. Same as calling `ffmpeg`. This is not architectural debt; it is the correct tool for the job.

Boundary stays: Python owns `compost-ingest/` as a subprocess CLI. Node owns everything else. `uv.lock` committed, schema contract test on every Python dep bump.

## transform_policy: Date-stamp, not semver

`tp-2026-04-02` is what I want at 2am.

At 2am, the question is: "why did the rebuild on Tuesday produce different facts than the one on Monday?" The answer is in the policy that was active during each run. A date-stamp tells me immediately — `tp-2026-04-02` shipped April 4th, `tp-2026-04` shipped the week before. I can `git log --since="2026-04-04"` and see what changed in the registry. Semver `tp-1.1.0` tells me nothing about when it shipped or what era of prompts it represents. A git SHA is opaque — I have to look up `tp-a3f8b21` in registry.ts to understand the policy's generation context.

"Backward-compat" is meaningless for policies. Policies are immutable config snapshots, not APIs. Semver's compatibility semantics don't apply. Date-stamp is honest: it says "this is the configuration we ran in April 2026" and nothing more. That is exactly what the operator needs when auditing why two ingestions of the same document produced different facts.

Convention: `tp-YYYY-MM` default, `tp-YYYY-MM-NN` for in-month revisions. NN is a counter, not a date. Keep it.
