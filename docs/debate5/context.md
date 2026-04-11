# Debate #5 — Fresh-Eyes Spec Review

**Purpose**: stress-test `docs/compost-v2-spec.md` with fresh agents who have NOT read the 4 prior debates. The goal is to catch internal inconsistencies, missing pieces, and shippability gaps that a fresh reader would spot but an author or prior debater might miss.

**Scope**: single round, no cross-critique. Each agent reads the spec cold and gives independent feedback. Opus synthesizes.

**Decision rule**: if ≥ 2 of 3 agents say "YES, ship it" or "YES with minor required changes", the project proceeds to executing-plan mode. If ≥ 2 of 3 say "NO" or flag blocker-level issues, another round of targeted debate or rework is needed.

**What agents are NOT told**:
- That 4 prior debates shaped this spec
- What was contested / conceded / compromised
- Any author intent beyond what's written in the spec

They are told:
- What Compost is (one sentence)
- The spec file path
- The 5 questions they must answer

This simulates "a colleague hands you this spec and says we're about to start coding — what do you think?"
