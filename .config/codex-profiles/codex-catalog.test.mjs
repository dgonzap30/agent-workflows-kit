import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  REMOTE_BUNDLES,
  catalogStatus,
  renderCatalog,
  runCatalog,
} from '../../.local/bin/codex-catalog.mjs';

const execFileAsync = promisify(execFile);

function fixture(overrides = {}) {
  const sections = Object.entries(REMOTE_BUNDLES)
    .filter(([, spec]) => spec.nativePlugin)
    .map(([bundle, spec]) => [
      `[plugins."${spec.nativePlugin}"]`,
      `enabled = ${overrides[bundle] === true}`,
      '',
    ].join('\n'));
  return `model = "fixture"\n\n${sections.join('\n')}[unrelated]\nkeep = "exact"\n\n[[skills.config]]\npath = "/disabled/existing/SKILL.md"\nenabled = false\n`;
}

async function createInstalledBundle(pluginRoot, bundle, skillName = 'primary') {
  const root = join(pluginRoot, REMOTE_BUNDLES[bundle].packageName, 'skills', skillName);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'SKILL.md'), [
    '---',
    `name: ${bundle}-${skillName}`,
    `description: Fixture skill for ${bundle}.`,
    '---',
    '',
    '# Fixture',
    '',
  ].join('\n'));
}

async function harness(source = fixture()) {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-test-'));
  const configPath = join(root, 'config.toml');
  const backupDir = join(root, 'backups');
  const pluginRoot = join(root, 'installed-plugins');
  await writeFile(configPath, source, { mode: 0o600 });
  await Promise.all(Object.keys(REMOTE_BUNDLES).map((bundle) => createInstalledBundle(pluginRoot, bundle)));
  const invoke = async (...args) => {
    let stdout = '';
    let stderr = '';
    const code = await runCatalog(args, {
      env: {
        CODEX_CONFIG_PATH: configPath,
        CODEX_CATALOG_BACKUP_DIR: backupDir,
        CODEX_NATIVE_PLUGIN_ROOT: pluginRoot,
      },
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    });
    return { code, stdout, stderr };
  };
  return { backupDir, configPath, invoke, pluginRoot };
}

test('renderCatalog enables exactly one bundle without changing unrelated config', () => {
  const source = fixture({ vercel: true, canva: true });
  const output = renderCatalog(source, 'build-ios');
  const status = catalogStatus(output);
  assert.deepEqual(status.enabled, ['build-ios']);
  assert.match(output, /\[unrelated\]\nkeep = "exact"/);
});

test('activate writes atomically, preserves a byte-exact backup, and disables prior bundles', async () => {
  const source = fixture({ vercel: true });
  const h = await harness(source);
  const result = await h.invoke('activate', 'build-ios');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /activated build-ios/);
  const current = await readFile(h.configPath, 'utf8');
  const status = catalogStatus(current);
  assert.deepEqual(status.enabled, ['build-ios']);
  assert.equal(status.sections.get('build-ios').enabled, true);
  assert.equal(status.sections.get('vercel').enabled, false);
  const backups = await readdir(h.backupDir);
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(h.backupDir, backups[0]), 'utf8'), source);
});

test('deactivate clears the managed remote catalog and no-op writes create no backup', async () => {
  const h = await harness();
  assert.equal((await h.invoke('activate', 'canva')).code, 0);
  assert.equal((await h.invoke('deactivate')).code, 0);
  const status = catalogStatus(await readFile(h.configPath, 'utf8'));
  assert.deepEqual(status.enabled, []);
  const second = await h.invoke('deactivate');
  assert.equal(second.code, 0);
  assert.match(second.stdout, /no write needed/);
  assert.equal((await readdir(h.backupDir)).length, 2);
});

test('unknown bundles fail closed without changing config', async () => {
  const source = fixture();
  const h = await harness(source);
  const result = await h.invoke('activate', 'unknown');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown bundle/);
  assert.equal(await readFile(h.configPath, 'utf8'), source);
});

test('duplicate managed native sections fail before a backup or write', async () => {
  const source = `${fixture()}\n[plugins."vercel@openai-curated"]\nenabled = false\n`;
  const h = await harness(source);
  const result = await h.invoke('activate', 'vercel');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /section count is 2/);
  assert.equal(await readFile(h.configPath, 'utf8'), source);
  await assert.rejects(readdir(h.backupDir), { code: 'ENOENT' });
});

test('status rejects stacked managed bundles', async () => {
  const h = await harness(fixture({ vercel: true, canva: true }));
  const result = await h.invoke('status');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /multiple managed native plugins enabled/);
});

test('symlink configs are never replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-link-test-'));
  const target = join(root, 'target.toml');
  const link = join(root, 'config.toml');
  await writeFile(target, fixture());
  await symlink(target, link);
  let stderr = '';
  const code = await runCatalog(['activate', 'vercel'], {
    env: { CODEX_CONFIG_PATH: link, CODEX_CATALOG_BACKUP_DIR: join(root, 'backups') },
    stdout: () => {},
    stderr: (value) => { stderr += value; },
  });
  assert.equal(code, 1);
  assert.match(stderr, /refusing non-regular config/);
  assert.deepEqual(catalogStatus(await readFile(target, 'utf8')).enabled, []);
});

test('activation fails before backup or write when installed skill payload is absent', async () => {
  const source = fixture();
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-missing-plugin-test-'));
  const configPath = join(root, 'config.toml');
  const backupDir = join(root, 'backups');
  await writeFile(configPath, source);
  let stderr = '';
  const code = await runCatalog(['activate', 'vercel'], {
    env: {
      CODEX_CONFIG_PATH: configPath,
      CODEX_CATALOG_BACKUP_DIR: backupDir,
      CODEX_NATIVE_PLUGIN_ROOT: join(root, 'missing-plugins'),
    },
    stdout: () => {},
    stderr: (value) => { stderr += value; },
  });
  assert.equal(code, 1);
  assert.match(stderr, /ENOENT/);
  assert.equal(await readFile(configPath, 'utf8'), source);
  await assert.rejects(readdir(backupDir), { code: 'ENOENT' });
});

test('the executable runs through a symlink entrypoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-catalog-entrypoint-test-'));
  const configPath = join(root, 'config.toml');
  const entrypoint = join(root, 'codex-catalog');
  await writeFile(configPath, fixture());
  await symlink(new URL('../../.local/bin/codex-catalog.mjs', import.meta.url), entrypoint);
  const { stdout } = await execFileAsync(entrypoint, ['status'], {
    env: { ...process.env, CODEX_CONFIG_PATH: configPath },
  });
  assert.match(stdout, /active remote bundle: none/);
});
