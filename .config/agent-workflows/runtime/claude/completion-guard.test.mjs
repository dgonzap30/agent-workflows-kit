import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'completion-guard.sh');
const pySource = resolve(import.meta.dirname, 'completion-guard.py');

// completion-guard.sh hardcodes $HOME/.claude/scripts/hooks/completion-guard.py (live layout).
// To exercise it without touching the real ~/.claude, point HOME at a temp home that mirrors
// that one path and nothing else.
async function fakeHome() {
  const home = await mkdtemp(join(tmpdir(), 'completion-guard-home-'));
  const dir = join(home, '.claude', 'scripts', 'hooks');
  await mkdir(dir, { recursive: true });
  await copyFile(pySource, join(dir, 'completion-guard.py'));
  return home;
}

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

test('COMPLETION_GUARD_OFF short-circuits with no output (allow)', async () => {
  const home = await fakeHome();
  const { code, stdout } = await run('{}', { ...process.env, HOME: home, COMPLETION_GUARD_OFF: '1' });
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('an ordinary sign-off with no runtime claim is allowed silently', async () => {
  const home = await fakeHome();
  const payload = JSON.stringify({ cwd: home, last_assistant_message: 'Updated the README wording.' });
  const { code, stdout } = await run(payload, { ...process.env, HOME: home, COMPLETION_GUARD_MODE: 'enforce' });
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('an unverified runtime/visual claim is nudged (block-like output), always exit 0', async () => {
  const home = await fakeHome();
  const payload = JSON.stringify({
    cwd: home,
    last_assistant_message: 'The button now shows correctly and looks right.',
  });
  const { code, stdout } = await run(payload, { ...process.env, HOME: home, COMPLETION_GUARD_MODE: 'enforce' });
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(parsed.hookSpecificOutput.additionalContext, /runtime\/visual behavior/);
});

test('missing completion-guard.py fails open with no output', async () => {
  const home = await mkdtemp(join(tmpdir(), 'completion-guard-nopy-'));
  const { code, stdout } = await run('{}', { ...process.env, HOME: home });
  assert.equal(code, 0);
  assert.equal(stdout, '');
});
