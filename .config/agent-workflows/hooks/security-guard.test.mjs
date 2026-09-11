import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
const script = resolve(import.meta.dirname, 'security-guard.py');
function run(command, tool = 'Bash') {
  return spawnSync('python3', [script], { input: JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: '/tmp/fixture' }), encoding: 'utf8' });
}
test('recognized destructive commands are blocked without executing input', () => {
  for (const command of ['git reset --hard', '/usr/bin/git -C /tmp reset --hard HEAD', 'env TEST=1 command git reset --hard', 'git push --force-with-lease origin main', 'git push origin HEAD:main --force', 'git push -f origin refs/heads/master', 'git clean -fdx', 'rm --recursive --force /', 'rm -fr ~', 'sh -c "git reset --hard"', 'pwd && git reset --hard', 'pwd\ngit reset --hard', 'npx supabase db reset', 'pnpm exec supabase db reset']) {
    const r = run(command); assert.equal(r.status, 2, `${command}: ${r.stderr}`);
    assert.match(r.stderr, /^Blocked destructive operation:/);
    assert.doesNotMatch(r.stderr, /TEST=1/);
  }
});
test('safe lookalikes and unrelated tools are not blocked', () => {
  for (const command of ['git status', 'git diff --stat', 'git reset --soft HEAD~1', 'git push origin feature', 'git push --force-with-lease origin feature', 'rm /tmp/fixture', 'echo "git reset --hard"', 'git log --grep="git reset --hard"']) assert.equal(run(command).status, 0, command);
  assert.equal(run('git reset --hard', 'Read').status, 0);
});
test('Codex command payload and malformed payload are bounded', () => {
  const r=spawnSync('python3',[script],{input:JSON.stringify({tool_name:'exec_command',tool_input:{cmd:'git reset --hard'}}),encoding:'utf8'});
  assert.equal(r.status,2);
  const bad=spawnSync('python3',[script],{input:'{broken',encoding:'utf8'});
  assert.equal(bad.status,0); assert.equal(bad.stdout,'');
});
