<!-- long-run:v1 -->
# Program: {{PROGRAM_NAME}}
Status: active
Current: M1
Final: M3
Updated: {{RFC3339_TIMESTAMP}}
Detailed-plan: none
Native-goal: none unless explicitly requested and created

## Outcome

{{ONE_ACCEPTED_PARENT_OUTCOME}}

## Milestones

- [ ] M1 (1 pts): {{FIRST_ACCEPTED_MILESTONE}}
  - Depends-on: none
  - Acceptance: {{OBJECTIVE_ACCEPTANCE_CONDITION}}
  - Evidence: pending
- [ ] M2 (1 pts): {{SECOND_ACCEPTED_MILESTONE}}
  - Depends-on: M1
  - Acceptance: {{OBJECTIVE_ACCEPTANCE_CONDITION}}
  - Evidence: pending
- [ ] M3 (1 pts): Final acceptance
  - Depends-on: M2
  - Acceptance: All accepted outcomes and required receipts are complete.
  - Evidence: pending

## Work packets

### WP-M1-1: {{BOUNDED_PACKET_NAME}}
Parent: M1
State: active
Owner: main
Outcome: {{PACKET_OUTCOME}}
Scope: {{IN_SCOPE}}
Non-goals: {{OUT_OF_SCOPE}}
Dependencies: none.
Artifacts: {{EXPECTED_ARTIFACT_PATHS}}
Checks: {{EXACT_COMMANDS_OR_RECEIPTS}}
Authority: {{AUTHORIZED_ACTIONS_AND_BOUNDARIES}}
Stop: {{FIRST_REAL_AUTHORITY_OR_EXTERNAL_STOP}}
Next: {{ONE_EXECUTABLE_NEXT_ACTION}}

## Plan changes

- {{RFC3339_TIMESTAMP}} — Approved by: initial accepted request — Initial plan.
