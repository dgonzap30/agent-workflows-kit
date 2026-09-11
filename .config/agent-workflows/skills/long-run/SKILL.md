---
name: long-run
description: Orchestrate explicitly long, autonomous, multi-session, or campaign-style tasks with a durable parent plan, bounded work packets, evidence-weighted progress, sparse lifecycle updates, and exact resume state. Use when the user requests long-running execution or when at least two continuity signals make compaction, handoff, cross-surface coordination, or parent-scope loss likely; skip ordinary bounded work and existing project protocols that already provide equivalent guarantees.
---

# Long-running task orchestration

Keep the accepted parent outcome visible and provable while leaf work changes. This skill governs persistence, not risk classification, worker count, or authority.

## Classify

Invoke this skill when either condition is true:

1. The user explicitly asks for long-running, autonomous, multi-day, resume-safe, campaign-style, or keep-going-until-done execution.
2. At least two continuity signals apply:
   - three or more dependent phases or durable work packets;
   - likely compaction, pause, handoff, or another session;
   - multiple repositories, runtimes, devices, services, or external waits;
   - multiple independently verifiable substantive deliverables converging on one outcome;
   - a watcher, review, or release leaf could obscure the parent objective.

Two substantive signals are the adoption point; turn count or exhaustive wording alone is insufficient. Invoke the skill in that same turn before more substantive exploration, dispatch, or waiting; do not defer until compaction. A deterministic lifecycle hook may surface accumulated signals, but the agent remains responsible when the hook is unavailable.

Upgrade an active task when it reaches compaction without durable parent state, needs a second material replan, lets an asynchronous wait displace the original work, or cannot safely finish the parent outcome in the current session.

Skip ordinary bounded work, regardless of step or file count. If a project-native protocol already provides the same parent plan, evidence-weighted progress, work packets, and resume guarantees, use it and add only any missing runtime mirror.

## Preserve authority

Apply the existing risk lane independently. This skill does not authorize writes, agents, credentials, production changes, destructive actions, privacy access, or releases.

Authority remains:

1. system, user, safety, and explicit authorization;
2. nearest project instructions and accepted specifications;
3. detailed OpenSpec, Superpowers, issue, or release plans;
4. `tasks/todo.md` as the program index and current execution truth;
5. leaf artifacts and evidence;
6. native plan or task tools as UI mirrors.

Link higher-authority artifacts instead of duplicating them. Unlazy remains the evidence-backed closure layer when its trigger applies; reference its gates from milestones instead of replacing them.

## Establish the parent

For writable repository or project work:

1. Read existing project instructions and plan artifacts.
2. Create or reconcile `tasks/todo.md` from [templates/program-plan.md](templates/program-plan.md).
3. State one accepted parent outcome.
4. Define contiguous milestones `M1` through `Mn`; make the last milestone `Final`.
5. Assign positive integer points by relative acceptance weight, not effort or ETA.
6. Set `Current` to the first unmet milestone whose dependencies are earned.
7. Add bounded work packets for substantial leaves.
8. Run the validator before showing a percentage.

When the runtime exposes native Goals, create one only if the user explicitly requested a goal or an explicit long/autonomous outcome with a measurable terminal condition. Create it once at program initialization, keep detailed acceptance in `tasks/todo.md`, and complete it only after the final milestone is earned. Do not infer Goals for ordinary tasks or use them as a second task ledger.

If `tasks/todo.md` already exists, preserve its project content and reconcile it rather than overwriting it. If its format cannot be validated deterministically, do not display numeric progress.

For a read-only request, do not create project files. Mirror the same milestone fields in Codex `update_plan` or Claude native tasks, label the state ephemeral, and do not promise cross-thread or cross-runtime durability. Ask for a user-selected writable location only if durable continuation becomes necessary.

## Execute work packets

Every substantial leaf records:

- one accountable owner;
- parent milestone;
- outcome, scope, and non-goals;
- dependencies;
- expected artifacts and exact checks;
- current authority boundary;
- first condition that truly requires user or external action;
- one executable next action.

A watcher is a work packet, never the parent program. Completing every packet does not complete the program until the parent milestone and final acceptance are earned.

Keep one current parent milestone. Parallel leaves may run only within existing lane and runtime worker limits; they do not independently change parent outcome, weights, or authority.

Waiting is a budget: use one blocking wait per dispatched worker, never list known workers for progress, never fixed-tick poll, and never wait again after a final result. Across a campaign, keep wait/list polling at or below 1.25 calls per spawn. Persistent app tasks use one bounded native wait instead of repeated reads; unchanged state is silent.

## Calculate truthful progress

Use the shared validator:

```bash
node ~/.config/agent-workflows/skills/long-run/scripts/long-run-status.mjs --plan tasks/todo.md
```

Progress is:

```text
floor(100 × earned milestone points / total milestone points)
```

A milestone earns points only when it is checked, its dependencies are earned, its evidence is concrete, and any referenced Unlazy gate is checked. Checked work without evidence earns zero. Unchecked work earns zero even if evidence text exists.

Never estimate, round up, reuse a pre-replan percentage, or substitute elapsed time, context use, tool activity, file count, tests run, or confidence. The percentage may move backward when accepted work is added or reweighted.

Use `--check` for silent validation and `--json` for structured state. Exit 0 is valid, 1 is a contract error, and 2 is a usage or I/O error. Fix an invalid plan before reporting progress.

## Report lifecycle changes

Communicate the validator-rendered status only at:

- program initialization;
- milestone or active-packet transition;
- material replan or new blocker;
- resume, compaction, pause, or handoff;
- verified finish.

Add one sentence naming the evidence gained, blocker changed, or next packet. Do not repeat the full plan. Unchanged polls, watcher ticks, CI state, or agent waits are silent unless the user asks.

Codex mirrors milestones in `update_plan` with at most one `in_progress` item. Claude mirrors packets in native task tools when available. Rebuild either mirror from `tasks/todo.md` after resume, never the reverse. Claude/Ghostty context percentage is context capacity, not deliverable progress.

## Replan truthfully

Record every material change to outcome, milestone set, points, final gate, or authority under `## Plan changes` before the next status display.

The agent may change sequencing, packet implementation, and evidence commands within existing authority. Obtain user approval before changing the accepted parent outcome, deleting an accepted deliverable, weakening acceptance, expanding external authority, or abandoning a genuine blocker.

When new work is required inside the accepted outcome, add it and let the denominator change. Never hide scope growth to preserve a higher percentage.

## Resume

Before compaction, pause, handoff, or intentional session end while active, refresh `tasks/session-state.md` from [templates/session-state.md](templates/session-state.md). Include exact modified paths, branch/worktree/SHA when applicable, commands and last exits, evidence, blockers and owner, present authority, settled facts, and one executable next action. Never store secret values.

At the first compaction, record the compaction count and decide whether final acceptance is within one short leaf. At repeated compaction or a material objective change, verify the live ledger and assess whether continuity still serves the objective. Retire only for a real context/runtime limitation or a user-requested handoff; compaction count alone is not a stop condition. A successor resumes from disk and the native Goal when one exists, never from an improvised chat recap.

On resume:

1. read the nearest project instructions;
2. read `tasks/todo.md`;
3. read `tasks/session-state.md`;
4. cheaply verify drift-prone facts;
5. report and reconcile mismatches;
6. rebuild native mirrors;
7. continue the current unmet milestone.

The parent plan wins when the resume capsule is stale. Do not reconstruct the program from chat memory when durable state exists.

## Block and complete

Mark `blocked` only when the current accepted milestone cannot safely advance without named authority, external state, credentials, or a required command that remains red after the governing repair limit. Record the owner and exact unblock action. Continue independent authorized work when useful; otherwise checkpoint once and wait through the runtime mechanism.

Abandonment requires explicit user direction or an active closure protocol's permitted form and a genuine impossibility reason. Abandoned work earns no points and requires an approved plan change.

Claim complete only when:

1. the validator exits 0 with `Status: complete` and 100%;
2. required tests, commands, and risk-lane reviews are green;
3. referenced Unlazy gates are met;
4. required user-surface, device, external, or production receipts exist;
5. no accepted packet, blocker, or authority-dependent action remains.

Green leaf tests never imply parent completion.
