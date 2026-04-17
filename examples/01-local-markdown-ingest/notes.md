# Compost design notes

## Local-first architecture

Compost stores all knowledge in a single-user SQLite database plus a
LanceDB vector index. Both live under `~/.compost/`. No server, no
cloud, no account required. This makes the system auditable — every
fact can be traced back to an observation row in `observations`.

## Append-only observations

The `observations` table is write-once. An ingest run produces one new
row; the row is never edited in place. Facts, chunks, and wiki pages
are derived products rebuilt from the observations ledger.

## Provenance fields

Every observation carries three hashes: `content_hash` (the content
itself), `raw_hash` (the outbox payload), and `origin_hash` (the inlet
signature). Together they let you answer "where did this fact come
from and how did it enter the system" without storing the content in
a second place.

## Why decay

Memory without decay is a database. Compost uses time-aware ranking
so that infrequently accessed facts lose weight. The decay is
reversible — accessing a fact re-strengthens it.
