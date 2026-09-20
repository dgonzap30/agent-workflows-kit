import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'stop-name-refresh.sh');

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'stop-name-refresh-'));
  const hooksDir = join(home, '.claude', 'scripts', 'hooks');
  await mkdir(hooksDir, { recursive: true });
  // Stub the downstream name-gen script so a real invocation never reaches the network:
  // it only proves whether stop-name-refresh.sh decided to fire.
  const stub = join(hooksDir, 'session-name-gen.sh');
  await writeFile(stub, '#!/usr/bin/env bash\ntouch "${2}.invoked"\n');
  await chmod(stub, 0o755);
  const transcript = join(home, 'transcript.jsonl');
  await writeFile(transcript, '{"type":"user","message":{"content":"hi"}}\n');
  return { home, transcript };
}

test('a manually pinned #name label skips the refresh (no-op)', async () => {
  const { home, transcript } = await fixture();
  const sid = 'sid-pinned';
  await writeFile(`/tmp/claude-session-label-${sid}`, 'Pinned Title');
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ session_id: sid, transcript_path: transcript }),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('the recursion guard env var short-circuits with no name file touched (nominal)', async () => {
  const { home, transcript } = await fixture();
  const sid = `sid-recursion-${Date.now()}`;
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ session_id: sid, transcript_path: transcript }),
    env: { ...process.env, HOME: home, CLAUDE_SESSION_NAME_GEN: '1' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const nameFile = spawnSync('test', ['-f', `/tmp/claude-session-name-${sid}`]);
  assert.notEqual(nameFile.status, 0);
});

test('no skip condition met touches the debounce name file before firing', async () => {
  const { home, transcript } = await fixture();
  const sid = `sid-fire-${Date.now()}`;
  const r = spawnSync('bash', [script], {
    input: JSON.stringify({ session_id: sid, transcript_path: transcript }),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const nameFile = spawnSync('test', ['-f', `/tmp/claude-session-name-${sid}`]);
  assert.equal(nameFile.status, 0);
  spawnSync('rm', ['-f', `/tmp/claude-session-name-${sid}`]);
});
