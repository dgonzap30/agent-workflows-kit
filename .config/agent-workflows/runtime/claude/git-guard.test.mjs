import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'git-guard.sh');
const libSource = resolve(import.meta.dirname, 'lib', 'git-policy-lib.sh');

function sh(cmd, cwd) {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stderr}`);
}

// git-guard.sh hardcodes $HOME/.claude/scripts/hooks/lib/git-policy-lib.sh (live layout).
// Build a temp HOME that mirrors just that path, plus a real git repo with a remote
// (repo_protected() treats "has an origin remote" as protected by default) on branch main.
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'git-guard-home-'));
  const libDir = join(home, '.claude', 'scripts', 'hooks', 'lib');
  await mkdir(libDir, { recursive: true });
  await copyFile(libSource, join(libDir, 'git-policy-lib.sh'));
  const repo = join(home, 'repo');
  await mkdir(repo, { recursive: true });
  sh('git init -q -b main', repo);
  sh('git config user.email t@example.com && git config user.name t', repo);
  sh('git commit -q --allow-empty -m init', repo);
  sh('git remote add origin https://example.invalid/repo.git', repo);
  return { home, repo };
}

function run(payload, home) {
  return spawnSync('bash', [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('an Edit on the protected main branch of a protected repo is blocked', async () => {
  const { home, repo } = await fixture();
  const r = run({ tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.txt') }, session_id: 's1' }, home);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[git-guard\] BLOCKED/);
});

test('GIT_GUARD_OFF short-circuits with no output (allow)', async () => {
  const { home, repo } = await fixture();
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.txt') } }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GIT_GUARD_OFF: '1' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('a feature branch is allowed', async () => {
  const { home, repo } = await fixture();
  sh('git checkout -q -b feat/x', repo);
  const r = run({ tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.txt') }, session_id: 's2' }, home);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('a repo with no remote is unprotected by default (allow)', async () => {
  const { home, repo } = await fixture();
  sh('git remote remove origin', repo);
  const r = run({ tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.txt') }, session_id: 's3' }, home);
  assert.equal(r.status, 0);
});

test('a missing git-policy-lib.sh fails open (allow)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'git-guard-nolib-'));
  const repo = join(home, 'repo');
  await mkdir(repo, { recursive: true });
  sh('git init -q -b main', repo);
  const r = run({ tool_name: 'Edit', tool_input: { file_path: join(repo, 'a.txt') } }, home);
  assert.equal(r.status, 0);
});
