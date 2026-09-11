#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REMOTE_BUNDLES = Object.freeze({
  'build-ios': { packageName: 'build-ios-apps', nativePlugin: 'build-ios-apps@openai-curated' },
  'build-macos': { packageName: 'build-macos-apps', nativePlugin: 'build-macos-apps@openai-curated' },
  canva: { packageName: 'canva', nativePlugin: 'canva@openai-curated' },
  'hugging-face': { packageName: 'hugging-face', nativePlugin: 'hugging-face@openai-curated' },
  security: { packageName: 'codex-security', nativePlugin: 'codex-security@openai-curated' },
  vercel: { packageName: 'vercel', nativePlugin: 'vercel@openai-curated' },
  waldo: { packageName: 'waldo', nativePlugin: 'waldo@openai-curated' },
});

const bundleEntries = Object.entries(REMOTE_BUNDLES);

function usage() {
  return [
    'usage: codex-catalog [list|status]',
    '       codex-catalog activate <bundle>',
    '       codex-catalog deactivate',
    '',
    `bundles: ${Object.keys(REMOTE_BUNDLES).join(', ')}`,
  ].join('\n');
}

function parseArgs(argv, env) {
  const positional = [];
  let configPath = env.CODEX_CONFIG_PATH
    ? resolve(env.CODEX_CONFIG_PATH)
    : join(homedir(), '.codex', 'config.toml');
  let backupDir = env.CODEX_CATALOG_BACKUP_DIR
    ? resolve(env.CODEX_CATALOG_BACKUP_DIR)
    : undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config' || arg === '--backup-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: `${arg} requires a path` };
      if (arg === '--config') configPath = resolve(value);
      else backupDir = resolve(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg.startsWith('--')) {
      return { error: `unknown option: ${arg}` };
    } else {
      positional.push(arg);
    }
  }

  const command = positional[0] ?? 'list';
  const commandArgs = positional.slice(1);
  if (!['list', 'status', 'activate', 'deactivate'].includes(command)) {
    return { error: `unknown command: ${command}` };
  }
  if (command === 'activate' && commandArgs.length !== 1) {
    return { error: 'activate requires exactly one bundle' };
  }
  if (command !== 'activate' && commandArgs.length !== 0) {
    return { error: `${command} takes no arguments` };
  }
  if (command === 'activate' && !REMOTE_BUNDLES[commandArgs[0]]) {
    return { error: `unknown bundle: ${commandArgs[0]}` };
  }

  return {
    command,
    bundle: commandArgs[0],
    configPath,
    backupDir: backupDir ?? join(dirname(configPath), 'backups', 'catalog-switch'),
  };
}

function inspectPluginSections(source) {
  const hadTrailingNewline = source.endsWith('\n');
  const lines = source.replace(/\n$/, '').split('\n');
  const sections = new Map();

  for (const [bundle, spec] of bundleEntries) {
    const plugin = spec.nativePlugin;
    const header = `[plugins."${plugin}"]`;
    const headers = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() === header) headers.push(index);
    }
    if (headers.length !== 1) {
      throw new Error(`${plugin} section count is ${headers.length}; refusing ambiguous config`);
    }

    const start = headers[0];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index].trim().startsWith('[')) {
        end = index;
        break;
      }
    }
    const enabledLines = [];
    for (let index = start + 1; index < end; index += 1) {
      if (/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/.test(lines[index])) enabledLines.push(index);
    }
    if (enabledLines.length !== 1) {
      throw new Error(`${plugin} enabled field count is ${enabledLines.length}; refusing ambiguous config`);
    }
    const enabledIndex = enabledLines[0];
    const match = lines[enabledIndex].match(/^(\s*enabled\s*=\s*)(true|false)(\s*(?:#.*)?)$/);
    sections.set(bundle, {
      enabled: match[2] === 'true',
      enabledIndex,
      prefix: match[1],
      suffix: match[3],
    });
  }

  return { hadTrailingNewline, lines, sections };
}

export function renderCatalog(source, selectedBundle = null) {
  if (selectedBundle && !REMOTE_BUNDLES[selectedBundle]) throw new Error(`unknown bundle: ${selectedBundle}`);
  const parsed = inspectPluginSections(source);
  const { lines, sections } = parsed;
  for (const [bundle, section] of sections) {
    const enabled = bundle === selectedBundle;
    lines[section.enabledIndex] = `${section.prefix}${enabled}${section.suffix}`;
  }
  return `${lines.join('\n')}${parsed.hadTrailingNewline ? '\n' : ''}`;
}

export function catalogStatus(source) {
  const { sections } = inspectPluginSections(source);
  const enabled = [...sections]
    .filter(([, section]) => section.enabled)
    .map(([bundle]) => bundle);
  if (enabled.length > 1) throw new Error(`multiple managed native plugins enabled: ${enabled.join(', ')}`);
  return { enabled, sections };
}

async function walkSkillFiles(root, relative = '') {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) paths.push(...await walkSkillFiles(root, child));
    else if (entry.isFile() && entry.name === 'SKILL.md') paths.push(await realpath(join(root, child)));
  }
  return paths;
}

async function inspectInstalledSkills(bundle, env) {
  const spec = REMOTE_BUNDLES[bundle];
  const pluginRoot = env.CODEX_NATIVE_PLUGIN_ROOT
    ? resolve(env.CODEX_NATIVE_PLUGIN_ROOT)
    : join(homedir(), '.codex', '.tmp', 'plugins', 'plugins');
  const skillsRoot = join(pluginRoot, spec.packageName, 'skills');
  const paths = (await walkSkillFiles(skillsRoot)).sort();
  if (paths.length === 0) throw new Error(`${bundle} resolved zero skills under ${skillsRoot}`);
  for (const path of paths) {
    const skill = await readFile(path, 'utf8');
    if (!/^---\n[\s\S]*?^name:\s*\S+/m.test(skill) || !/^description:\s*\S+/m.test(skill)) {
      throw new Error(`invalid skill frontmatter: ${path}`);
    }
  }
  return paths;
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await open(lockPath, 'r');
      const [contents, openedStat] = await Promise.all([
        existing.readFile('utf8'),
        existing.stat(),
      ]);
      await existing.close();
      const lockPid = Number.parseInt(contents.trim(), 10);
      let running = Number.isInteger(lockPid) && lockPid > 0;
      if (running) {
        try {
          process.kill(lockPid, 0);
        } catch (processError) {
          running = processError?.code !== 'ESRCH';
        }
      }
      if (running) throw new Error(`catalog switch already running as pid ${lockPid}`);

      const currentStat = await lstat(lockPath);
      if (openedStat.dev !== currentStat.dev || openedStat.ino !== currentStat.ino) {
        throw new Error('catalog lock changed while checking it; retry later');
      }
      await unlink(lockPath);
    }
  }
  throw new Error('could not acquire catalog lock');
}

async function writeBackup(source, backupDir) {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  const path = join(backupDir, `config-${timestamp}-${process.pid}.toml`);
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(source, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
}

async function writeAtomic(path, contents, mode) {
  const temporary = join(dirname(path), `.${basename(path)}.catalog-${process.pid}-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode & 0o777);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    try {
      await handle.close();
    } catch {}
    try {
      await unlink(temporary);
    } catch {}
    throw error;
  }
}

function printStatus(status, stdout) {
  const active = status.enabled[0] ?? 'none';
  stdout(`codex-catalog: active remote bundle: ${active}\n`);
  for (const [bundle, spec] of bundleEntries) {
    const selected = status.sections.get(bundle).enabled ? 'enabled ' : 'disabled';
    stdout(`  ${bundle.padEnd(16)} ${selected} ${spec.nativePlugin}\n`);
  }
}

export async function runCatalog(argv, io = {}) {
  const stdout = io.stdout ?? ((value) => process.stdout.write(value));
  const stderr = io.stderr ?? ((value) => process.stderr.write(value));
  const env = io.env ?? process.env;
  const options = parseArgs(argv, env);
  if (options.help) {
    stdout(`${usage()}\n`);
    return 0;
  }
  if (options.error) {
    stderr(`codex-catalog: ${options.error}\n${usage()}\n`);
    return 2;
  }

  try {
    const info = await lstat(options.configPath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`refusing non-regular config: ${options.configPath}`);
    }
    const source = await readFile(options.configPath, 'utf8');
    if (options.command === 'list' || options.command === 'status') {
      printStatus(catalogStatus(source), stdout);
      return 0;
    }

    const releaseLock = await acquireLock(`${options.configPath}.catalog.lock`);
    try {
      const currentSource = await readFile(options.configPath, 'utf8');
      const selectedBundle = options.command === 'activate' ? options.bundle : null;
      const installedSkills = selectedBundle ? await inspectInstalledSkills(selectedBundle, env) : [];
      const output = renderCatalog(currentSource, selectedBundle);
      if (output === currentSource) {
        stdout(`codex-catalog: already ${selectedBundle ?? 'deactivated'}; no write needed\n`);
        return 0;
      }
      const backupPath = await writeBackup(currentSource, options.backupDir);
      const currentInfo = await stat(options.configPath);
      await writeAtomic(options.configPath, output, currentInfo.mode);
      if (selectedBundle) {
        stdout(`codex-catalog: activated ${selectedBundle}; validated ${installedSkills.length} installed skills\n`);
      } else {
        stdout('codex-catalog: deactivated all remote bundles\n');
      }
      stdout(`codex-catalog: previous config: ${backupPath}\n`);
      stdout('codex-catalog: start a fresh Codex task for discovery changes to take effect\n');
      if (selectedBundle) stdout('codex-catalog: run `codex-catalog deactivate` when finished\n');
      return 0;
    } finally {
      await releaseLock();
    }
  } catch (error) {
    stderr(`codex-catalog: ${error.message}\n`);
    return 1;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
async function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return await realpath(process.argv[1]) === await realpath(scriptPath);
  } catch {
    return resolve(process.argv[1]) === resolve(scriptPath);
  }
}

if (await isMainModule()) {
  process.exitCode = await runCatalog(process.argv.slice(2));
}
