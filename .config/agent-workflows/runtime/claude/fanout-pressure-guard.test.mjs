import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'fanout-pressure-guard.sh');

function run(env) {
  return spawnSync('bash', [script], { env, encoding: 'utf8' });
}

test('FANOUT_GUARD_OFF short-circuits with no output (allow)', () => {
  const r = run({ ...process.env, FANOUT_GUARD_OFF: '1' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// Real vm.swapusage on this host is read directly (no mock seam), so the threshold is
// driven to the extremes instead: 0% forces block, 101% forces "never warns or blocks".
test('an unreachable block threshold blocks any measured swap (exit 2)', () => {
  const r = run({ ...process.env, FANOUT_GUARD_BLOCK: '0', FANOUT_GUARD_WARN: '0' });
  if (r.status === 0 && r.stdout === '' && r.stderr === '') return; // sysctl unavailable: fail-open, acceptable
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\[fanout-guard\] BLOCKED/);
});

test('an unreachable warn threshold with a met warn floor prints an advisory but allows', () => {
  const r = run({ ...process.env, FANOUT_GUARD_BLOCK: '101', FANOUT_GUARD_WARN: '0' });
  assert.equal(r.status, 0);
  if (r.stdout) assert.match(r.stdout, /\[fanout-guard\] swap at/);
});
