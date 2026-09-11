import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import test from 'node:test';
const root = resolve(import.meta.dirname, '..');

test('kernel preserves authority and verification without universal ceremony', async () => {
  const text = await readFile(join(root, 'policy/instructions.md.tmpl'), 'utf8');
  for (const required of ['routine reversible', 'User instructions outrank', 'one active execution ledger', 'Self-review is not independent review', 'Never silently lower', 'independent adversarial', 'project-owned', 'batch independent']) assert.ok(text.toLowerCase().includes(required.toLowerCase()), required);
  for (const retired of ['At the second compaction, stop', '1.25 calls per spawn', 'Read the applicable skill completely before exploration', 'three or more steps']) assert.ok(!text.includes(retired), retired);
  assert.ok(Buffer.byteLength(text) < 6500);
});

test('global policy scopes methodology and removes unsafe shell auto-allows', async () => {
  // The committed example is the published contract; the personal file is gitignored.
  const policy = JSON.parse(await readFile(join(root, 'policy/claude-settings.example.json'), 'utf8'));
  assert.equal(policy.set['enabledPlugins.superpowers@claude-plugins-official'], false);
  assert.deepEqual(policy.removeAllow, ['Bash(cat:*)', 'Bash(env)', 'Bash(printenv:*)']);
  assert.ok(policy.preserve.includes('model'));
  assert.ok(policy.preserve.includes('effortLevel'));
  assert.equal(policy.delete.includes('autoMode.environment'), false);
  assert.deepEqual(policy.set['autoMode.environment'], ['$defaults']);
  assert.deepEqual(policy.set['autoMode.allow'], ['$defaults']);
});

test('runtime adapters preserve the main model and make metadata authoritative', async () => {
  const tiers = await readFile(join(root, 'runtime/claude/tiers.js'), 'utf8');
  assert.doesNotMatch(tiers, /model: 'opus'/);
  const planner = await readFile(join(root, 'runtime/claude/planner.md'), 'utf8');
  assert.match(planner, /model: inherit/);
  assert.doesNotMatch(planner, /20 LOC|each ending in a human checkpoint|ultracode/);
  const statusline = await readFile(join(root, 'runtime/claude/statusline-command.sh'), 'utf8');
  assert.match(statusline, /fable-5-1/);
});
