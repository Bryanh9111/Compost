# Debate 004: Phase 4 Week 1 Implementation Audit

**Type**: Small code audit before Week 2 starts
**Predecessors**: 001 (Myco) / 002 (roadmap) / 003 (readiness)
**Branch**: `feat/phase4-batch-d-myco-integration` @ commit `a4efbe2`

## Commits under audit

- `0b1dc7b` P0-7 backup/restore CLI + daemon scheduler
- `1370ba6` P0-0 fact-links TS API + recursive CTE
- `a4efbe2` P0-4 reflect.ts writes archive_reason + replaced_by

## Files to read (no guessing — actual code)

### P0-7 backup
- `packages/compost-core/src/persistence/backup.ts` (157 lines)
- `packages/compost-core/test/backup.test.ts` (211 lines, 16 tests)
- `packages/compost-cli/src/commands/backup.ts`
- `packages/compost-daemon/src/scheduler.ts:395-475` (startBackupScheduler)

### P0-0 fact-links
- `packages/compost-core/src/cognitive/fact-links.ts`
- `packages/compost-core/test/fact-links.test.ts` (28 tests)

### P0-4 archive_reason
- `packages/compost-core/src/cognitive/reflect.ts:113-188`
- `packages/compost-core/test/reflect-archive-reason.test.ts` (6 tests)

### Reference contracts
- `docs/ARCHITECTURE.md` "Phase 4 Pre-P0 contracts"

## R1 output structure (≤ 1000 字)

1. Top 5 issues (severity desc, file:line anchored)
2. Test coverage blindspots (≥ 2)
3. Performance concerns (≥ 1)
4. Week 2 ready? Go / Conditional Go / No-Go
5. One-liner caution (≤ 100 字)

## Hard rules

- No biological metaphors
- Must read actual code, no impressions
- Issues must have file:line
- Fixes must be actionable (no "should consider")
