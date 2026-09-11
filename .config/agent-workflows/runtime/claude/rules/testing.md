---
paths:
  - "**/__tests__/**"
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/jest.config.*"
  - "**/vitest.config.*"
---

# Testing

- Follow the repository's existing test conventions and exercise observable behavior.
- Keep tests independent and cover the changed happy path plus relevant boundary or failure behavior.
- Mock system boundaries when needed, not the behavior under test.
- Run the focused project-owned test command; missing tests or an unavailable runner must be reported honestly.
