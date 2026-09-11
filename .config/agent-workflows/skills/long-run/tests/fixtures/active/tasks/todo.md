<!-- long-run:v1 -->
# Program: Fixture active program
Status: active
Current: M2
Final: M3
Updated: 2026-08-28T00:00:00-06:00
Detailed-plan: none

## Outcome

Prove deterministic progress for an active program.

## Milestones

- [x] M1 (2 pts): Foundation accepted
  - Depends-on: none
  - Acceptance: Foundation receipt exists.
  - Evidence: `foundation.txt` reviewed
- [ ] M2 (3 pts): Runtime adapters accepted
  - Depends-on: M1
  - Acceptance: Both adapters pass their smoke checks.
  - Evidence: pending
- [ ] M3 (1 pts): Final acceptance completed
  - Depends-on: M2
  - Acceptance: Final verification report is complete.
  - Evidence: pending

## Work packets

### WP-M2-1: Codex adapter
Parent: M2
State: active
Owner: main
Outcome: Codex discovers and mirrors the program.
Scope: Codex global routing and fresh-session smoke.
Non-goals: Claude configuration.
Dependencies: M1.
Artifacts: `analysis/codex-smoke.txt`
Checks: Fresh read-only Codex classification.
Authority: Local configuration edits only.
Stop: Stop if the target file changed after its recorded hash.
Next: Add the bounded Codex routing block.

## Plan changes

- 2026-08-28T00:00:00-06:00 — Approved by: fixture — Initial accepted plan.
