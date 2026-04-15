# R1 Sonnet 012

1. Consumers: zero. corrected_text only written (correction-detector.ts:65,113,263; 0010.sql:118); findRelatedFacts uses retractedText. substring=vanity.
2. Naive: ~5 LoC+2 tests. Cheap but locks shape W5 may reject.
3. No leak: nullable, "optional, later turn". No reader=no reg.
4. `week5-with-week4-stub-removal`: drop field, re-add w/ consumer. P0-5 intact.

DONE_R1_012
