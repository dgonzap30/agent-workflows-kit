import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'auto-format.sh');

function run(input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', [script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout }));
    child.stdin.end(input);
  });
}

test('unformattable extension is a no-op (nominal allow)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-format-'));
  const file = join(root, 'note.txt');
  await writeFile(file, 'unchanged');
  const { code } = await run(JSON.stringify({ tool_input: { file_path: file } }));
  assert.equal(code, 0);
  assert.equal(await readFile(file, 'utf8'), 'unchanged');
});

test('a known extension with a local prettier binary is formatted (positive path)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auto-format-'));
  const file = join(root, 'app.js');
  await writeFile(file, 'const x=1;');
  const binDir = join(root, 'node_modules', '.bin');
  await mkdir(binDir, { recursive: true });
  const marker = join(root, 'invoked.marker');
  // Fake prettier: proves auto-format.sh actually invokes the local binary with --write <file>.
  await writeFile(join(binDir, 'prettier'), `#!/usr/bin/env bash\necho "$@" > "${marker}"\n`);
  await chmod(join(binDir, 'prettier'), 0o755);
  const { code } = await run(JSON.stringify({ tool_input: { file_path: file } }));
  assert.equal(code, 0);
  assert.equal((await readFile(marker, 'utf8')).trim(), `--write ${file}`);
});
