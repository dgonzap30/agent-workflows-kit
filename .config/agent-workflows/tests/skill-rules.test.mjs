import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const claude = join(root, 'runtime', 'claude');

async function text(relative) {
  return readFile(join(claude, relative), 'utf8');
}

function frontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'frontmatter is required');
  return match[1];
}

test('review skills have valid frontmatter and retain their activation boundaries', async () => {
  const [verification, review, ci] = await Promise.all([
    text('verification-loop.md'), text('quick-review.md'), text('gh-fix-ci.md'),
  ]);
  for (const [source, name] of [[verification, 'verification-loop'], [review, 'quick-review'], [ci, 'gh-fix-ci']]) {
    const meta = frontmatter(source);
    assert.match(meta, new RegExp(`name: ${name}`));
    assert.match(meta, /description: .+/);
  }
  assert.match(verification, /before creating a PR or marking work as ready/i);
  assert.match(review, /uncommitted changes/i);
  assert.match(ci, /GitHub Actions/i);
});

test('verification commands preserve command exits and choose project-owned checks', async () => {
  const source = await text('verification-loop.md');
  assert.match(source, /project-owned.*command/i);
  assert.match(source, /capture.*exit/i);
  assert.doesNotMatch(source, /\|\s*tail\b/);
  assert.match(source, /Do not.*passWithNoTests/i);
  assert.doesNotMatch(source, /\|\|\s*(npm|pnpm|yarn)/);
  assert.doesNotMatch(source, /grep.*(?:TODO|console\.log).*security audit/i);
});

test('every documented shell pattern preserves actual success and failure exits', async () => {
  const source=await text('references/verification-examples.md');
  const blocks=[...source.matchAll(/```sh\n([\s\S]*?)```/g)].map((m)=>m[1]);
  assert.equal(blocks.length,2);
  for (const block of blocks) for (const exit of [0,7]) {
    const script=block.replace('pnpm test:unit',`bash -c 'echo fixture-output; exit ${exit}'`);
    const r=spawnSync('bash',['-e','-c',script],{encoding:'utf8'});
    assert.equal(r.status,exit, r.stderr);
    assert.match(r.stdout,/fixture-output/);
  }
});

test('quick review requires evidence and avoids universal performance folklore', async () => {
  const source = await text('quick-review.md');
  assert.match(source, /evidence.*scope/i);
  assert.match(source, /not enough evidence/i);
  assert.doesNotMatch(source, /missing memo on list items/i);
  assert.doesNotMatch(source, /conditional Modal mounting/i);
  assert.doesNotMatch(source, /bare `supabase\.functions\.invoke\(\)`/i);
});

test('CI repair uses existing authorization and keeps real authority boundaries', async () => {
  const source = await text('gh-fix-ci.md');
  assert.match(source, /requested fix.*authorization|authorization.*requested fix/i);
  assert.doesNotMatch(source, /implement only after explicit approval/i);
  for (const boundary of ['credential', 'external provider', 'merge']) assert.match(source, new RegExp(boundary, 'i'));
});

test('rules route narrowly and keep tradeoffs out of universal requirements', async () => {
  const [general, ts, react, native, sql] = await Promise.all([
    text('rules/code-quality.md'), text('rules/typescript.md'), text('rules/react.md'), text('rules/react-native.md'), text('rules/sql-supabase.md'),
  ]);
  assert.match(frontmatter(general), /paths:\n\s*- "\*\*\/\*"/);
  assert.match(frontmatter(ts), /\*\*\/\*\.ts/);
  assert.match(frontmatter(react), /\*\*\/\*\.tsx/);
  assert.match(frontmatter(native), /native\.tsx/);
  assert.doesNotMatch(frontmatter(native), /"\*\*\/\*\.tsx"/);
  const sqlMeta = frontmatter(sql);
  assert.match(sqlMeta, /\*\*\/\*\.sql/);
  assert.match(sqlMeta, /supabase\/\*\*/);
  assert.doesNotMatch(sqlMeta, /\*\*\/\*\.tsx/);
  assert.match(react, /tradeoff|measure|profile/i);
  assert.match(native, /tradeoff|measure|profile/i);
  for (const source of [general, ts, react, native, sql]) assert.doesNotMatch(source, /95[–-]99\.99%|~450x|100x/);
});
