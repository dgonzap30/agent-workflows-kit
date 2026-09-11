#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const CODEX_SKILL_LIMIT = 150;
export const CLAUDE_TOKEN_LIMIT = 1500;

export const REQUIRED_GLOBAL_SKILLS = Object.freeze([
  'clarify',
  'codex-session-curator',
  'long-run',
  'openai-docs',
  'planning',
  'playwright',
  'quick-review',
  'search-first',
  'unlazy',
  'verification-loop',
]);

export const PROFILE_SIGNATURES = Object.freeze({
  methodology: ['superpowers:brainstorming', 'superpowers:verification-before-completion'],
  web: ['render:render-deploy', 'stripe:stripe-best-practices'],
  'business-gtm': ['apollo:prospect', 'brand-voice:discover-brand'],
  'business-ops': ['operations:runbook', 'product-management:write-spec'],
});

export const CLAUDE_SCOPED_PLUGINS = Object.freeze([
  'superpowers@claude-plugins-official',
  'firecrawl@claude-plugins-official',
  'posthog@claude-plugins-official',
  'revenuecat@claude-plugins-official',
  'vercel@claude-plugins-official',
]);

export const CODEX_MANAGED_REMOTE_PLUGINS = Object.freeze([
  'build-ios-apps@openai-curated',
  'build-macos-apps@openai-curated',
  'canva@openai-curated',
  'codex-security@openai-curated',
  'hugging-face@openai-curated',
  'vercel@openai-curated',
  'waldo@openai-curated',
]);

// An optional locally-developed plugin to verify. Unset on a machine that has
// none, in which case the check is skipped rather than failed. Format:
// AGENT_CATALOG_LOCAL_PLUGIN="<pluginId>=<absolute source path>"
export function localPluginFromEnv(env = process.env) {
  const raw = env.AGENT_CATALOG_LOCAL_PLUGIN;
  if (!raw) return null;
  const index = raw.indexOf('=');
  if (index < 1) return null;
  return { pluginId: raw.slice(0, index), path: raw.slice(index + 1) };
}

function collectInputTexts(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectInputTexts(item, output);
  } else if (value && typeof value === 'object') {
    if (value.type === 'input_text' && typeof value.text === 'string') output.push(value.text);
    for (const child of Object.values(value)) collectInputTexts(child, output);
  }
  return output;
}

export function parseCodexPrompt(stdout) {
  let prompt;
  try {
    prompt = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Codex prompt output is not JSON: ${error.message}`);
  }
  const skillTexts = collectInputTexts(prompt).filter((text) => text.includes('<skills_instructions>'));
  if (skillTexts.length !== 1) throw new Error(`Codex skills block count is ${skillTexts.length}`);
  const text = skillTexts[0];
  const start = text.indexOf('<skills_instructions>');
  const end = text.indexOf('</skills_instructions>');
  if (end <= start) throw new Error('Codex skills block is not terminated');
  const entries = [];
  const malformed = [];
  for (const line of text.slice(start, end).split('\n')) {
    if (!line.startsWith('- ') || !line.includes(' (file: ')) continue;
    const fileMarker = line.lastIndexOf(' (file: ');
    const body = line.slice(2, fileMarker);
    const delimiter = body.indexOf(': ');
    if (delimiter <= 0 || !line.endsWith(')')) {
      malformed.push(line);
      continue;
    }
    entries.push({
      name: body.slice(0, delimiter),
      description: body.slice(delimiter + 2),
      file: line.slice(fileMarker + ' (file: '.length, -1),
    });
  }
  return {
    entries, malformed,
    metadataCharacters: text.slice(start, end).length,
    descriptionCharacters: entries.reduce((sum, entry) => sum + entry.description.length, 0),
    capabilityFamilies: Object.fromEntries([...new Set(entries.map((entry) => entry.name.split(':')[0]))].map((name) => [name, entries.filter((entry) => entry.name.split(':')[0] === name).length])),
  };
}

export function validateCodexSkills(label, parsed, signatures = []) {
  const issues = [];
  if (parsed.malformed.length > 0) issues.push(`${label}: ${parsed.malformed.length} malformed skill entries`);
  if (parsed.entries.length > CODEX_SKILL_LIMIT) {
    issues.push(`${label}: ${parsed.entries.length} skills exceeds ${CODEX_SKILL_LIMIT}`);
  }
  const empty = parsed.entries.filter((entry) => entry.description.trim() === '').map((entry) => entry.name);
  if (empty.length > 0) issues.push(`${label}: empty descriptions: ${empty.join(', ')}`);
  const counts = new Map();
  for (const entry of parsed.entries) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicates.length > 0) issues.push(`${label}: duplicate names: ${duplicates.join(', ')}`);
  const required = [...REQUIRED_GLOBAL_SKILLS, ...signatures];
  const missing = required.filter((name) => !counts.has(name));
  if (missing.length > 0) issues.push(`${label}: missing required skills: ${missing.join(', ')}`);
  return issues;
}

export function validateCodexPlugins(stdout, localPlugin = localPluginFromEnv()) {
  let catalog;
  try {
    catalog = JSON.parse(stdout);
  } catch (error) {
    return { issues: [`Codex plugin listing is not JSON: ${error.message}`], installed: 0 };
  }
  if (!Array.isArray(catalog.installed)) return { issues: ['Codex plugin listing has no installed array'], installed: 0 };
  const issues = [];
  if (localPlugin) {
    const local = catalog.installed.find((plugin) => plugin.pluginId === localPlugin.pluginId);
    if (!local) issues.push(`Codex local plugin is missing: ${localPlugin.pluginId}`);
    else if (local.source?.path !== localPlugin.path || local.marketplaceSource?.source !== localPlugin.path) {
      issues.push(`Codex local plugin source is stale: ${local.source?.path ?? 'missing'}`);
    }
  }
  const managed = catalog.installed.filter((plugin) => CODEX_MANAGED_REMOTE_PLUGINS.includes(plugin.pluginId));
  const missingManaged = CODEX_MANAGED_REMOTE_PLUGINS.filter((id) => !managed.some((plugin) => plugin.pluginId === id));
  // New hosts replace legacy local marketplace records with remote account records.
  // Absent optional packages are not a reason to install them; preserve local toggle
  // enforcement while reporting account scope separately instead of declaring parity.
  const accountPlugins = catalog.installed.filter((plugin) => plugin.source?.source === 'remote');
  const enabledManaged = managed.filter((plugin) => plugin.enabled).map((plugin) => plugin.pluginId);
  if (enabledManaged.length > 0) issues.push(`Codex global remote bundle still enabled: ${enabledManaged.join(', ')}`);
  return {
    issues, installed: catalog.installed.length,
    absentLegacyEntries: missingManaged,
    accountPlugins: accountPlugins.map((plugin) => ({ id: plugin.pluginId, enabled: plugin.enabled === true })),
  };
}

export function parseClaudeTokenCost(stdout) {
  const matches = [...stdout.matchAll(/Always-on:\s+~([\d,]+)\s+tok/g)];
  if (matches.length !== 1) throw new Error(`Claude Always-on token line count is ${matches.length}`);
  return Number(matches[0][1].replaceAll(',', ''));
}

export function validateClaudeCatalog(listStdout, detailOutputs) {
  let plugins;
  try {
    plugins = JSON.parse(listStdout);
  } catch (error) {
    return { issues: [`Claude plugin listing is not JSON: ${error.message}`], enabled: 0, tokens: 0 };
  }
  if (!Array.isArray(plugins)) return { issues: ['Claude plugin listing is not an array'], enabled: 0, tokens: 0 };
  const issues = [];
  const enabled = plugins.filter((plugin) => plugin.scope === 'user' && plugin.enabled);
  let tokens = 0;
  for (const plugin of enabled) {
    const details = detailOutputs.get(plugin.id);
    if (typeof details !== 'string') {
      issues.push(`Claude details missing for ${plugin.id}`);
      continue;
    }
    try {
      tokens += parseClaudeTokenCost(details);
    } catch (error) {
      issues.push(`Claude ${plugin.id}: ${error.message}`);
    }
  }
  if (tokens >= CLAUDE_TOKEN_LIMIT) issues.push(`Claude always-on cost ${tokens} is not below ${CLAUDE_TOKEN_LIMIT}`);
  for (const id of CLAUDE_SCOPED_PLUGINS) {
    const plugin = plugins.find((item) => item.id === id && item.scope === 'user');
    if (!plugin) issues.push(`Claude scoped plugin is not installed: ${id}`);
    else if (plugin.enabled) issues.push(`Claude heavyweight user plugin still enabled: ${id}`);
    else if (!plugin.installPath) issues.push(`Claude scoped plugin has no install path: ${id}`);
  }
  return { issues, enabled: enabled.length, tokens };
}

async function hashFile(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function inventoryTree(root) {
  const inventory = { regularSkillFiles: 0, symlinks: 0 };
  async function walk(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) inventory.symlinks += 1;
      else if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && entry.name === 'SKILL.md') inventory.regularSkillFiles += 1;
    }
  }
  await walk(root);
  return inventory;
}

export async function validateRollbackBundle(bundlePath) {
  const root = resolve(bundlePath);
  const issues = [];
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error(`rollback path is not a directory: ${root}`);
  if ((info.mode & 0o077) !== 0) issues.push(`rollback directory is not owner-only: mode ${(info.mode & 0o777).toString(8)}`);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, 'rollback-manifest.json'), 'utf8'));
  } catch (error) {
    throw new Error(`rollback manifest is unreadable: ${error.message}`);
  }
  if (manifest.schemaVersion !== 1 || !manifest.files || !manifest.inventories) {
    throw new Error('rollback manifest has an unsupported shape');
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const path = resolve(root, relative);
    if (!path.startsWith(`${root}${sep}`)) {
      issues.push(`rollback manifest path escapes bundle: ${relative}`);
      continue;
    }
    try {
      const actual = await hashFile(path);
      if (actual !== expected) issues.push(`rollback hash mismatch: ${relative}`);
      if (relative.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      issues.push(`rollback file invalid: ${relative}: ${error.message}`);
    }
  }
  for (const relative of manifest.requiredDirectories ?? []) {
    try {
      if (!(await lstat(resolve(root, relative))).isDirectory()) issues.push(`rollback required path is not a directory: ${relative}`);
    } catch (error) {
      issues.push(`rollback required directory missing: ${relative}: ${error.message}`);
    }
  }
  const inventories = {};
  for (const [relative, expected] of Object.entries(manifest.inventories)) {
    try {
      const actual = await inventoryTree(resolve(root, relative));
      inventories[relative] = actual;
      for (const [key, value] of Object.entries(expected)) {
        if (actual[key] !== value) issues.push(`rollback inventory mismatch: ${relative}.${key}=${actual[key]} expected ${value}`);
      }
    } catch (error) {
      issues.push(`rollback inventory unreadable: ${relative}: ${error.message}`);
    }
  }
  return { ok: issues.length === 0, issues, files: Object.keys(manifest.files).length, inventories, path: root };
}

async function run(program, args, cwd) {
  return execFileAsync(program, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 45_000,
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

export async function checkLiveCatalogs(options = {}) {
  const cwd = options.cwd ?? tmpdir();
  const exec = options.exec ?? run;
  const issues = [];
  const profileNames = Object.keys(PROFILE_SIGNATURES);
  const codexTargets = ['global', ...profileNames];
  const promptResults = await mapWithConcurrency(codexTargets, 4, async (target) => {
    const args = target === 'global'
      ? ['debug', 'prompt-input']
      : ['--profile', target, 'debug', 'prompt-input'];
    const result = await exec('codex', args, cwd);
    return { target, parsed: parseCodexPrompt(result.stdout) };
  });
  const codexProfiles = {};
  const profileMetadata = {};
  for (const result of promptResults) {
    const signatures = result.target === 'global' ? [] : PROFILE_SIGNATURES[result.target];
    issues.push(...validateCodexSkills(`Codex ${result.target}`, result.parsed, signatures));
    codexProfiles[result.target] = result.parsed.entries.length;
    profileMetadata[result.target] = { metadataCharacters: result.parsed.metadataCharacters, descriptionCharacters: result.parsed.descriptionCharacters, capabilityFamilies: result.parsed.capabilityFamilies };
  }

  const codexPluginResult = await exec('codex', ['plugin', 'list', '--json'], cwd);
  const codexPlugins = validateCodexPlugins(codexPluginResult.stdout);
  issues.push(...codexPlugins.issues);

  const claudeListResult = await exec('claude', ['plugin', 'list', '--json'], homedir());
  let claudeList;
  try {
    claudeList = JSON.parse(claudeListResult.stdout);
  } catch {
    claudeList = [];
  }
  const enabledClaude = Array.isArray(claudeList)
    ? claudeList.filter((plugin) => plugin.scope === 'user' && plugin.enabled)
    : [];
  const detailResults = await mapWithConcurrency(enabledClaude, 4, async (plugin) => {
    const result = await exec('claude', ['plugin', 'details', plugin.id], homedir());
    return [plugin.id, result.stdout];
  });
  const claude = validateClaudeCatalog(claudeListResult.stdout, new Map(detailResults));
  issues.push(...claude.issues);

  let rollback = null;
  if (options.rollbackDir) {
    rollback = await validateRollbackBundle(options.rollbackDir);
    issues.push(...rollback.issues);
  }

  return {
    ok: issues.length === 0,
    issues,
    codex: {
      limit: CODEX_SKILL_LIMIT,
      profiles: codexProfiles,
      surface: 'local-cli',
      profileMetadata,
      note: 'This native local CLI inventory does not establish desktop/account connector state. Use --prompt-file on a separately captured desktop prompt.',
      installedPlugins: codexPlugins.installed,
      absentLegacyEntries: codexPlugins.absentLegacyEntries,
      accountPlugins: codexPlugins.accountPlugins,
      accountScope: codexPlugins.accountPlugins.length ? 'observed-not-controlled-by-local-policy' : 'not-observed',
    },
    claude: {
      enabledUserPlugins: claude.enabled,
      limit: CLAUDE_TOKEN_LIMIT,
      alwaysOnTokens: claude.tokens,
    },
    rollback,
  };
}

export function formatReport(report) {
  const profileSummary = Object.entries(report.codex.profiles)
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');
  const lines = [
    `agent-catalog-check: ${report.ok ? 'PASS' : 'FAIL'}`,
    `Codex skills (${report.codex.limit} max): ${profileSummary}`,
    `Codex installed plugins: ${report.codex.installedPlugins}`,
    `Codex optional legacy entries absent: ${report.codex.absentLegacyEntries?.length ?? 0}`,
    `Codex remote account plugins: ${report.codex.accountPlugins?.length ?? 0}; ${report.codex.accountScope ?? 'not-observed'} (local policy does not establish desktop scoping)`,
    `Claude always-on: ${report.claude.alwaysOnTokens} tokens (<${report.claude.limit}) across ${report.claude.enabledUserPlugins} user plugins`,
  ];
  if (report.rollback) lines.push(`Rollback bundle: ${report.rollback.files} hashed files, ${Object.keys(report.rollback.inventories).length} tree inventories`);
  for (const issue of report.issues) lines.push(`ERROR: ${issue}`);
  return `${lines.join('\n')}\n`;
}

export async function runChecker(argv, io = {}) {
  const stdout = io.stdout ?? ((value) => process.stdout.write(value));
  const stderr = io.stderr ?? ((value) => process.stderr.write(value));
  let json = false;
  let rollbackDir;
  let help = false;
  let promptFile;
  let surface = 'snapshot';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--prompt-file' || arg === '--surface') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) { stderr(`${arg} requires a value\n`); return 2; }
      if (arg === '--prompt-file') promptFile = resolve(value); else surface = value;
    }
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--rollback-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        stderr('agent-catalog-check: --rollback-dir requires a path\n');
        return 2;
      }
      rollbackDir = resolve(value);
      index += 1;
    } else {
      stderr(`agent-catalog-check: unknown option: ${arg}\n`);
      return 2;
    }
  }
  if (help) {
    stdout('usage: agent-catalog-check [--json] [--rollback-dir PATH] [--prompt-file PATH --surface NAME]\n');
    return 0;
  }
  try {
    if (promptFile) {
      const parsed = parseCodexPrompt(await readFile(promptFile, 'utf8'));
      const issues = validateCodexSkills(surface, parsed);
      const report = { ok: issues.length === 0, surface, skills: parsed.entries.length, metadataCharacters: parsed.metadataCharacters, descriptionCharacters: parsed.descriptionCharacters, capabilityFamilies: parsed.capabilityFamilies, issues, note: 'Skill discovery metadata only; selected bodies, tool schemas and account permissions are separate.' };
      stdout(JSON.stringify(report, null, 2) + '\n');
      return report.ok ? 0 : 1;
    }
    const report = await checkLiveCatalogs({ ...io, rollbackDir });
    stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    stderr(`agent-catalog-check: ${error.message}\n`);
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

if (await isMainModule()) process.exitCode = await runChecker(process.argv.slice(2));
