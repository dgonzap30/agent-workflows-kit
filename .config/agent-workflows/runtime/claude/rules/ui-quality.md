---
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.css"
---

# UI Quality

- Preserve keyboard access, visible focus, readable contrast, and accessible labels for changed controls.
- Test realistic long, empty, and boundary content where the changed screen can expose layout errors.
- Inspect the rendered surface at relevant viewport or device sizes before claiming visual readiness.
- Treat irreversible actions as requiring an explicit confirmation or recovery path.
