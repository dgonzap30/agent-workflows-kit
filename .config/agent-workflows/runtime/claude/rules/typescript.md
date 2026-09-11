---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

- Keep types aligned with the value and boundary they describe; avoid casts that hide uncertainty.
- Reuse generated or project-owned data types where available.
- Run the repository's relevant type check when TypeScript behavior changes. Do not assume one universal `tsc` command fits every project.
- Review removed imports, changed mocks, and error paths after multi-file edits.
