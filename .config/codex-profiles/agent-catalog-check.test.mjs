import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CLAUDE_SCOPED_PLUGINS,
  CODEX_MANAGED_REMOTE_PLUGINS,
  REQUIRED_GLOBAL_SKILLS,
  parseClaudeTokenCost,
  parseCodexPrompt,
  runChecker,
  formatReport,
  validateClaudeCatalog,
  validateCodexPlugins,
  localPluginFromEnv,
  validateCodexSkills,
  validateRollbackBundle,
} from '../../.local/bin/agent-catalog-check.mjs';

function prompt(entries) {
  const lines = entries.map((entry) => `- ${entry.name}: ${entry.description} (file: ${entry.file ?? `r0/${entry.name}/SKILL.md`})`);
  return JSON.stringify([{
    type: 'message',
    content: [{
      type: 'input_text',
      text: `<skills_instructions>\n## Skills\n${lines.join('\n')}\n</skills_instructions>`,
    }],
  }]);
}

function validEntries() {
  return REQUIRED_GLOBAL_SKILLS.map((name) => ({ name, description: `${name} description` }));
}

// A fixture plugin, so the suite never depends on a privately developed one
// being installed on the machine running it.
const LOCAL_PLUGIN = { pluginId: 'example@example', path: '/example/dev/example-plugin' };

function codexPlugins(overrides = {}) {
  const installed = CODEX_MANAGED_REMOTE_PLUGINS.map((pluginId) => ({ pluginId, enabled: false }));
  installed.push({
    pluginId: LOCAL_PLUGIN.pluginId,
    enabled: true,
    source: { path: LOCAL_PLUGIN.path },
    marketplaceSource: { source: LOCAL_PLUGIN.path },
  });
  if (overrides.enableManaged) installed.find((item) => item.pluginId === overrides.enableManaged).enabled = true;
  if (overrides.staleLocal) installed.at(-1).source.path = '/example/dev/other/plugin';
  return JSON.stringify({ installed });
}

function claudePlugins(enabledIds = [], scopedEnabled = []) {
  const ids = new Set([...enabledIds, ...CLAUDE_SCOPED_PLUGINS]);
  return JSON.stringify([...ids].map((id) => ({
    id,
    scope: 'user',
    enabled: enabledIds.includes(id) || scopedEnabled.includes(id),
    installPath: `/plugins/${id}`,
  })));
}

test('valid Codex prompt parses namespaced names and descriptions containing colons', () => {
  const parsed = parseCodexPrompt(prompt([
    ...validEntries(),
    { name: 'plugin:skill', description: 'Iron Law: investigate first.' },
  ]));
  assert.equal(parsed.entries.at(-1).name, 'plugin:skill');
  assert.equal(parsed.entries.at(-1).description, 'Iron Law: investigate first.');
  assert.deepEqual(validateCodexSkills('fixture', parsed), []);
  assert.ok(parsed.metadataCharacters > parsed.descriptionCharacters);
  assert.equal(parsed.capabilityFamilies.plugin, 1);
});

test('external prompt snapshot reports its own surface without running a native CLI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-snapshot-'));
  const path = join(dir, 'prompt.json');
  await writeFile(path, prompt(validEntries()));
  let output = '';
  const code = await runChecker(['--prompt-file', path, '--surface', 'desktop-fixture'], { stdout: (s) => { output += s; }, exec: () => { throw new Error('must not invoke CLI'); } });
  assert.equal(code, 0);
  const report = JSON.parse(output);
  assert.equal(report.surface, 'desktop-fixture');
  assert.equal(report.skills, validEntries().length);
});

test('Codex guard fails an over-budget catalog', () => {
  const entries = validEntries();
  while (entries.length <= 150) entries.push({ name: `extra-${entries.length}`, description: 'extra' });
  assert.match(validateCodexSkills('fixture', parseCodexPrompt(prompt(entries))).join('\n'), /exceeds 150/);
});

test('Codex guard fails empty descriptions', () => {
  const entries = validEntries();
  entries[0] = { ...entries[0], description: '' };
  assert.match(validateCodexSkills('fixture', parseCodexPrompt(prompt(entries))).join('\n'), /empty descriptions/);
});

test('Codex guard fails duplicate exact names', () => {
  const entries = validEntries();
  entries.push({ ...entries[0], file: 'r9/duplicate/SKILL.md' });
  assert.match(validateCodexSkills('fixture', parseCodexPrompt(prompt(entries))).join('\n'), /duplicate names/);
});

test('Codex guard fails missing required global or profile signatures', () => {
  const entries = validEntries().filter((entry) => entry.name !== 'long-run');
  const issues = validateCodexSkills('fixture', parseCodexPrompt(prompt(entries)), ['profile-only']);
  assert.match(issues.join('\n'), /long-run, profile-only/);
});

test('Codex plugin guard fails stale marketplace and an active managed bundle', () => {
  const result = validateCodexPlugins(codexPlugins({ staleLocal: true, enableManaged: 'vercel@openai-curated' }), LOCAL_PLUGIN);
  assert.match(result.issues.join('\n'), /local plugin source is stale/);
  assert.match(result.issues.join('\n'), /remote bundle still enabled/);
});

test('remote account identities are reported separately from enforced local toggles', () => {
  const data=JSON.parse(codexPlugins());
  data.installed=data.installed.filter((p)=>!CODEX_MANAGED_REMOTE_PLUGINS.includes(p.pluginId));
  data.installed.push({pluginId:'vercel@openai-curated-remote',enabled:true,source:{source:'remote'}});
  const r=validateCodexPlugins(JSON.stringify(data), LOCAL_PLUGIN);
  assert.deepEqual(r.issues,[]);
  assert.equal(r.absentLegacyEntries.length,CODEX_MANAGED_REMOTE_PLUGINS.length);
  assert.deepEqual(r.accountPlugins,[{id:'vercel@openai-curated-remote',enabled:true}]);
});

test('default report exposes remote-account scope and absent optional records', () => {
  const text=formatReport({ok:true,issues:[],codex:{profiles:{global:31},limit:150,installedPlugins:79,absentLegacyEntries:['old'],accountPlugins:[{id:'new',enabled:true}],accountScope:'observed-not-controlled-by-local-policy'},claude:{alwaysOnTokens:80,limit:1500,enabledUserPlugins:7}});
  assert.match(text,/optional legacy entries absent: 1/);
  assert.match(text,/remote account plugins: 1; observed-not-controlled-by-local-policy/);
  assert.match(text,/does not establish desktop scoping/);
});

test('Claude token parser requires exactly one projected cost', () => {
  assert.equal(parseClaudeTokenCost('Always-on: ~1,234 tok'), 1234);
  assert.throws(() => parseClaudeTokenCost('no cost'), /count is 0/);
});

test('Claude guard fails over-budget and unparsed details', () => {
  const list = claudePlugins(['core-a', 'core-b']);
  const details = new Map([
    ['core-a', 'Always-on: ~1,500 tok'],
    ['core-b', 'missing'],
  ]);
  const result = validateClaudeCatalog(list, details);
  assert.match(result.issues.join('\n'), /Always-on token line count is 0/);
  assert.match(result.issues.join('\n'), /not below 1500/);
});

test('Claude guard fails heavyweight user activation but accepts installed disabled packages', () => {
  assert.ok(CLAUDE_SCOPED_PLUGINS.includes('posthog@claude-plugins-official'));
  const active = validateClaudeCatalog(
    claudePlugins([], ['posthog@claude-plugins-official']),
    new Map([['posthog@claude-plugins-official', 'Always-on: ~25,534 tok']]),
  );
  assert.match(active.issues.join('\n'), /heavyweight user plugin still enabled/);
  const inactive = validateClaudeCatalog(claudePlugins(), new Map());
  assert.deepEqual(inactive.issues, []);
});

test('rollback guard verifies hashes, JSON, owner-only mode, and tree inventories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-rollback-test-'));
  const agents = join(root, 'agents-skills');
  const codex = join(root, 'codex-skills');
  await mkdir(join(agents, 'one'), { recursive: true });
  await mkdir(codex, { recursive: true });
  await writeFile(join(agents, 'one', 'SKILL.md'), 'fixture');
  await symlink(join(agents, 'one', 'SKILL.md'), join(agents, 'linked-skill'));
  const config = 'fixture-config\n';
  await writeFile(join(root, 'config.toml'), config);
  const hash = createHash('sha256').update(config).digest('hex');
  await writeFile(join(root, 'rollback-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    files: { 'config.toml': hash },
    inventories: {
      'agents-skills': { regularSkillFiles: 1, symlinks: 1 },
      'codex-skills': { regularSkillFiles: 0, symlinks: 0 },
    },
    requiredDirectories: ['agents-skills', 'codex-skills'],
  }));
  assert.deepEqual((await validateRollbackBundle(root)).issues, []);
  await writeFile(join(root, 'config.toml'), 'drifted\n');
  assert.match((await validateRollbackBundle(root)).issues.join('\n'), /hash mismatch/);
});

test('a machine with no locally developed plugin skips that check instead of failing', () => {
  assert.equal(localPluginFromEnv({}), null);
  const data = JSON.parse(codexPlugins());
  data.installed = data.installed.filter((plugin) => plugin.pluginId !== LOCAL_PLUGIN.pluginId);
  const result = validateCodexPlugins(JSON.stringify(data), null);
  assert.deepEqual(result.issues, []);
});

test('a configured local plugin is still enforced', () => {
  assert.deepEqual(localPluginFromEnv({ AGENT_CATALOG_LOCAL_PLUGIN: 'a@b=/p' }), { pluginId: 'a@b', path: '/p' });
  const data = JSON.parse(codexPlugins());
  data.installed = data.installed.filter((plugin) => plugin.pluginId !== LOCAL_PLUGIN.pluginId);
  const result = validateCodexPlugins(JSON.stringify(data), LOCAL_PLUGIN);
  assert.ok(result.issues.some((issue) => issue.includes('local plugin is missing')));
});
