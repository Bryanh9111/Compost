# Debate 8: Phase 2 Plan — Round 1 Opening Arguments

## 🔵 Sonnet
- 2 sub-phases: A (temporal+BM25, no LLM) and B (web+wiki+ask, needs LLM)
- RRF k=60, BM25 weight as w8 in ranking_profile
- Web as new adapter, freshness loop in scheduler
- LLMService interface + Ollama default
- ask = query() + wiki + LLM
- 5 concrete steps with independent PRs

## 🟡 Gemini
- Phase 2a (core retrieval) and 2b (intelligence+reach)
- RRF for merge, against manual weight tuning
- Lazy TTL-driven refresh, not aggressive cron
- Local-first LLM (Ollama default), API optional
- ask = RAG pattern over query()
- Strict latency budget for Phase 2a

## 🔴 Codex (strongest Round 1)
- FTS5 has no backfill for pre-existing facts — silent correctness bug
- query() gated on vectorStore — BM25 can't be fallback
- ANN chunk-level vs BM25 fact-level asymmetry
- Web needs fetch-state table, not just source.refresh_sec
- New transform_policy required for web (tp-2026-04-02)
- ask must not be second retrieval system
- Strict ordering: w2 → BM25+backfill → web+fetch-state → wiki → ask

## 🟢 Opus
- 3 batches: A (algorithm), B (web I/O), C (LLM layer)
- Agreed with Codex on FTS5 backfill, fetch-state, tp-2026-04-02
- BM25 as independent fallback when LanceDB unavailable
- Wiki synthesis triggered by reflect scheduler
- ask = query + LLM (not independent retrieval)
- LLM budget: local Ollama default, per-query cost cap in policy
