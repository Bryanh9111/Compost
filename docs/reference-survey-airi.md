# Reference Survey — airi *(removed for open-source)*

> The full content of this comparative survey was part of internal research
> and was removed before open-sourcing Compost. The original file described
> the airi agent project's memory architecture for comparative design purposes.
>
> This stub preserves the file path so that existing references in
> `debate4/` (and any other document citing this survey) do not become
> broken links.

## What this document originally contained

A detailed comparative survey of the **airi** project's memory subsystem:

- Storage schemas (memory_fragments, memory_episodic, memory_long_term_goals, memory_short_term_ideas)
- Recall ranking formulas
- Context store architecture
- Consciousness / spark-notify orchestration loops

Compost's ranking formula (§debate4) borrowed a few ideas from airi's
bounded two-factor approach — that inheritance is documented in
`docs/debate4/synthesis.md` and `packages/compost-core/src/query/`.

## Where to look for the same information today

- [airi project on GitHub](https://github.com/moeru-ai/airi) — public upstream source
- `packages/compost-core/src/query/` — Compost's final implementation

## If you need the original internal survey

It is not published. The original was a private reading-notes artifact with
paths into a local research collection; both the paths and the structured
comparison were removed before open-sourcing.

## Broken-link targets (do not chase these)

Sections and line numbers referenced by name but no longer present here:

- `§1 line 95-103`, `§Storage Backends`, `:81-102`, `:95-102`
- Any `airi/services/...` or `airi/packages/...` path mentioned in older
  debate rounds — those paths were from a private research clone and
  should be read as "see the upstream airi repo, explore the equivalent
  code path there"
