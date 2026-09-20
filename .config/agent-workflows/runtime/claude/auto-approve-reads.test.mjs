import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'auto-approve-reads.sh');

function run(input) {
  return spawnSync('bash', [script], { input, encoding: 'utf8' });
}

test('retired compatibility entry always exits 0 with no output (nominal)', () => {
  const r = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('never approves or echoes an arbitrary payload', () => {
  const r = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});
