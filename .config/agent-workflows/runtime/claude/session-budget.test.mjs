import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'session-budget.sh');

function run(input, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', [script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout }));
    child.stdin.end(input);
  });
}

async function transcript(home) {
  const path = join(home, 'transcript.jsonl');
  const line = JSON.stringify({
    type: 'assistant', isSidechain: false,
    message: { model: 'sonnet', usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } },
  });
  await writeFile(path, `\n${line}\n`);
  return path;
}

test('SESSION_BUDGET_OFF short-circuits with no output', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-budget-'));
  const { code, stdout } = await run('{}', { ...process.env, HOME: home, SESSION_BUDGET_OFF: '1' });
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('a small transcript under every threshold prints only the hygiene line (quiet/allow)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-budget-'));
  const tp = await transcript(home);
  const { code, stdout } = await run(JSON.stringify({ transcript_path: tp, prompt: 'Fix the bug.' }), { ...process.env, HOME: home });
  assert.equal(code, 0);
  assert.match(stdout, /sessions .* GB .* swap \d+%/);
  assert.doesNotMatch(stdout, /\[session-budget\]/);
});

test('a driven-to-zero MB threshold trips the hard tier (block-like output)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-budget-'));
  const tp = await transcript(home);
  const { code, stdout } = await run(
    JSON.stringify({ transcript_path: tp, prompt: 'Fix the bug.' }),
    { ...process.env, HOME: home, SESSION_BUDGET_HARD_MB: '0' },
  );
  assert.equal(code, 0);
  assert.match(stdout, /\[session-budget\].*OVER the retire threshold/s);
});

test('a slash-command prompt is skipped even with a hard threshold of 0', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-budget-'));
  const tp = await transcript(home);
  const { code, stdout } = await run(
    JSON.stringify({ transcript_path: tp, prompt: '/long-run' }),
    { ...process.env, HOME: home, SESSION_BUDGET_HARD_MB: '0' },
  );
  assert.equal(code, 0);
  // Only the unconditional hygiene line prints; the budget tier itself is skipped.
  assert.match(stdout, /^\d+ sessions .* GB .* swap \d+%\n$/);
  assert.doesNotMatch(stdout, /\[session-budget\]/);
});
