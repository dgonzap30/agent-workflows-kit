# Claude Code plugin scopes

The user-wide plugin set is intentionally bounded below 1,500 projected always-on tokens. PostHog, Vercel, Firecrawl, and RevenueCat stay installed but disabled at user scope; they are useful, but their task-specific context does not belong in every session.

Enable only the stack a repository needs from that repository root:

```bash
claude plugin enable -s project vercel@claude-plugins-official
claude plugin enable -s project firecrawl@claude-plugins-official
claude plugin enable -s project revenuecat@claude-plugins-official
claude plugin enable -s project posthog@claude-plugins-official
```

Use `-s local` instead of `-s project` for a machine-only, uncommitted override. Remove a scoped override with the matching scope:

```bash
claude plugin disable -s project vercel@claude-plugins-official
```

Project activation is stored in `.claude/settings.json`; local activation is stored in `.claude/settings.local.json`. Inspect that receipt and re-run the plugin list outside the project before concluding that user scope changed, because the merged listing can reflect effective state rather than the source file you intended.

Measure current user-wide cost with `agent-catalog-check`. It queries installed plugin details at runtime and fails if a scoped plugin becomes user-global or the projected budget reaches 1,500 tokens.
