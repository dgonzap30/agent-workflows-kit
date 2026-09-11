<!-- long-run:v1 -->
# Program: Fixture complete program
Status: complete
Current: none
Final: M3
Updated: 2026-08-28T00:00:00-06:00
Detailed-plan: none

## Outcome

Prove deterministic completion with a checked local gate.

## Milestones

- [x] M1 (2 pts): Foundation accepted
  - Depends-on: none
  - Acceptance: Foundation receipt exists.
  - Evidence: `foundation.txt` reviewed
- [x] M2 (3 pts): Runtime adapters accepted
  - Depends-on: M1
  - Acceptance: Both adapters pass their smoke checks.
  - Evidence: `runtime-smoke.txt` reviewed
- [x] M3 (1 pts): Final acceptance completed
  - Depends-on: M2
  - Acceptance: Final gate and verification report are complete.
  - Gate: `.unlazy/gates/sample.md#G1`
  - Evidence: `.unlazy/gates/sample.md` G1 checked

## Work packets

### WP-M3-1: Final receipt
Parent: M3
State: complete
Owner: main
Outcome: Record final acceptance.
Scope: Fixture evidence only.
Non-goals: External provider verification.
Dependencies: M2.
Artifacts: `.unlazy/gates/sample.md`
Checks: G1 is checked with evidence.
Authority: Local fixture reads only.
Stop: Stop if G1 is unchecked.
Next: No action; fixture is complete.

## Plan changes

- 2026-08-28T00:00:00-06:00 — Approved by: fixture — Initial accepted plan.
