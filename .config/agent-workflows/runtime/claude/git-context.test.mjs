import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'git-context.sh');
const libSource = resolve(import.meta.dirname, 'lib', 'git-policy-lib.sh');

function sh(cmd, cwd) {
  const r = spawnSync('bash', ['-lc', cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`setup failed: ${cmd}\n${r.stderr}`);
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'git-context-home-'));
  const libDir = join(home, '.claude', 'scripts', 'hooks', 'lib');
  await mkdir(libDir, { recursive: true });
  await copyFile(libSource, join(libDir, 'git-policy-lib.sh'));
  const repo = join(home, 'repo');
  await mkdir(repo, { recursive: true });
  sh('git init -q -b main', repo);
  sh('git config user.email t@example.com && git config user.name t', repo);
  sh('git commit -q --allow-empty -m init', repo);
  return { home, repo };
}

test('a git repo emits a [git-context] summary line (nominal)', async () => {
  const { home, repo } = await fixture();
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ cwd: repo }),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\[git-context\] repo: /);
  assert.match(r.stdout, /branch: main/);
});

test('a cwd outside any git repo is a silent no-op', async () => {
  const home = await mkdtemp(join(tmpdir(), 'git-context-home-'));
  const libDir = join(home, '.claude', 'scripts', 'hooks', 'lib');
  await mkdir(libDir, { recursive: true });
  await copyFile(libSource, join(libDir, 'git-policy-lib.sh'));
  const plain = await mkdtemp(join(tmpdir(), 'git-context-plain-'));
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ cwd: plain }),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
