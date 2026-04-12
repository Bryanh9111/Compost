# Debate 8: Phase 2 Plan — Round 2 Rebuttals

## 🔵 Sonnet
- Concedes FTS5 backfill miss
- Partial agree on BM25 fallback — unified interface, graceful degradation
- Concedes Opus's 3-batch ordering over own 2-subphase split
- Concedes lazy TTL to start, active later
- Acknowledges chunk→fact asymmetry needs fix

## 🟡 Gemini
- Concedes FTS5 backfill and web_fetch_state
- Defends lazy TTL but accepts table supports both models
- Proposes FTS indexing on chunks (not just facts) to resolve asymmetry
- Defends 2-phase over 3-batch as "user-centric value blocks"

## 🔴 Codex
- BM25 must be parallel retriever, NOT w8 ranking weight (corrects Sonnet)
- k=60 must be benchmarked, not folklore
- Lazy TTL too weak for freshness SLO
- Nobody fixes chunk→fact mapping — this is the real blocker
- Strict dependency order preserved regardless of batch/phase grouping

## 🟢 Opus
- Agrees chunk→fact is most important finding
- Fix: Python extractor outputs chunk_id→fact_ids[] mapping
- BM25 = Stage-0a parallel retriever (correct architecture)
- Active freshness loop is non-negotiable for product promise
- k benchmark required in DoD
