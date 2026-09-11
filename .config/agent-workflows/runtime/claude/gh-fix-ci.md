---
name: gh-fix-ci
description: Diagnose and repair failing GitHub Actions PR checks with gh; report external-provider checks by URL.
argument-hint: [pr-or-url]
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash Read Grep Glob
---

# GitHub Actions CI Repair

Use `gh` to resolve the PR, inspect GitHub Actions checks, and obtain the smallest actionable failure context. Prefer the repository's CI scripts and reproduce the relevant failure locally when practical.

If the user requested a fix, that request is existing authorization for the requested fix after diagnosis; do not ask again merely to apply the repair. If the request was inspection-only, return the failure context and a concise plan without editing.

Treat a missing credential, an external provider, a merge, production action, or a change outside the requested fix as a real authority boundary. For an external provider such as Buildkite, report its details URL without attempting to operate it. Never print credentials; when GitHub authentication is absent, state the required account action.

After a repair, run the relevant project-owned command and recheck the GitHub Actions status. Report the failing check, evidence, changed files, and current result.
