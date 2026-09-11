---
paths:
  - "**/*.sql"
  - "supabase/**"
---

# SQL and Supabase

- Treat schema, migration, RLS, and service-role changes as data and authorization boundaries.
- Verify policies against the intended caller and current schema; do not infer runtime permissions from migration text alone.
- Review query plans or measurements before making performance claims. Query shape, indexes, and policy context determine the result.
- Use the project-owned migration and database verification path; never weaken RLS or checks just to make a command pass.
