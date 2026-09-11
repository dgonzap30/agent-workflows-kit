---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
---

# React

- Keep render logic and effects tied to the behavior they own; clean up asynchronous work when stale results could update state.
- Treat memoization as a tradeoff: measure or profile when performance matters, and use it when referential stability or repeated work has evidence behind it.
- Review loading, error, and empty states for changed asynchronous UI.
