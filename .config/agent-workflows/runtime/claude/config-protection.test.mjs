import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'config-protection.sh');

function run(input, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', [script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('editing global Claude settings.json is blocked (exit 2)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'config-protection-'));
  const payload = JSON.stringify({ tool_input: { file_path: join(home, '.claude', 'settings.json') } });
  const { code, stderr } = await run(payload, { ...process.env, HOME: home });
  assert.equal(code, 2);
  assert.match(stderr, /Blocked: edit to global Claude config/);
});

test('the escape hatch env var allows the same edit (exit 0)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'config-protection-'));
  const payload = JSON.stringify({ tool_input: { file_path: join(home, '.claude', 'settings.json') } });
  const { code, stderr } = await run(payload, { ...process.env, HOME: home, ALLOW_CLAUDE_CONFIG_EDIT: '1' });
  assert.equal(code, 0);
  assert.equal(stderr, '');
});

test('an unrelated project file is allowed with no output', async () => {
  const home = await mkdtemp(join(tmpdir(), 'config-protection-'));
  const payload = JSON.stringify({ tool_input: { file_path: join(home, 'project', 'src', 'index.ts') } });
  const { code, stdout, stderr } = await run(payload, { ...process.env, HOME: home });
  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.equal(stderr, '');
});

test('disabling tsconfig strict mode is blocked', async () => {
  const home = await mkdtemp(join(tmpdir(), 'config-protection-'));
  const payload = JSON.stringify({
    tool_input: { file_path: join(home, 'project', 'tsconfig.json'), new_string: '"strict": false' },
  });
  const { code, stderr } = await run(payload, { ...process.env, HOME: home });
  assert.equal(code, 2);
  assert.match(stderr, /DO NOT disable TypeScript strict mode/);
});
