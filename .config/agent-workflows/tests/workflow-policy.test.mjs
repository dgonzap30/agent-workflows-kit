import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const policyRoot = join(repoRoot, '.config', 'agent-workflows', 'policy');

function render(template, runtime) {
  const output = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => runtime.replacements[key] ?? match);
  assert.doesNotMatch(output, /\{\{[A-Z0-9_]+\}\}/);
  return output;
}

test('one compact source renders coherent current Claude and Codex kernels', async () => {
  const [template, runtimes] = await Promise.all([
    readFile(join(policyRoot, 'instructions.md.tmpl'), 'utf8'),
    readFile(join(policyRoot, 'runtimes.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(runtimes.version, 1);
  assert.deepEqual(runtimes.runtimes.map((runtime) => runtime.name), ['Codex', 'Claude Code']);
  for (const runtime of runtimes.runtimes) {
    const output = render(template, runtime);
    assert.ok(Buffer.byteLength(output) < 10_000, `${runtime.name} kernel is ${Buffer.byteLength(output)} bytes`);
    for (const required of [
      'one active execution ledger',
      'compaction count alone does not force retirement',
      'routine reversible',
      'Self-review is not independent review',
      'project-owned migration, release, deploy, and code-generation pipelines',
      'Never silently lower the orchestrator',
    ]) assert.match(output, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    for (const stale of [
      /Expo SDK \d+/,
      /Next\.js \d+/,
      /2026-\d\d-\d\d/,
      /<\s*20 (lines|LOC)/i,
      /mcp__plugin_/,
      /plugin enabled 20\d\d/,
    ]) assert.doesNotMatch(output, stale);
  }
});

test('lifecycle policy has a hard adoption point, native Goal boundary, polling budget, and retirement threshold', async () => {
  const skill = await readFile(join(repoRoot, '.config', 'agent-workflows', 'skills', 'long-run', 'SKILL.md'), 'utf8');
  assert.match(skill, /Two substantive signals are the adoption point/);
  assert.match(skill, /user explicitly requested a goal or an explicit long\/autonomous outcome/);
  assert.match(skill, /at or below 1\.25 calls per spawn/);
  assert.match(skill, /compaction count alone is not a stop condition/);
});

test('Claude settings policy removes ambient regressions while preserving deliberate effort and auto mode', async () => {
  // The committed example is the published contract; the personal file is gitignored.
  const policy = JSON.parse(await readFile(join(policyRoot, 'claude-settings.example.json'), 'utf8'));
  assert.equal(policy.set['enabledPlugins.posthog@claude-plugins-official'], false);
  assert.equal(policy.set.remoteControlAtStartup, true);
  assert.equal(policy.set.skipDangerousModePermissionPrompt, false);
  assert.equal(policy.delete.includes('autoMode.environment'), false); // harness regenerates it; deleting it only produced --check drift
  assert.equal(policy.set['env.CLAUDE_CODE_SUBAGENT_MODEL'], 'sonnet');
  assert.ok(policy.delete.includes('env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'));
  for (const retired of ['subagent-model-guard.sh', 'workflow-tiering-guard.sh', 'skill-guard.sh', 'gate-compliance.sh', 'env-protection.sh']) assert.equal(policy.syncRequiredCommands.includes(retired), false, `${retired} was retired 2026-09-01`);
  assert.ok(policy.preserve.includes('permissions.defaultMode'));
  assert.ok(policy.preserve.includes('skipAutoPermissionPrompt'));
  assert.deepEqual(policy.replaceCommands, [{
    from: 'bash ~/.claude/scripts/hooks/prompt-gate.sh',
    to: 'bash ~/.config/agent-workflows/hooks/prompt-gate.sh --runtime claude',
  }]);
  assert.ok(policy.forbidCommands.some((rule) => rule.contains === 'OpenIslandHooks' && rule.events.includes('PreToolUse')));
  for (const token of policy.syncRequiredCommands) {
    assert.equal(policy.asyncCommands.some((rule) => rule.contains.includes(token)), false, `${token} cannot be async telemetry`);
  }
});

test('Codex config policy retires trust paths by shape, not by anyone\'s workspace names', async () => {
  // The committed example is the contract. A personal codex-config.json is
  // gitignored, so it may or may not exist on the machine running this.
  const policy = JSON.parse(await readFile(join(policyRoot, 'codex-config.example.json'), 'utf8'));
  assert.equal(policy.version, 1);
  const paths = policy.removeProjectTrustPaths;
  assert.ok(paths.length > 0, 'the example must exercise the retirement mechanism');
  assert.deepEqual(paths, [...new Set(paths)].sort(), 'paths are unique and sorted');
  for (const p of paths) assert.match(p, /^\//, `${p} must be absolute`);
  for (const p of paths) {
    assert.doesNotMatch(p, /\/Users\//, `${p} leaks a real home directory into the published kit`);
  }
});

test('the published policy carries no personal machine state', async () => {
  for (const name of ['codex-config.example.json', 'claude-settings.example.json']) {
    const text = await readFile(join(policyRoot, name), 'utf8');
    assert.doesNotMatch(text, /\/Users\/[a-z]/i, `${name} contains an absolute home path`);
  }
});
