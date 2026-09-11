---
name: verification-loop
description: Verify a change with the repository's relevant commands before creating a PR or marking work as ready.
argument-hint: [scope]
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash Read Grep Glob
---

# Verification Loop

Use this before creating a PR or marking work as ready. Verify the changed surface, not a fixed global ritual.

1. Read the changed files, their nearest instructions, and the project scripts, CI workflow, or contributor guide. Choose the project-owned command for each relevant concern (for example, a package test target, migration check, build, or browser/device flow).
2. Run the selected commands separately, capture and report each true exit status. Do not pipe required commands through `tail`, substitute a second package manager after a real test failure, or add `--passWithNoTests` to turn missing coverage into a pass.
3. Inspect the diff and report the actual command, exit code, scope, and result. A command that is absent or blocked is evidence to report, not a green result.
4. Add security review when the changed attack surface warrants it. Searching for TODOs or console output is hygiene only; it is not a security audit.

Stop when a required check fails. Fix only within the authorized scope, then rerun the failed check and the affected verification. See `references/verification-examples.md` for command-handling examples.
