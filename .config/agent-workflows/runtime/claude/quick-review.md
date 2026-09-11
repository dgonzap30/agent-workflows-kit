---
name: quick-review
description: Review uncommitted changes for concrete defects, security regressions, and readiness evidence before committing.
argument-hint: [files or path]
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash Grep Read Glob
context: fork
effort: medium
---

# Quick Review

Read both staged and unstaged diffs, then trace changed behavior to its callers, tests, and applicable instructions.

Report only actionable findings as `severity | file:line | evidence | fix`. Check logic, error paths, input trust boundaries, authorization, concurrency, and type contracts when the diff makes them relevant. Use the relevant scoped rule for framework or data-layer concerns.

Qualify readiness with evidence: name the diff reviewed and the checks actually run. If the review cannot establish an assertion, say “not enough evidence” rather than inventing a defect or declaring readiness. Performance changes need a measured or reasoned bottleneck in context; do not prescribe memoization, list handling, or stack-specific patterns universally.

Keep the result concise. See `references/review-evidence.md` for examples of evidence-backed findings.
