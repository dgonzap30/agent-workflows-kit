<!-- long-run:v1 -->
# Program: Fixture blocked program
Status: blocked
Current: M2
Final: M3
Updated: 2026-08-28T00:00:00-06:00
Detailed-plan: none

## Outcome

Prove deterministic progress for a blocked program.

## Milestones

- [x] M1 (2 pts): Foundation accepted
  - Depends-on: none
  - Acceptance: Foundation receipt exists.
  - Evidence: `foundation.txt` reviewed
- [ ] M2 (3 pts): Authority boundary resolved
  - Depends-on: M1
  - Acceptance: Required approval is recorded.
  - Evidence: pending
- [ ] M3 (1 pts): Final acceptance completed
  - Depends-on: M2
  - Acceptance: Final verification report is complete.
  - Evidence: pending

## Work packets

### WP-M2-1: Approval boundary
Parent: M2
State: blocked
Owner: main
Outcome: Obtain the authority required for the adapter edit.
Scope: The named configuration approval only.
Non-goals: Any configuration mutation before approval.
Dependencies: M1.
Artifacts: Approval receipt in the thread.
Checks: Confirm the granted path exactly matches the edit target.
Authority: Read-only inspection until approval.
Stop: Wait for the owner to approve the authority change.
Next: Resume the adapter edit after approval.

## Plan changes

- 2026-08-28T00:00:00-06:00 — Approved by: fixture — Initial accepted plan.
