import assert from 'node:assert/strict';
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile, symlink, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { runInstaller } from '../../../.local/bin/install-agent-workflows.mjs';

const repoRoot = resolve(import.meta.dirname, '../../..');

// The suite runs against a synthetic source tree that mirrors what a clone
// actually contains: no personal policy files, no install state. Set
// AGENT_WORKFLOWS_TEST_REAL_SOURCE=1 to run it against the working tree
// instead, which exercises whatever personal state happens to be on the box.
const useRealSource = process.env.AGENT_WORKFLOWS_TEST_REAL_SOURCE === '1';

// Retirement fixtures come from the committed example policy, so the test
// proves the mechanism without naming anyone's real workspaces.
const staleCodexProjectPaths = JSON.parse(
  await readFile(join(repoRoot, '.config/agent-workflows/policy/codex-config.example.json'), 'utf8'),
).removeProjectTrustPaths;

async function buildSourceTree() {
  if (useRealSource) return repoRoot;
  // realpath matters on macOS: mkdtemp hands back /var/..., the installer
  // resolves /private/var/..., and the difference reads as symlink drift.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'agent-workflows-source-')));
  await cp(join(repoRoot, '.config/agent-workflows'), join(dir, '.config/agent-workflows'), { recursive: true });
  await cp(join(repoRoot, '.config/codex-profiles'), join(dir, '.config/codex-profiles'), { recursive: true });
  await mkdir(join(dir, '.local/bin'), { recursive: true });
  for (const binary of ['install-agent-workflows.mjs', 'agent-catalog-check.mjs', 'codex-catalog.mjs']) {
    await cp(join(repoRoot, '.local/bin', binary), join(dir, '.local/bin', binary));
  }
  // Gitignored on purpose: a clone has neither.
  for (const personal of ['claude-settings.json', 'codex-config.json']) {
    await rm(join(dir, '.config/agent-workflows/policy', personal), { force: true });
  }
  for (const state of ['backups', 'releases']) {
    await rm(join(dir, '.config/agent-workflows', state), { recursive: true, force: true });
  }
  await rm(join(dir, '.config/agent-workflows/install-state.json'), { force: true });
  return dir;
}

const sourceRoot = await buildSourceTree();

function originalCodexConfig() {
  return `model = "gpt-5.6-sol"

[projects."/example/dev/keep-me"]
trust_level = "trusted"

${staleCodexProjectPaths.map((path) => `[projects.${JSON.stringify(path)}]\ntrust_level = "trusted"\n`).join('\n')}
[features]
skills = true
`;
}

function originalClaudeSettings() {
  return {
    model: 'fable',
    permissions: { allow: ['Bash(cat:*)', 'Bash(env)', 'Bash(printenv:*)', 'Bash(git status)'], defaultMode: 'auto' },
    effortLevel: 'xhigh',
    skipAutoPermissionPrompt: true,
    skipDangerousModePermissionPrompt: true,
    remoteControlAtStartup: true,
    autoMode: { environment: ['stale home-derived snapshot'] },
    enabledPlugins: {
      'posthog@claude-plugins-official': true,
      'context7@claude-plugins-official': true,
    },
    unrelated: { keep: 'exact' },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks' --source claude" }],
        },
        {
          matcher: 'Edit|Write',
          hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hooks/config-protection.sh' }],
        },
        {
          matcher: 'AskUserQuestion',
          hooks: [{ type: 'command', command: '/example/tools/telemetry/emit.sh PreToolUse' }],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks' --source claude" }],
        },
        {
          matcher: 'Edit|Write',
          hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hooks/auto-format.sh' }],
        },
      ],
      SessionStart: [
        {
          hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks' --source claude" }],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hooks/prompt-gate.sh' }],
        },
        {
          hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hooks/session-budget.sh' }],
        },
        {
          hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks' --source claude" }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: 'bash ~/.claude/scripts/hooks/completion-guard.sh' }],
        },
        {
          hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks' --source claude" }],
        },
      ],
    },
  };
}

async function fixtureHome() {
  const home = await mkdtemp(join(tmpdir(), 'agent-workflows-home-'));
  for (const [relative, contents] of [
    ['.claude/CLAUDE.md', '# Old Claude instructions\n'],
    ['.zshrc', "export KEEP=1\nalias claude-dev='claude --append-system-prompt old'\n"],
    ['.codex/AGENTS.md', '# Old Codex instructions\n'],
    ['.codex/config.toml', originalCodexConfig()],
    ['.claude/settings.json', `${JSON.stringify(originalClaudeSettings(), null, 2)}\n`],
    ['.codex/hooks.json', `${JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash ~/.codex/scripts/hooks/destructive-command-block.sh' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks'" }] }],
      },
    }, null, 2)}\n`],
  ]) {
    const path = join(home, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
  return home;
}

function capture() {
  const output = [];
  const errors = [];
  return {
    output,
    errors,
    io: {
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
    },
  };
}

async function invoke(home, ...args) {
  const result = capture();
  result.code = await runInstaller([...args, '--home', home, '--source', sourceRoot], result.io);
  return result;
}

test('first install requires adoption, narrows settings, installs links, checks, and restores exactly', async () => {
  const home = await fixtureHome();
  const originalClaude = await readFile(join(home, '.claude/CLAUDE.md'), 'utf8');
  const originalCodex = await readFile(join(home, '.codex/AGENTS.md'), 'utf8');
  const originalSettings = await readFile(join(home, '.claude/settings.json'), 'utf8');
  const originalConfig = await readFile(join(home, '.codex/config.toml'), 'utf8');

  const refused = await invoke(home, '--install');
  assert.equal(refused.code, 1);
  assert.match(refused.errors.join(''), /re-run with --adopt to take ownership/);

  const installed = await invoke(home, '--install', '--adopt');
  assert.equal(installed.code, 0, installed.errors.join(''));
  const rollback = installed.output.join('').match(/rollback=(.+)\n/)?.[1];
  assert.ok(rollback);

  const claudeDoc = await readFile(join(home, '.claude/CLAUDE.md'), 'utf8');
  const codexDoc = await readFile(join(home, '.codex/AGENTS.md'), 'utf8');
  for (const doc of [claudeDoc, codexDoc]) {
    assert.match(doc, /one active execution ledger/);
    assert.match(doc, /compaction count alone does not force retirement/);
    assert.match(doc, /Never silently lower/);
    assert.doesNotMatch(doc, /< 20 lines|Primary stack|2026-0[1-9]-/);
    assert.ok(Buffer.byteLength(doc) < 10_000);
  }
  assert.match(codexDoc, /Create a native Goal only when the user explicitly requests/);
  assert.match(claudeDoc, /preserve the current main settings/);

  const settings = JSON.parse(await readFile(join(home, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.enabledPlugins['posthog@claude-plugins-official'], false);
  assert.equal(settings.remoteControlAtStartup, true);
  assert.equal(settings.skipDangerousModePermissionPrompt, false);
  assert.equal(settings.skipAutoPermissionPrompt, true);
  assert.equal(settings.model, 'fable');
  assert.equal(settings.effortLevel, 'xhigh');
  assert.deepEqual(settings.permissions.allow, ['Bash(git status)']);
  assert.equal(settings.permissions.defaultMode, 'auto');
  assert.equal(await readFile(join(home, '.zshrc'), 'utf8'), 'export KEEP=1\n');
  assert.deepEqual(settings.autoMode, { environment: ['$defaults'], allow: ['$defaults'] }); // Supported dynamic defaults; no project snapshot at global scope.
  assert.deepEqual(settings.unrelated, { keep: 'exact' });

  const handlers = Object.entries(settings.hooks).flatMap(([event, groups]) => groups.flatMap((group) => (
    group.hooks.map((hook) => ({ event, hook }))
  )));
  assert.equal(handlers.some(({ event, hook }) => ['PreToolUse', 'PostToolUse'].includes(event) && hook.command.includes('OpenIslandHooks')), false);
  assert.equal(handlers.find(({ event, hook }) => event === 'SessionStart' && hook.command.includes('OpenIslandHooks')).hook.async, undefined);
  assert.equal(handlers.find(({ event, hook }) => event === 'Stop' && hook.command.includes('OpenIslandHooks')).hook.async, true);
  assert.equal(handlers.find(({ hook }) => hook.command.includes('config-protection.sh')).hook.async, undefined);
  assert.equal(handlers.filter(({ hook }) => hook.command === 'bash ~/.config/agent-workflows/hooks/prompt-gate.sh --runtime claude').length, 1);
  assert.equal(handlers.some(({ hook }) => hook.command === 'bash ~/.claude/scripts/hooks/prompt-gate.sh'), false);

  const codexConfig = await readFile(join(home, '.codex/config.toml'), 'utf8');
  assert.match(codexConfig, /\[projects\."\/example\/dev\/keep-me"\]\ntrust_level = "trusted"/);
  assert.match(codexConfig, /\[features\]\nskills = true/);
  for (const path of staleCodexProjectPaths) assert.doesNotMatch(codexConfig, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.equal(await readlink(join(home, '.config/agent-workflows/skills/long-run')), join(sourceRoot, '.config/agent-workflows/skills/long-run'));
  assert.equal(await readlink(join(home, '.config/agent-workflows/hooks')), join(sourceRoot, '.config/agent-workflows/hooks'));
  assert.equal(await readlink(join(home, '.codex/skills/long-run')), join(home, '.config/agent-workflows/skills/long-run'));
  assert.equal(await readlink(join(home, '.claude/skills/long-run')), join(home, '.config/agent-workflows/skills/long-run'));
  assert.equal(await readlink(join(home, '.local/bin/install-agent-workflows')), join(sourceRoot, '.local/bin/install-agent-workflows.mjs'));

  const checked = await invoke(home, '--check');
  assert.equal(checked.code, 0, checked.errors.join(''));

  const restored = capture();
  restored.code = await runInstaller(['--restore', rollback, '--home', home], restored.io);
  assert.equal(restored.code, 0, restored.errors.join(''));
  assert.equal(await readFile(join(home, '.claude/CLAUDE.md'), 'utf8'), originalClaude);
  assert.equal(await readFile(join(home, '.codex/AGENTS.md'), 'utf8'), originalCodex);
  assert.equal(await readFile(join(home, '.claude/settings.json'), 'utf8'), originalSettings);
  assert.equal(await readFile(join(home, '.codex/config.toml'), 'utf8'), originalConfig);
  await assert.rejects(lstat(join(home, '.config/agent-workflows/install-state.json')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(home, '.local/bin/install-agent-workflows')), { code: 'ENOENT' });
});

test('unrelated and explicitly preserved settings may change, but owned drift fails closed', async () => {
  const home = await fixtureHome();
  assert.equal((await invoke(home, '--install', '--adopt')).code, 0);
  const path = join(home, '.claude/settings.json');
  const settings = JSON.parse(await readFile(path, 'utf8'));
  settings.model = 'opus';
  settings.unrelated.keep = 'changed by Claude itself';
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  const codexPath = join(home, '.codex/config.toml');
  await writeFile(codexPath, `${await readFile(codexPath, 'utf8')}\n[projects."/tmp/new-project"]\ntrust_level = "trusted"\n`);
  assert.equal((await invoke(home, '--check')).code, 0);

  settings.enabledPlugins['posthog@claude-plugins-official'] = true;
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  const drifted = await invoke(home, '--install');
  assert.equal(drifted.code, 1);
  assert.match(drifted.errors.join(''), /managed Claude settings drift/);
});

test('a removed Codex trust entry cannot return without explicit adoption', async () => {
  const home = await fixtureHome();
  assert.equal((await invoke(home, '--install', '--adopt')).code, 0);
  const path = join(home, '.codex/config.toml');
  await writeFile(path, `${await readFile(path, 'utf8')}\n[projects.${JSON.stringify(staleCodexProjectPaths[0])}]\ntrust_level = "trusted"\n`);
  const drifted = await invoke(home, '--install');
  assert.equal(drifted.code, 1);
  assert.match(drifted.errors.join(''), /managed Codex config drift/);
});

test('managed instruction drift fails before backup or write', async () => {
  const home = await fixtureHome();
  assert.equal((await invoke(home, '--install', '--adopt')).code, 0);
  const path = join(home, '.codex/AGENTS.md');
  await writeFile(path, `${await readFile(path, 'utf8')}manual drift\n`);
  const drifted = await invoke(home, '--install');
  assert.equal(drifted.code, 1);
  assert.match(drifted.errors.join(''), /managed instruction drift/);
});

test('rejects source content that differs from the complete hash manifest', async () => {
  const source = await mkdtemp(join(tmpdir(), 'agent-workflows-source-'));
  await cp(join(repoRoot, '.config'), join(source, '.config'), { recursive: true });
  await cp(join(repoRoot, '.local'), join(source, '.local'), { recursive: true });
  const skillPath = join(source, '.config', 'agent-workflows', 'skills', 'long-run', 'SKILL.md');
  await writeFile(skillPath, `${await readFile(skillPath, 'utf8')}\nDRIFT\n`);
  const home = await fixtureHome();
  const result = capture();
  result.code = await runInstaller(['--check', '--home', home, '--source', source], result.io);
  assert.equal(result.code, 1);
  assert.match(result.errors.join(''), /source hash mismatch/);
});

test('Codex per-tool OpenIsland regression fails closed', async () => {
  const home = await fixtureHome();
  const hooks = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: "'/Applications/OpenIslandHooks'" }] }],
    },
  };
  await writeFile(join(home, '.codex/hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`);
  const result = await invoke(home, '--install', '--adopt');
  assert.equal(result.code, 1);
  assert.match(result.errors.join(''), /Codex per-tool OpenIsland hook remains/);
});


test('new owned runtime assets are created, protected from drift and removed on rollback', async () => {
  const home = await fixtureHome();
  const installed = await invoke(home, '--install', '--adopt');
  assert.equal(installed.code, 0, installed.errors.join(''));
  const path = join(home, '.claude/agents/planner.md');
  assert.match(await readFile(path, 'utf8'), /model: inherit/);
  const rollback = installed.output.join('').match(/rollback=(.+)\n/)?.[1];
  const restored = capture();
  assert.equal(await runInstaller(['--restore', rollback, '--home', home], restored.io), 0, restored.errors.join(''));
  await assert.rejects(lstat(path), { code: 'ENOENT' });
  await assert.rejects(lstat(join(home, '.claude/agents')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(home, '.agents')), { code: 'ENOENT' });
});

test('restore rejects mismatched keys and escaping link paths before touching a sibling sentinel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rollback-escape-'));
  const home = join(root, 'home'); const bundle = join(root, 'bundle');
  await mkdir(home); await mkdir(bundle, {mode:0o700});
  const sentinel = join(root, 'sentinel'); await writeFile(sentinel, 'keep');
  const hash = createHash('sha256').update('keep').digest('hex');
  const manifests = [
    {files:{},restore:{'../sentinel':{preSha256:hash,postSha256:hash,mode:0o600}}},
    {files:{},restore:{},createdLinks:[{path:'../sentinel-link',target:sentinel}]},
  ];
  await symlink(sentinel,join(root,'sentinel-link'));
  for (const body of manifests) {
    await writeFile(join(bundle,'rollback-manifest.json'),JSON.stringify({schemaVersion:1,...body}));
    const out=capture();
    assert.equal(await runInstaller(['--restore',bundle,'--home',home],out.io),1);
    assert.equal(await readFile(sentinel,'utf8'),'keep');
    assert.equal(await readlink(join(root,'sentinel-link')),sentinel);
  }
});

test('linked profile mutation invalidates source verification', async () => {
  const source = await mkdtemp(join(tmpdir(), 'agent-workflows-linked-source-'));
  await cp(join(repoRoot,'.config'),join(source,'.config'),{recursive:true});
  await cp(join(repoRoot,'.local'),join(source,'.local'),{recursive:true});
  const home=await fixtureHome(); const installed=capture();
  assert.equal(await runInstaller(['--install','--adopt','--home',home,'--source',source],installed.io),0,installed.errors.join(''));
  const path=join(source,'.config/codex-profiles/methodology.config.toml');
  await writeFile(path,`${await readFile(path,'utf8')}\n# changed after installation\n`);
  const checked=capture();
  assert.equal(await runInstaller(['--check','--home',home,'--source',source],checked.io),1);
  assert.match(checked.errors.join(''),/source hash mismatch/);
});

test('installed symlink CLI actually executes check instead of silently exiting', async () => {
  const home=await fixtureHome();
  assert.equal((await invoke(home,'--install','--adopt')).code,0);
  const {stdout}=await promisify(execFile)(process.execPath,[join(home,'.local/bin/install-agent-workflows'),'--check','--home',home]);
  assert.match(stdout,/agent-workflows: check ok/);
});

test('portable adapter installs self-contained policy without desktop paths or settings and remembers adapter', async () => {
  const home=await fixtureHome();
  await unlink(join(home,'.codex/hooks.json'));
  const hostSettings={model:'host-model',effortLevel:'high',enabledPlugins:{'host-plugin':true},permissions:{defaultMode:'auto',allow:['Bash(cat:*)','Bash(env)','Bash(printenv:*)']}};
  await writeFile(join(home,'.claude/settings.json'),JSON.stringify(hostSettings));
  const original=await readFile(join(home,'.codex/config.toml'),'utf8');
  const r=await invoke(home,'--install','--adopt','--adapter','portable');
  assert.equal(r.code,0,r.errors.join(''));
  const settings=JSON.parse(await readFile(join(home,'.claude/settings.json'),'utf8'));
  assert.deepEqual(settings,hostSettings);
  assert.equal(await readFile(join(home,'.codex/config.toml'),'utf8'),original);
  await assert.rejects(lstat(join(home,'.claude/statusline-command.sh')),{code:'ENOENT'});
  await assert.rejects(lstat(join(home,'.codex/web.config.toml')),{code:'ENOENT'});
  assert.match(await readFile(join(home,'.claude/CLAUDE.md'),'utf8'),/Portable host/);
  assert.match(await readFile(join(home,'.claude/skills/verification-loop/SKILL.md'),'utf8'),/project-owned/);
  const check=await invoke(home,'--check'); assert.equal(check.code,0,check.errors.join(''));
});

test('adapter changes fail before dropping ownership or leaving active unowned assets', async () => {
  const home=await fixtureHome();
  assert.equal((await invoke(home,'--install','--adopt')).code,0);
  const statePath=join(home,'.config/agent-workflows/install-state.json');
  const before=await readFile(statePath,'utf8');
  const r=await invoke(home,'--install','--adopt','--adapter','portable');
  assert.equal(r.code,1); assert.match(r.errors.join(''),/adapter transition/);
  assert.equal(await readFile(statePath,'utf8'),before);
  assert.equal((await invoke(home,'--check')).code,0);
});

test('source relocation requires an explicit expected previous source and restores links', async () => {
  const home = await fixtureHome();
  assert.equal((await invoke(home, '--install', '--adopt')).code, 0);
  const source = await realpath(await mkdtemp(join(tmpdir(), 'agent-workflows-release-')));
  await cp(join(sourceRoot, '.config'), join(source, '.config'), { recursive: true });
  await cp(join(sourceRoot, '.local'), join(source, '.local'), { recursive: true });
  const denied = capture();
  assert.equal(await runInstaller(['--install', '--adopt', '--home', home, '--source', source], denied.io), 1);
  const accepted = capture();
  assert.equal(await runInstaller(['--install', '--adopt', '--home', home, '--source', source, '--previous-source', sourceRoot], accepted.io), 0, accepted.errors.join(''));
  const path = join(home, '.config/agent-workflows/hooks');
  assert.equal(await readlink(path), join(source, '.config/agent-workflows/hooks'));
  const rollback = accepted.output.join('').match(/rollback=(.+)\n/)?.[1];
  const restored = capture();
  assert.equal(await runInstaller(['--restore', rollback, '--home', home], restored.io), 0, restored.errors.join(''));
  assert.equal(await readlink(path), join(sourceRoot, '.config/agent-workflows/hooks'));
});

test('a genuinely empty host installs without --adopt, and an occupied one still demands it', async () => {
  const empty = await realpath(await mkdtemp(join(tmpdir(), 'agent-workflows-empty-')));
  // Portable is the adapter a stranger installs with. The desktop adapter
  // additionally rewrites hooks that an empty host does not have yet.
  const first = await invoke(empty, '--install', '--adapter', 'portable');
  assert.equal(first.code, 0, first.errors.join(''));
  assert.match(first.output.join(''), /install ok/);

  // A host that already carries the managed files is a different case: taking
  // them over without verification is exactly what --adopt is for.
  const occupied = await fixtureHome();
  const refused = await invoke(occupied, '--install');
  assert.equal(refused.code, 1);
  assert.match(refused.errors.join(''), /re-run with --adopt to take ownership/);
  assert.equal((await invoke(occupied, '--install', '--adopt')).code, 0);
});
