# Codex catalog profiles

The global catalog stays intentionally small. Select one additive profile when a task needs a specialized stack:

```bash
codex --profile web
codex --profile business-gtm
codex --profile business-ops
codex --profile methodology
```

Those four ship ready to use. The rest — `design`, `engineering-extra`,
`infra`, `macos`, `mobile`, `personal-creative`, `research` — ship only as
`<name>.config.toml.example`, because a profile is an inventory of one
machine's skills. Copy the example, list the skills you actually have, and the
real file stays gitignored.

Profiles merge over `~/.codex/config.toml`; they do not alter project trust. For an already trusted desktop project that should always load one profile's capabilities, copy that profile's contents into the project's `.codex/config.toml` after reviewing its existing project config.

Installed remote bundles are managed separately from additive skill profiles. Activate exactly one bundle transactionally, start a fresh task, then return to the compact catalog:

```bash
codex-catalog activate build-ios
codex --profile mobile
codex-catalog deactivate
```

Run `codex-catalog list` for bundle names and current state. `activate` first validates the installed package's skill payload and disables every managed bundle, so capabilities cannot accumulate accidentally. It writes an atomic user-config update plus a recoverable previous-config copy; it does not uninstall packages or alter project trust.

Use both `codex debug prompt-input` and `codex plugin list --json` as receipts: the first measures the bounded prompt catalog and the second verifies native plugin state. The guard discovers current behavior instead of pinning a CLI version in policy prose.

Do not enable duplicate Claude-marketplace Vercel or Supabase plugins. Use the `vercel` remote bundle through `codex-catalog`; the globally retained Supabase variant is `supabase@openai-curated`.

Run the complete read-only regression guard after any global catalog or profile change:

```bash
agent-catalog-check
```

The guard renders global plus every named profile, validates native Codex plugin state, and sums Claude's projected always-on cost. Run it after profile/plugin changes and before activation; it is intentionally not a per-prompt hook.
