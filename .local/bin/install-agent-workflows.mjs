#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultSource = resolve(dirname(scriptPath), '../..');
const stateRelative = join('.config', 'agent-workflows', 'install-state.json');
const managedRoot = join('.config', 'agent-workflows');

// Gitignored, machine-specific, and never published. Each has a committed
// .example.json sibling that readPolicy() falls back to.
const personalPolicyFiles = [
  join('policy', 'claude-settings.json'),
  join('policy', 'codex-config.json'),
  join('policy', 'owner.json'),
];

function parseArgs(argv) {
  let mode = 'check';
  let selectedMode = false;
  let home = homedir();
  let source = defaultSource;
  let backupDir;
  let restoreDir;
  let adopt = false;
  let previousSource;
  let adapter;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check' || arg === '--install') {
      if (selectedMode) return { error: 'choose exactly one of --check, --install, or --restore' };
      mode = arg.slice(2);
      selectedMode = true;
    } else if (arg === '--restore') {
      if (selectedMode) return { error: 'choose exactly one of --check, --install, or --restore' };
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: '--restore requires a rollback bundle path' };
      mode = 'restore';
      restoreDir = resolve(value);
      selectedMode = true;
      index += 1;
    } else if (arg === '--home' || arg === '--source' || arg === '--backup-dir' || arg === '--previous-source' || arg === '--adapter') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) return { error: `${arg} requires a path` };
      if (arg === '--adapter') { if (!['desktop','portable'].includes(value)) return { error: 'adapter must be desktop or portable' }; adapter=value; }
      else if (arg === '--home') home = resolve(value);
      else if (arg === '--source') source = resolve(value);
      else if (arg === '--previous-source') previousSource = resolve(value);
      else backupDir = resolve(value);
      index += 1;
    } else if (arg === '--adopt') {
      adopt = true;
    } else {
      return { error: `unknown option: ${arg}` };
    }
  }

  if (adopt && mode !== 'install') return { error: '--adopt is valid only with --install' };
  if (previousSource && (!adopt || mode !== 'install')) return { error: '--previous-source requires --install --adopt' };
  if (mode === 'restore' && backupDir) return { error: '--backup-dir cannot be combined with --restore' };
  return {
    adopt,
    backupDir: backupDir ?? join(home, '.config', 'agent-workflows', 'backups'),
    home,
    mode,
    restoreDir,
    source,
    previousSource,
    adapter,
  };
}

function hashContents(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

async function hashFile(path) {
  return hashContents(await readFile(path));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

// A host that has never launched the runtime has no settings file yet. That is a
// first install, not an error.
async function readTextOrEmpty(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return '';
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function readJsonOrEmptyObject(path) {
  const text = await readTextOrEmpty(path);
  return text.trim() ? JSON.parse(text) : {};
}

// Personal policy files are gitignored, so a fresh clone carries only the
// sanitized example. Fall back to it rather than failing the install.
async function readPolicy(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return readJson(path.replace(/\.json$/, '.example.json'));
  }
}

async function walkFiles(root, prefix = '') {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
}

async function verifyManifest(source) {
  const manifestPath = join(source, managedRoot, 'manifest.json');
  const manifest = await readJson(manifestPath);
  if (manifest.version !== 2 || !manifest.files || Array.isArray(manifest.files)) {
    throw new Error('source manifest has an unsupported shape');
  }

  const expectedFiles = Object.keys(manifest.files).sort();
  if (expectedFiles.length === 0) throw new Error('source manifest is empty');
  for (const file of expectedFiles) {
    const actual = await hashFile(join(source, file));
    if (actual !== manifest.files[file]) throw new Error(`source hash mismatch: ${file}`);
  }

  const managedFiles = (await walkFiles(join(source, managedRoot)))
    .filter((file) => file !== 'manifest.json')
    .filter((file) => !personalPolicyFiles.includes(file))
    .map((file) => join(managedRoot, file));
  managedFiles.push(join('.local', 'bin', 'install-agent-workflows.mjs'));
  managedFiles.push(join('.local', 'bin', 'agent-catalog-check.mjs'), join('.local', 'bin', 'codex-catalog.mjs'));
  // A profile shipping a .example sibling is machine-local: gitignored, absent
  // from a clone, and therefore not part of the managed inventory.
  const profileNames = await readdir(join(source, '.config', 'codex-profiles'));
  const localProfiles = new Set(
    profileNames.filter((name) => name.endsWith('.config.toml.example')).map((name) => name.slice(0, -'.example'.length)),
  );
  managedFiles.push(...profileNames
    .filter((name) => name.endsWith('.config.toml') && !localProfiles.has(name))
    .map((name) => join('.config', 'codex-profiles', name)));
  managedFiles.sort();
  if (JSON.stringify(managedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('source inventory differs from the manifest');
  }
  return manifest;
}

function renderTemplate(template, replacements) {
  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!Object.hasOwn(replacements, key)) throw new Error(`missing runtime replacement: ${key}`);
    return replacements[key];
  });
  const unresolved = rendered.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (unresolved) throw new Error(`unresolved runtime replacement: ${unresolved[0]}`);
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`;
}

async function renderInstructions(source, adapter) {
  const root = join(source, managedRoot, 'policy');
  const [template, runtimes] = await Promise.all([
    readFile(join(root, 'instructions.md.tmpl'), 'utf8'),
    readJson(join(root, 'runtimes.json')),
  ]);
  if (runtimes.version !== 1 || !Array.isArray(runtimes.runtimes)) {
    throw new Error('runtime policy has an unsupported shape');
  }
  // The published defaults are neutral. A gitignored policy/owner.json lets the
  // machine's owner put their own name and workspace map back, without those
  // details shipping to anyone who clones the kit.
  let owner = {};
  try {
    owner = await readJson(join(source, managedRoot, 'policy', 'owner.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return runtimes.runtimes.map((runtime) => ({
    ...runtime,
    output: renderTemplate(template, { ...(runtime.replacements ?? {}), ...owner }) + (adapter === 'portable' ? '\nPortable host: use the actual working directory and its nearest instructions. Desktop-specific maps, paths, UI hooks and profiles are not installed on this host.\n' : ''),
  }));
}

function pathParts(path) {
  const parts = path.split('.');
  if (parts.some((part) => part.length === 0)) throw new Error(`invalid policy path: ${path}`);
  return parts;
}

function getPath(root, path) {
  let value = root;
  for (const part of pathParts(path)) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function setPath(root, path, value) {
  const parts = pathParts(path);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (!parent[part] || typeof parent[part] !== 'object' || Array.isArray(parent[part])) parent[part] = {};
    parent = parent[part];
  }
  parent[parts.at(-1)] = value;
}

function deletePath(root, path) {
  const parts = pathParts(path);
  let parent = root;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) return;
    parent = parent[part];
  }
  if (parent && typeof parent === 'object') delete parent[parts.at(-1)];
  for (let index = parts.length - 1; index > 0; index -= 1) {
    let node = root;
    for (const part of parts.slice(0, index - 1)) node = node?.[part];
    const key = parts[index - 1];
    if (node?.[key] && typeof node[key] === 'object' && !Array.isArray(node[key]) && Object.keys(node[key]).length === 0) {
      delete node[key];
    }
  }
}

function hookHandlers(settings) {
  const handlers = [];
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      for (const hook of group.hooks) {
        if (hook?.type === 'command' && typeof hook.command === 'string') {
          handlers.push({ event, group, hook, matcher: group.matcher ?? '' });
        }
      }
    }
  }
  return handlers;
}

function ruleMatches(rule, event, command) {
  return rule.events.includes(event) && command.includes(rule.contains);
}

function normalizeClaudeSettings(settings, policy) {
  const output = structuredClone(settings);
  for (const [path, value] of Object.entries(policy.set ?? {})) setPath(output, path, value);
  for (const path of policy.delete ?? []) deletePath(output, path);
  if (Array.isArray(output.permissions?.allow)) {
    output.permissions.allow = output.permissions.allow.filter((value) => !(policy.removeAllow ?? []).includes(value));
  }

  for (const [event, groups] of Object.entries(output.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    const keptGroups = [];
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) {
        keptGroups.push(group);
        continue;
      }
      group.hooks = group.hooks.filter((hook) => {
        if (hook?.type !== 'command' || typeof hook.command !== 'string') return true;
        return !(policy.forbidCommands ?? []).some((rule) => ruleMatches(rule, event, hook.command));
      });
      for (const hook of group.hooks) {
        if (hook?.type !== 'command' || typeof hook.command !== 'string') continue;
        const replacement = (policy.replaceCommands ?? []).find((rule) => hook.command === rule.from);
        if (replacement) hook.command = replacement.to;
        if ((policy.asyncCommands ?? []).some((rule) => ruleMatches(rule, event, hook.command))) hook.async = true;
        if ((policy.syncRequiredCommands ?? []).some((token) => hook.command.includes(token))) delete hook.async;
      }
      if (group.hooks.length > 0) keptGroups.push(group);
    }
    output.hooks[event] = keptGroups;
  }
  return output;
}

function claudeProjection(settings, policy) {
  const handlers = hookHandlers(settings);
  return {
    removedAllow: (policy.removeAllow ?? []).map((value) => ({ value, present: settings.permissions?.allow?.includes(value) === true })),
    deleted: Object.fromEntries((policy.delete ?? []).map((path) => [path, getPath(settings, path) === undefined])),
    forbidden: (policy.forbidCommands ?? []).map((rule) => ({
      ...rule,
      matches: handlers.filter(({ event, hook }) => ruleMatches(rule, event, hook.command)).length,
    })),
    replacements: (policy.replaceCommands ?? []).map((rule) => ({
      ...rule,
      fromMatches: handlers.filter(({ hook }) => hook.command === rule.from).length,
      toMatches: handlers.filter(({ hook }) => hook.command === rule.to).length,
    })),
    async: (policy.asyncCommands ?? []).map((rule) => ({
      ...rule,
      matches: handlers
        .filter(({ event, hook }) => ruleMatches(rule, event, hook.command))
        .map(({ event, hook, matcher }) => ({ async: hook.async === true, command: hook.command, event, matcher })),
    })),
    set: Object.fromEntries(Object.keys(policy.set ?? {}).map((path) => [path, getPath(settings, path)])),
    syncRequired: (policy.syncRequiredCommands ?? []).map((token) => ({
      token,
      matches: handlers
        .filter(({ hook }) => hook.command.includes(token))
        .map(({ event, hook, matcher }) => ({ async: hook.async === true, command: hook.command, event, matcher })),
    })),
  };
}

function validateClaudeProjection(projection) {
  const issues = [];
  for (const entry of projection.removedAllow ?? []) if (entry.present) issues.push(`unsafe global allow remains: ${entry.value}`);
  for (const [path, deleted] of Object.entries(projection.deleted)) {
    if (!deleted) issues.push(`Claude setting should be absent: ${path}`);
  }
  for (const rule of projection.forbidden) {
    if (rule.matches !== 0) issues.push(`forbidden Claude hook remains on ${rule.events.join('|')}: ${rule.contains}`);
  }
  for (const rule of projection.replacements) {
    if (rule.fromMatches !== 0 || rule.toMatches !== 1) issues.push(`Claude hook replacement is not exact: ${rule.from}`);
  }
  for (const rule of projection.async) {
    const blocking = rule.matches.filter((match) => !match.async);
    if (blocking.length > 0) issues.push(`telemetry hook remains synchronous: ${rule.contains}`);
  }
  for (const rule of projection.syncRequired) {
    const asynchronous = rule.matches.filter((match) => match.async);
    if (asynchronous.length > 0) issues.push(`safety hook became asynchronous: ${rule.token}`);
  }
  return issues;
}

async function planClaudeSettings(home, source, adapter) {
  const path = join(home, '.claude', 'settings.json');
  const [settings, policy, sourceText] = await Promise.all([
    readJsonOrEmptyObject(path),
    readPolicy(join(source, managedRoot, 'policy', adapter === 'portable' ? 'portable-claude-settings.json' : 'claude-settings.json')),
    readTextOrEmpty(path),
  ]);
  const exists = await pathExists(path);
  if (policy.version !== 1) throw new Error('Claude settings policy has an unsupported shape');
  const normalized = normalizeClaudeSettings(settings, policy);
  const projection = claudeProjection(normalized, policy);
  const issues = validateClaudeProjection(projection);
  if (issues.length > 0) throw new Error(issues.join('; '));
  const output = `${JSON.stringify(normalized, null, 2)}\n`;
  return {
    changed: output !== sourceText,
    exists,
    output,
    path,
    policy,
    projection,
    source: sourceText,
  };
}

async function planInstructions(home, source, adapter) {
  const runtimes = await renderInstructions(source, adapter);
  const assets = await readOptionalJson(join(source, managedRoot, 'policy', 'assets.json'));
  if (assets && (assets.version !== 1 || !Array.isArray(assets.files))) throw new Error('unsupported asset policy');
  for (const asset of assets?.files ?? []) {
    if (adapter === 'portable' && asset.portable !== true) continue;
    const input = resolve(source, managedRoot, asset.source);
    if (!input.startsWith(`${resolve(source, managedRoot)}${sep}`)) throw new Error('asset source escapes managed root');
    runtimes.push({ name: asset.file, file: asset.file, output: await readFile(input, 'utf8') });
  }
  for (const transform of assets?.transforms ?? []) {
    if (adapter === 'portable') continue;
    if (transform.kind !== 'remove-line-prefixes' || !Array.isArray(transform.prefixes)) throw new Error('unsupported asset transform');
    const path = resolve(home, transform.file);
    if (!path.startsWith(`${resolve(home)}${sep}`)) throw new Error('asset transform escapes home');
    let current;
    try { current = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const output = current.split('\n').filter((line) => !transform.prefixes.some((prefix) => line.startsWith(prefix))).join('\n');
    runtimes.push({ name: transform.file, file: transform.file, output, transform: true });
  }
  const seen = new Set();
  return Promise.all(runtimes.map(async (runtime) => {
    const path = join(home, runtime.file);
    if (!resolve(path).startsWith(`${resolve(home)}${sep}`) || seen.has(path)) throw new Error('invalid or duplicate asset destination');
    seen.add(path);
    let current = '';
    let exists = true;
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`refusing symlink file destination: ${path}`);
      current = await readFile(path, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    return {
      changed: !exists || current !== runtime.output,
      exists,
      transform: runtime.transform === true,
      file: runtime.file,
      name: runtime.name,
      output: runtime.output,
      path,
      source: current,
    };
  }));
}

function validateCodexConfigPolicy(policy) {
  if (policy.version !== 1 || !Array.isArray(policy.removeProjectTrustPaths)) {
    throw new Error('Codex config policy has an unsupported shape');
  }
  const unique = new Set(policy.removeProjectTrustPaths);
  if (unique.size !== policy.removeProjectTrustPaths.length) throw new Error('Codex config policy has duplicate project paths');
  for (const path of unique) {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new Error(`invalid Codex project trust path: ${path}`);
  }
}

function codexProjectHeader(path) {
  return `[projects.${JSON.stringify(path)}]`;
}

function codexConfigProjection(contents, policy) {
  const counts = Object.fromEntries(policy.removeProjectTrustPaths.map((path) => [path, 0]));
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    for (const path of policy.removeProjectTrustPaths) {
      if (trimmed === codexProjectHeader(path)) counts[path] += 1;
    }
  }
  const toggles = {};
  for (const [header, enabled] of Object.entries(policy.enabledSections ?? {})) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = contents.match(new RegExp(`^${escaped}\\s*\\n([^]*?)(?=^\\[|$(?![^]))`, 'm'))?.[1] ?? '';
    const values = [...block.matchAll(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/gm)];
    toggles[header] = values.length === 1 && (values[0][1] === 'true') === enabled;
  }
  return { removedProjectTrustPaths: Object.fromEntries(Object.entries(counts).map(([path, count]) => [path, count === 0])), enabledSections: toggles };
}

function normalizeCodexConfig(contents, policy) {
  const targets = new Set(policy.removeProjectTrustPaths.map(codexProjectHeader));
  const lines = contents.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const output = [];
  let removing = false;
  for (const line of lines) {
    const trimmed = line.replace(/\n$/, '').trim();
    const heading = trimmed.match(/^(\[\[?[^\]]+\]\]?)(?:\s*#.*)?$/)?.[1];
    if (heading) removing = targets.has(heading);
    if (!removing) output.push(line);
  }
  let result = output.join('');
  for (const [header, enabled] of Object.entries(policy.enabledSections ?? {})) {
    const rows = result.trimEnd().split('\n');
    const indices = rows.flatMap((line, i) => line.trim() === header ? [i] : []);
    if (indices.length > 1) throw new Error(`ambiguous managed section: ${header}`);
    if (indices.length === 0) rows.push('', header, `enabled = ${enabled}`);
    else {
      const start = indices[0];
      let end = start + 1;
      while (end < rows.length && !rows[end].trim().startsWith('[')) end++;
      const fields = rows.slice(start + 1, end).flatMap((line, i) => /^\s*enabled\s*=/.test(line) ? [start + 1 + i] : []);
      if (fields.length > 1) throw new Error(`ambiguous enabled field: ${header}`);
      if (fields.length) rows[fields[0]] = `enabled = ${enabled}`;
      else rows.splice(start + 1, 0, `enabled = ${enabled}`);
    }
    result = rows.join('\n') + '\n';
  }
  return result;
}

async function planCodexConfig(home, source, adapter) {
  const path = join(home, '.codex', 'config.toml');
  const [sourceText, policy] = await Promise.all([
    readTextOrEmpty(path),
    readPolicy(join(source, managedRoot, 'policy', adapter === 'portable' ? 'portable-codex-config.json' : 'codex-config.json')),
  ]);
  const exists = await pathExists(path);
  validateCodexConfigPolicy(policy);
  const output = normalizeCodexConfig(sourceText, policy);
  const projection = codexConfigProjection(output, policy);
  if (Object.values(projection.removedProjectTrustPaths).some((removed) => !removed)) {
    throw new Error('Codex config policy failed to remove a managed project path');
  }
  if (Object.values(projection.enabledSections).some((correct) => !correct)) throw new Error('Codex enabled-section policy failed');
  return {
    changed: output !== sourceText,
    exists,
    output,
    path,
    policy,
    projection,
    source: sourceText,
  };
}

function inspectCodexHooks(hooks) {
  const issues = [];
  for (const { event, hook } of hookHandlers(hooks)) {
    if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event) && hook.command.includes('OpenIslandHooks')) {
      issues.push(`Codex per-tool OpenIsland hook remains on ${event}`);
    }
  }
  return issues;
}

async function inspectSymlink(path, expected, install, previous) {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) throw new Error(`refusing non-symlink target: ${path}`);
    const current = resolve(dirname(path), await readlink(path));
    if (current !== resolve(expected)) {
      if (!install || !previous || current !== resolve(previous)) throw new Error(`symlink target drift: ${path}`);
      return { create: false, replace: true, previous: await readlink(path), expected, path };
    }
    return { create: false, expected, path };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (!install) throw new Error(`required symlink is missing: ${path}`);
    return { create: true, expected, path };
  }
}

async function planLinks(home, source, install, previousSource, adapter) {
  const sourceSkill = join(source, managedRoot, 'skills', 'long-run');
  const canonicalSkill = join(home, managedRoot, 'skills', 'long-run');
  const specs = [
    [canonicalSkill, sourceSkill],
    [join(home, managedRoot, 'hooks'), join(source, managedRoot, 'hooks')],
    [join(home, '.codex', 'skills', 'long-run'), canonicalSkill],
    [join(home, '.claude', 'skills', 'long-run'), canonicalSkill],
  ];
  const profileRoot = join(source, '.config', 'codex-profiles');
  const profileEntries = await readdir(profileRoot);
  const localProfileFiles = new Set(
    profileEntries.filter((name) => name.endsWith('.config.toml.example')).map((name) => name.slice(0, -'.example'.length)),
  );
  for (const file of profileEntries.filter((name) => name.endsWith('.config.toml') && !localProfileFiles.has(name)).sort()) {
    if (adapter === 'portable') continue;
    specs.push([join(home, '.codex', file), join(profileRoot, file)]);
  }
  for (const [name, file] of [
    ['agent-catalog-check', 'agent-catalog-check.mjs'],
    ['codex-catalog', 'codex-catalog.mjs'],
    ['install-agent-workflows', 'install-agent-workflows.mjs'],
  ]) {
    if (adapter === 'portable' && name !== 'install-agent-workflows') continue;
    specs.push([join(home, '.local', 'bin', name), join(source, '.local', 'bin', file)]);
  }
  return Promise.all(specs.map(([path, expected]) => {
    const previous = previousSource && expected.startsWith(`${source}${sep}`) ? join(previousSource, relative(source, expected)) : undefined;
    return inspectSymlink(path, expected, install, previous);
  }));
}

async function writeAtomic(path, contents, mode) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.agent-workflows-${process.pid}-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', mode & 0o777);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    try { await handle.close(); } catch {}
    try { await unlink(temporary); } catch {}
    throw error;
  }
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function assertPriorState(home, state, instructions, settings, codexConfig, adopt) {
  if (adopt) return;
  if (!state) {
    // --adopt means "take ownership of files I did not install, without
    // verifying them". On a host where none of the managed targets exist
    // there is nothing to adopt and nothing to overwrite, so a genuine first
    // install does not need the flag. Anything already present still does.
    const present = [
      ...instructions.filter((plan) => plan.exists !== false).map((plan) => plan.path),
      ...(settings.exists ? [settings.path] : []),
      ...(codexConfig.exists ? [codexConfig.path] : []),
    ];
    if (present.length === 0) return;
    throw new Error(`install state is missing and these files already exist; re-run with --adopt to take ownership: ${present.join(', ')}`);
  }
  if (state.version !== 1 || !state.managedFiles || !state.claudeSettingsProjection || !state.claudeSettingsPolicy
    || !state.codexConfigProjection || !state.codexConfigPolicy) {
    throw new Error('install state has an unsupported shape');
  }
  for (const plan of instructions) {
    if (plan.transform) {
      if (plan.changed) throw new Error(`managed transform drift: ${plan.path}`);
      continue;
    }
    const expected = state.managedFiles[plan.file];
    if (!expected) throw new Error(`install state does not own ${plan.file}; use --adopt`);
    if (hashContents(plan.source) !== expected) throw new Error(`managed instruction drift: ${join(home, plan.file)}`);
  }
  const currentProjection = claudeProjection(JSON.parse(settings.source), state.claudeSettingsPolicy);
  if (hashContents(JSON.stringify(currentProjection)) !== hashContents(JSON.stringify(state.claudeSettingsProjection))) {
    throw new Error('managed Claude settings drift; inspect and use --adopt only if intentional');
  }
  const currentCodexProjection = codexConfigProjection(codexConfig.source, state.codexConfigPolicy);
  if (hashContents(JSON.stringify(currentCodexProjection)) !== hashContents(JSON.stringify(state.codexConfigProjection))) {
    throw new Error('managed Codex config drift; inspect and use --adopt only if intentional');
  }
}

function newState(manifest, instructions, settings, codexConfig, backup, adapter) {
  return {
    version: 1,
    adapter,
    installedAt: new Date().toISOString(),
    sourceManifestSha256: hashContents(JSON.stringify(manifest)),
    managedFiles: Object.fromEntries(instructions.map((plan) => [plan.file, hashContents(plan.output)])),
    claudeSettingsPolicy: settings.policy,
    claudeSettingsProjection: settings.projection,
    codexConfigPolicy: codexConfig.policy,
    codexConfigProjection: codexConfig.projection,
    lastRollbackBundle: backup,
  };
}

async function createRollbackBundle(home, backupRoot, files, postContents, links, stateExisted) {
  const createdDirectories = new Set();
  for (const target of [...files.map((file) => file.path), ...links.filter((link) => link.create).map((link) => link.path), join(home, stateRelative)]) {
    for (let parent = dirname(target); parent !== resolve(home) && parent.startsWith(`${resolve(home)}${sep}`); parent = dirname(parent)) {
      try { await lstat(parent); break; } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        createdDirectories.add(relative(home, parent));
      }
    }
  }
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await chmod(backupRoot, 0o700);
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const bundle = join(backupRoot, `${stamp}-${process.pid}`);
  await mkdir(bundle, { mode: 0o700 });
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    files: {},
    inventories: {},
    requiredDirectories: [],
    restore: {},
    createdLinks: links.filter((link) => link.create).map((link) => ({
      path: relative(home, link.path),
      target: link.expected,
    })),
    replacedLinks: links.filter((link) => link.replace).map((link) => ({ path: relative(home, link.path), previous: link.previous, target: link.expected })),
    createdFiles: [],
    createdDirectories: [...createdDirectories].sort((a, b) => b.split(sep).length - a.split(sep).length),
    stateExisted,
  };

  for (const file of files) {
    const rel = relative(home, file.path);
    if (rel.startsWith('..') || rel === '') throw new Error(`rollback path escapes home: ${file.path}`);
    if (file.exists === false) {
      manifest.createdFiles.push({ path: rel, postSha256: hashContents(postContents.get(file.path)) });
      continue;
    }
    const destination = join(bundle, rel);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const info = await stat(file.path);
    const contents = await readFile(file.path);
    await writeFile(destination, contents, { mode: info.mode & 0o777 });
    manifest.files[rel] = hashContents(contents);
    manifest.restore[rel] = {
      mode: info.mode & 0o777,
      postSha256: hashContents(postContents.get(file.path)),
      preSha256: manifest.files[rel],
    };
  }
  const manifestPath = join(bundle, 'rollback-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { bundle, manifest };
}

async function validateRollbackManifest(home, bundle) {
  const info = await lstat(bundle);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error('rollback bundle must be an owner-only directory');
  const manifest = await readJson(join(bundle, 'rollback-manifest.json'));
  if (manifest.schemaVersion !== 1 || !manifest.files || !manifest.restore) {
    throw new Error('rollback manifest has an unsupported shape');
  }
  const contained = (root, rel) => {
    if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.includes('\0') || rel.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('invalid rollback relative path');
    const target = resolve(root, rel);
    if (!target.startsWith(`${resolve(root)}${sep}`) || relative(root, target) !== rel) throw new Error(`rollback path escapes selected root: ${rel}`);
    return target;
  };
  const regularParents = async (root, target) => {
    for (let parent = dirname(target); parent !== resolve(root); parent = dirname(parent)) {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('rollback parent is not a regular directory');
    }
  };
  if (Array.isArray(manifest.files) || Array.isArray(manifest.restore) || typeof manifest.files !== 'object' || typeof manifest.restore !== 'object') throw new Error('invalid rollback file maps');
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(Object.keys(manifest.restore).sort())) throw new Error('rollback files and restore keys differ');
  const paths = new Set();
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const source = contained(bundle, rel);
    const target = contained(home, rel);
    await regularParents(bundle, source);
    await regularParents(home, target);
    if (!(await lstat(source)).isFile() || (await lstat(source)).isSymbolicLink()) throw new Error('invalid rollback source file');
    const receipt = manifest.restore[rel];
    if (!/^[a-f0-9]{64}$/.test(expected) || receipt?.preSha256 !== expected || !/^[a-f0-9]{64}$/.test(receipt?.postSha256) || !Number.isInteger(receipt.mode) || receipt.mode < 0 || receipt.mode > 0o777) throw new Error('invalid rollback file receipt');
    if (await hashFile(source) !== expected) throw new Error(`rollback hash mismatch: ${rel}`);
    paths.add(rel);
  }
  for (const key of ['createdFiles', 'createdLinks', 'replacedLinks', 'createdDirectories']) {
    if (manifest[key] === undefined) continue;
    if (!Array.isArray(manifest[key])) throw new Error(`invalid rollback collection: ${key}`);
    for (const item of manifest[key]) {
      const rel = key === 'createdDirectories' ? item : item?.path;
      const target = contained(home, rel);
      if (paths.has(rel)) throw new Error(`duplicate rollback path: ${rel}`);
      paths.add(rel);
      await regularParents(home, target);
      if (key === 'createdFiles' && !/^[a-f0-9]{64}$/.test(item.postSha256)) throw new Error('invalid created-file receipt');
      if (key.endsWith('Links') && (typeof item.target !== 'string' || !item.target || item.target.includes('\0'))) throw new Error('invalid link receipt');
      if (key === 'replacedLinks' && (typeof item.previous !== 'string' || !item.previous || item.previous.includes('\0'))) throw new Error('invalid previous-link receipt');
      if (key === 'createdDirectories' && (!(await lstat(target)).isDirectory() || (await lstat(target)).isSymbolicLink())) throw new Error('created directory drift');
    }
  }
  return manifest;
}

async function restoreBundle(home, bundle, stdout) {
  const manifest = await validateRollbackManifest(home, bundle);
  for (const [rel, receipt] of Object.entries(manifest.restore)) {
    const target = resolve(home, rel);
    if ((await lstat(target)).isSymbolicLink()) throw new Error(`rollback target became symlink: ${target}`);
    const current = await hashFile(target);
    if (current !== receipt.postSha256) throw new Error(`rollback target drift: ${target}`);
  }
  for (const link of manifest.createdLinks ?? []) {
    const path = resolve(home, link.path);
    const info = await lstat(path);
    if (!info.isSymbolicLink() || resolve(dirname(path), await readlink(path)) !== resolve(link.target)) {
      throw new Error(`rollback link drift: ${path}`);
    }
  }
  for (const file of manifest.createdFiles ?? []) {
    const target = resolve(home, file.path);
    if (!target.startsWith(`${resolve(home)}${sep}`) || (await lstat(target)).isSymbolicLink() || await hashFile(target) !== file.postSha256) throw new Error(`rollback created-file drift: ${target}`);
  }
  for (const link of manifest.replacedLinks ?? []) {
    const target = resolve(home, link.path);
    if (!target.startsWith(`${resolve(home)}${sep}`) || !(await lstat(target)).isSymbolicLink() || await readlink(target) !== link.target) throw new Error(`rollback replaced-link drift: ${target}`);
  }
  for (const [rel, receipt] of Object.entries(manifest.restore)) {
    const target = resolve(home, rel);
    await writeAtomic(target, await readFile(resolve(bundle, rel)), receipt.mode);
  }
  for (const link of [...(manifest.createdLinks ?? [])].reverse()) await unlink(resolve(home, link.path));
  for (const file of manifest.createdFiles ?? []) await unlink(resolve(home, file.path));
  for (const link of manifest.replacedLinks ?? []) {
    const target = resolve(home, link.path);
    await unlink(target);
    await symlink(link.previous, target);
  }
  const statePath = join(home, stateRelative);
  if (!manifest.stateExisted) {
    try { await unlink(statePath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  for (const rel of [...(manifest.createdDirectories ?? [])].sort((a, b) => b.split(sep).length - a.split(sep).length)) {
    try { await rmdir(resolve(home, rel)); } catch (error) {
      // Never remove a directory populated by another process. Backup directories also remain.
      if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error;
    }
  }
  stdout(`agent-workflows: restore ok; bundle=${bundle}\n`);
}

export async function runInstaller(argv, io = {}) {
  const stdout = io.stdout ?? ((value) => process.stdout.write(value));
  const stderr = io.stderr ?? ((value) => process.stderr.write(value));
  const options = parseArgs(argv);
  if (options.error) {
    stderr(`agent-workflows: ${options.error}\n`);
    return 2;
  }

  try {
    if (options.mode === 'restore') {
      await restoreBundle(options.home, options.restoreDir, stdout);
      return 0;
    }

    const manifest = await verifyManifest(options.source);
    const install = options.mode === 'install';
    const statePath = join(options.home, stateRelative);
    const state = await readOptionalJson(statePath);
    const adapter = options.adapter ?? state?.adapter ?? 'desktop';
    if (!['desktop','portable'].includes(adapter)) throw new Error('invalid stored adapter');
    if (state && adapter !== (state.adapter ?? 'desktop')) throw new Error('adapter transition requires a separate migration; existing managed assets must not be orphaned');
    const [instructions, settings, codexConfig, links, codexHooks] = await Promise.all([
      planInstructions(options.home, options.source, adapter),
      planClaudeSettings(options.home, options.source, adapter),
      planCodexConfig(options.home, options.source, adapter),
      planLinks(options.home, options.source, install, options.previousSource, adapter),
      readOptionalJson(join(options.home, '.codex', 'hooks.json')).then((value) => value ?? {hooks:{}}),
    ]);
    const codexHookIssues = inspectCodexHooks(codexHooks);
    if (codexHookIssues.length > 0) throw new Error(codexHookIssues.join('; '));

    if (install) await assertPriorState(options.home, state, instructions, settings, codexConfig, options.adopt);

    const changedInstructions = instructions.filter((plan) => plan.changed);
    const changed = changedInstructions.length + Number(settings.changed) + Number(codexConfig.changed)
      + links.filter((link) => link.create || link.replace).length;

    if (!install) {
      if (!state) throw new Error('install state is missing');
      if (changed > 0) throw new Error(`managed configuration drift: changes=${changed}`);
      await assertPriorState(options.home, state, instructions, settings, codexConfig, false);
      stdout(`agent-workflows: check ok; instructions=${instructions.length}; links=${links.length}; settings=managed; codex-config=managed\n`);
      return 0;
    }

    const filesToBackup = [
      ...instructions.map((plan) => ({ path: plan.path, exists: plan.exists })),
      { path: settings.path, exists: settings.exists },
      { path: codexConfig.path, exists: codexConfig.exists },
    ];
    if (state) filesToBackup.push({ path: statePath });

    const provisionalState = newState(manifest, instructions, settings, codexConfig, 'pending', adapter);
    const postContents = new Map(instructions.map((plan) => [plan.path, plan.output]));
    postContents.set(settings.path, settings.output);
    postContents.set(codexConfig.path, codexConfig.output);
    if (state) postContents.set(statePath, `${JSON.stringify(provisionalState, null, 2)}\n`);
    const rollback = await createRollbackBundle(
      options.home,
      options.backupDir,
      filesToBackup,
      postContents,
      links,
      Boolean(state),
    );
    const finalState = newState(manifest, instructions, settings, codexConfig, rollback.bundle, adapter);
    if (state) {
      rollback.manifest.restore[relative(options.home, statePath)].postSha256 = hashContents(`${JSON.stringify(finalState, null, 2)}\n`);
      await writeFile(join(rollback.bundle, 'rollback-manifest.json'), `${JSON.stringify(rollback.manifest, null, 2)}\n`, { mode: 0o600 });
    }

    const written = [];
    const createdLinks = [];
    const replacedLinks = [];
    const assertUnchanged = async (plan) => {
      try {
        const info = await lstat(plan.path);
        if (info.isSymbolicLink() || plan.exists === false || await readFile(plan.path, 'utf8') !== plan.source) throw new Error(`concurrent target drift: ${plan.path}`);
      } catch (error) { if (error.code !== 'ENOENT' || plan.exists !== false) throw error; }
    };
    try {
      // Check all targets before the first write, then again immediately before each replacement.
      for (const plan of [...instructions, settings, codexConfig]) await assertUnchanged(plan);
      for (const plan of changedInstructions) {
        await assertUnchanged(plan);
        await writeAtomic(plan.path, plan.output, plan.exists ? (await stat(plan.path)).mode : 0o600);
        written.push(plan);
      }
      if (settings.changed) {
        await assertUnchanged(settings);
        await writeAtomic(settings.path, settings.output, settings.exists ? (await stat(settings.path)).mode : 0o600);
        written.push(settings);
      }
      if (codexConfig.changed) {
        await assertUnchanged(codexConfig);
        await writeAtomic(codexConfig.path, codexConfig.output, codexConfig.exists ? (await stat(codexConfig.path)).mode : 0o600);
        written.push(codexConfig);
      }
      for (const link of links) {
        if (link.replace) {
          if (!(await lstat(link.path)).isSymbolicLink() || await readlink(link.path) !== link.previous) throw new Error(`concurrent link drift: ${link.path}`);
          const temporary = `${link.path}.agent-workflows-${randomUUID()}`;
          await symlink(link.expected, temporary);
          await rename(temporary, link.path);
          replacedLinks.push(link);
          continue;
        }
        if (!link.create) continue;
        await mkdir(dirname(link.path), { recursive: true });
        await symlink(link.expected, link.path, link.path.endsWith('long-run') ? 'dir' : 'file');
        createdLinks.push(link);
      }
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      const stateMode = state ? (await stat(statePath)).mode : 0o600;
      await writeAtomic(statePath, `${JSON.stringify(finalState, null, 2)}\n`, stateMode);
    } catch (error) {
      for (const link of createdLinks.reverse()) {
        try { await unlink(link.path); } catch {}
      }
      for (const plan of written.reverse()) {
        if (await hashFile(plan.path) !== hashContents(plan.output)) throw new Error(`rollback refused concurrent drift: ${plan.path}; original failure: ${error.message}`);
        if (plan.exists === false) { await unlink(plan.path); continue; }
        const rel = relative(options.home, plan.path);
        const receipt = rollback.manifest.restore[rel];
        await writeAtomic(plan.path, await readFile(join(rollback.bundle, rel)), receipt.mode);
      }
      for (const link of replacedLinks.reverse()) {
        if (await readlink(link.path) !== link.expected) throw new Error(`rollback refused link drift: ${link.path}`);
        await unlink(link.path);
        await symlink(link.previous, link.path);
      }
      throw error;
    }

    stdout(`agent-workflows: install ok; changes=${changed}; rollback=${rollback.bundle}\n`);
    return 0;
  } catch (error) {
    stderr(`agent-workflows: ${error.message}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => resolve(process.argv[1])) : '';
if (invokedPath === await realpath(scriptPath)) {
  process.exitCode = await runInstaller(process.argv.slice(2));
}
