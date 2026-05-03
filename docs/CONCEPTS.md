# Concepts

This document explains the mental model behind Compost. For a 5-minute
hands-on, see `docs/QUICKSTART.md`. For concrete data flow and failure
modes, see `docs/ARCHITECTURE.md`.

## What Compost is

Compost is a **personal AI brain and analysis partner** — not a tool, a
partner. Single-user, local-first, designed for 10+ year continuous
deepening of personal context. It is fork-template distribution: you
clone it empty, and over years it grows into something nobody else has.

Two sibling systems form the full stack:

- **Compost** (this repo) — the substrate. Full analysis, L4-L6 self
  evolution (autonomous curiosity, reasoning partner, user model),
  proactive push.
- **Engram** — the hippocampus. Zero-LLM fast recall, cross-project
  personal memory store. Started with work/task/company context,
  expands to all personal dimensions over time.

The two talk through a **bidirectional core channel** (not opt-in):
Engram's event stream feeds Compost as a new ingest source; Compost's
synthesized insights flow back to Engram as new entries. Either side
keeps working if the other is offline.

## The four storage layers

```
L0  observations        append-only ledger, the rebuild anchor
L1  chunks              text segments for retrieval
L2  facts               structured knowledge (subject, predicate, object)
L3  wiki_pages          LLM-synthesized topic pages
```

Every downstream layer is **derived** from L0. Delete L1-L3 and re-run
the pipeline, you get the same derived state. L0 is the only thing
that is irreplaceable — which is why provenance fields live there, why
it is append-only, and why the backup/audit commands start there.

## The six self-evolution levels

| Level | Name | Status | What it does |
|---|---|---|---|
| L1 | Passive ingest | shipped | outbox → drain → extract → store |
| L2 | Periodic tidy | shipped | `reflect` (decay, sensory GC, wiki rebuild) |
| L3 | Self correction | shipped | contradiction arbitration, correction events |
| L4 | Autonomous exploration | shipped (Phase 6 P0) | gap tracker, digest push, curiosity clustering, user-approved crawl queue, fact→gap matching (active suggestion), 18-tool MCP agent surface |
| L5 | Reasoning partner | historical trial path frozen in v4; on-demand `compost ask` retained | `runReasoning()` and verdict commands remain available for the existing `reasoning_chains` dataset. The background `startReasoningScheduler` loop is replaced by a stopped health stub in v4, so Compost no longer generates persistent wisdom chains automatically. Future metacognitive pattern work should build on `action_log` and sequential mining, not on background LLM chain growth. |
| L6 | User model + push | planned (Phase 7+) | knows your preferences / blind spots / goals, notifies you |

The shipped layers (L1-L3) are enough to be useful today. L4-L6 are
what make it an _analysis partner_ rather than a smart index.

## Observation: the rebuild anchor

An observation is an immutable record of something entering the
system. It carries enough provenance to reconstruct the rest.

```
observe_id         UUIDv7 (time-sortable primary key)
source_id          where it came from (file path, URL, session id)
source_uri         canonical URI
captured_at        when Compost saw it
occurred_at        when the event actually happened
content_hash       SHA-256 of the content itself
raw_hash           SHA-256 of the outbox payload envelope
origin_hash        SHA-256 of adapter|source_uri|idempotency_key   [Migration 0014]
method             ingest method: local-file / web-url / claude-code / ...
adapter            the writer that produced the row
idempotency_key    prevents double-ingest of the same event
metadata           JSON for adapter-specific context
```

The three hashes answer different questions:
- `content_hash` — "did the content change?"
- `raw_hash` — "did the envelope change?" (includes adapter context)
- `origin_hash` — "is this the same inlet?" (adapter + source + call id)

## Fact: the unit of knowledge

```
subject, predicate, object         a triple (typed but unconstrained vocabulary)
confidence                         how much the extractor trusts it (0..1)
importance                         how central it looks (0..1)
last_reinforced_at_unix_sec        decay clock
half_life_seconds                  per-fact half-life
observe_id                         FK back to the source observation
```

Facts inherit provenance from their `observe_id`. There is no fact
without an observation; orphan facts are a bug the integrity audit
catches.

## Decay: memory that fades

Every fact has an effective strength that decays by half each
`half_life_seconds` (default 30 days). Access reinforces:
reading a fact in a query resets the clock. This makes the system
behave like biological memory — things you use stay sharp, things you
forget actually fade.

Decay is applied at **read time** (stateless decay), not written into
the row. That means time-travel queries and what-if analyses are
cheap: pick a different `now`, get the state of the brain as of that
moment without rewriting anything.

## Transform policy: explicit ingest contract

Every observation records which `transform_policy` processed it. The
policy captures the extractor version, chunking rules, and embedding
model. When you change any of these, you bump the policy id — old
observations keep their old policy, new ones get the new one. This is
what makes migrations tractable: you can always identify which rows
were produced under which rules.

## Provenance chain end-to-end

```
source (registered URI)
  → observation (append-only, with origin_hash + method)
  → chunks (segmented for retrieval)
  → facts (triples extracted by the LLM)
  → wiki_pages (topic-level synthesis)
```

Every layer holds an `observe_id` FK back to L0. Every retrieval
result can be resolved to the observation that produced it. There are
no "virtual" facts — if `query` returns something, you can trace it to
a specific source.

## Bidirectional Compost ↔ Engram channel

Core, not opt-in. Anchored in the product identity v2 (debate
015-018 synthesis + user calibration 2026-04-16):

```
Engram events (fact lookups, remembered entries)  ─→  Compost
                                                      (ingest as
                                                       event-source observations)

Compost synthesized insights (wiki / triage / ask)  ─→  Engram
                                                        (insight entries with
                                                         source_trace + expires_at)
```

Either side runs without the other. Both together means Engram's
fast recall answers trivia and Compost's deep synthesis answers
questions that need cross-fact reasoning — without user input
choosing which to call.

## What Compost is not

- Not a database. Databases are lossless; Compost decays on purpose.
- Not a chatbot. `ask` is grounded retrieval, not generation.
- Not a SaaS. No server, no account, no sync.
- Not a community platform. Fork template: you get the code, you grow
  your own instance. No PRs accepted.
- Not an Engram replacement. Engram is the hippocampus, Compost is
  the analysis substrate. They are sibling systems, not alternatives.
