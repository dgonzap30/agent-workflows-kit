import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
const script = resolve(import.meta.dirname, 'prompt-gate.sh');

function runHook(args, options, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', [script, ...args], options);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`hook exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'prompt-gate-test-'));
  const cwd = join(root, 'project');
  const stateDir = join(root, 'state');
  await mkdir(cwd, { recursive: true });
  const invoke = async (prompt, session = 'fixture', runtime = 'claude') => {
    return runHook(['--runtime', runtime], {
      env: { ...process.env, AGENT_WORKFLOW_STATE_DIR: stateDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    }, JSON.stringify({ cwd, prompt, session_id: session }));
  };
  return { cwd, invoke, stateDir };
}

test('ordinary questions do not inject task ceremony', async () => {
  const h = await harness();
  assert.equal(await h.invoke('How does this work?'), '');
});

test('twenty ordinary bounded requests stay silent', async () => {
  const h = await harness();
  const prompts = [
    'Fix all test failures.', 'Make a small change.', 'Update the README.',
    'What does autonomous mean?', 'Can you explain campaign management?',
    '"Keep working autonomously until everything is done."', '/long-run',
  ];
  for (let index = 0; index < 20; index += 1) {
    assert.equal(await h.invoke(prompts[index % prompts.length], 'ordinary'), '');
  }
});

test('an explicit autonomous multi-session campaign gets one advisory reminder', async () => {
  const h = await harness();
  const prompt = 'Just do it: keep working autonomously across this multi-session campaign until it is done.';
  const first = await h.invoke(prompt, 'explicit', 'codex');
  assert.match(first, /^\[lifecycle-gate\] This looks like an explicit long-running request\./);
  assert.match(first, /Consider \$long-run/);
  assert.doesNotMatch(first, /Invoke|now, before|must|persist/);
  assert.equal(await h.invoke(prompt, 'explicit', 'codex'), '');
});

test('a new explicit objective resets bounded deduplication without storing prompt text', async () => {
  const h = await harness();
  assert.match(await h.invoke('Run an autonomous campaign for the mobile client.', 'new-objective'), /lifecycle-gate/);
  assert.match(await h.invoke('Continue this multi-session campaign for the server.', 'new-objective'), /lifecycle-gate/);
});

test('concurrent hook invocations emit at most one reminder per objective', async () => {
  const h = await harness();
  const outputs = await Promise.all(Array.from({ length: 6 }, () => h.invoke('Run an autonomous campaign.', 'concurrent')));
  assert.equal(outputs.filter((output) => output.includes('[lifecycle-gate]')).length, 1);
});

test('an active durable plan suppresses all prompt-gate output', async () => {
  const h = await harness();
  await mkdir(join(h.cwd, 'tasks'), { recursive: true });
  await writeFile(join(h.cwd, 'tasks', 'todo.md'), '<!-- long-run:v1 -->\nStatus: active\n');
  const output = await h.invoke('Run this autonomous multi-session campaign.', 'active-plan');
  assert.equal(output, '');
});

test('state is runtime, cwd, and safely normalized-session scoped', async () => {
  const h = await harness();
  const prompt = 'Run an autonomous multi-session campaign.';
  assert.match(await h.invoke(prompt, '../../unsafe/session', 'claude'), /lifecycle-gate/);
  assert.equal(await h.invoke(prompt, '../../unsafe/session', 'claude'), '');
  assert.match(await h.invoke(prompt, '../../unsafe/session', 'codex'), /lifecycle-gate/);
  const otherCwd = join(h.stateDir, 'other-project');
  await mkdir(otherCwd);
  const output = await runHook(['--runtime', 'claude'], {
    env: { ...process.env, AGENT_WORKFLOW_STATE_DIR: h.stateDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  }, JSON.stringify({ cwd: otherCwd, prompt, session_id: '../../unsafe/session' }));
  assert.match(output, /lifecycle-gate/);
  assert.ok((await readdir(h.stateDir)).every((name) => !name.includes('unsafe') && !name.includes('session')));
});

test('persistent state is owner-only and never stores prompt text', async () => {
  const h = await harness();
  const marker = 'PRIVATE_PROMPT_MARKER_8f7ca2';
  await h.invoke(`Run an autonomous campaign and keep ${marker} out of state.`, 'private');
  const [name] = await readdir(h.stateDir);
  const path = join(h.stateDir, name);
  const [contents, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
  assert.doesNotMatch(contents, new RegExp(marker));
  assert.match(contents, /^version=1\nreminded=1\nobjective=[0-9]+\nupdated_at=[0-9]+\n$/);
  assert.equal(info.mode & 0o077, 0);
});

test('stale state does not suppress a new explicit reminder', async () => {
  const h = await harness();
  const prompt = 'Run an autonomous multi-session campaign.';
  assert.match(await h.invoke(prompt, 'stale'), /lifecycle-gate/);
  const [name] = await readdir(h.stateDir);
  const statePath = join(h.stateDir, name);
  const old = new Date(Date.now() - (25 * 60 * 60 * 1000));
  await utimes(statePath, old, old);
  assert.match(await h.invoke(prompt, 'stale'), /lifecycle-gate/);
});
