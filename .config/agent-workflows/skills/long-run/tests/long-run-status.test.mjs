import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import {
  parseProgram,
  renderStatus,
  runCli,
  validateProgram,
} from '../scripts/long-run-status.mjs';

const fixtures = resolve(import.meta.dirname, 'fixtures');

async function loadFixture(name) {
  const root = await mkdtemp(join(tmpdir(), `long-run-${name}-`));
  await cp(join(fixtures, name), root, { recursive: true });
  return { root, planPath: join(root, 'tasks', 'todo.md') };
}

async function evaluate(name, mutate = (source) => source) {
  const fixture = await loadFixture(name);
  const original = await readFile(fixture.planPath, 'utf8');
  const source = mutate(original);
  await writeFile(fixture.planPath, source);
  const parsed = parseProgram(source, fixture.planPath);
  const result = await validateProgram(parsed);
  return { ...fixture, source, parsed, result };
}

function assertCode(result, code) {
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some((diagnostic) => diagnostic.code === code),
    `expected diagnostic ${code}; received ${result.diagnostics.map((item) => item.code).join(', ')}`,
  );
}

test('renders valid active progress from earned weights', async () => {
  const { result } = await evaluate('active');
  assert.equal(result.valid, true);
  assert.equal(result.earnedPoints, 2);
  assert.equal(result.totalPoints, 6);
  assert.equal(result.percent, 33);
  assert.equal(
    renderStatus(result),
    'Fixture active program [███░░░░░░░] 33% · active · M2/3 — Runtime adapters accepted',
  );
});

test('accepts a blocked program without earning blocked work', async () => {
  const { result } = await evaluate('blocked');
  assert.equal(result.valid, true);
  assert.equal(result.percent, 33);
  assert.equal(
    renderStatus(result),
    'Fixture blocked program [███░░░░░░░] 33% · blocked · M2/3 — Authority boundary resolved',
  );
});

test('accepts a complete program with a checked local gate', async () => {
  const { result } = await evaluate('complete');
  assert.equal(result.valid, true);
  assert.equal(result.earnedPoints, 6);
  assert.equal(result.totalPoints, 6);
  assert.equal(result.percent, 100);
  assert.equal(renderStatus(result), 'Fixture complete program [██████████] 100% · complete');
});

test('rejects zero, negative, fractional, and missing weights', async (context) => {
  const cases = [
    ['zero', (source) => source.replace('(2 pts)', '(0 pts)')],
    ['negative', (source) => source.replace('(2 pts)', '(-1 pts)')],
    ['fractional', (source) => source.replace('(2 pts)', '(1.5 pts)')],
    ['missing', (source) => source.replace(' M1 (2 pts):', ' M1:')],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      const { result } = await evaluate('active', mutate);
      assertCode(result, 'milestone.weight');
    });
  }
});

test('rejects checked work with pending evidence', async () => {
  const { result } = await evaluate('active', (source) => source.replace('- [ ] M2', '- [x] M2'));
  assertCode(result, 'milestone.evidence');
});

test('rejects duplicate, skipped, and reordered milestone ids', async (context) => {
  const cases = [
    ['duplicate', (source) => source.replace('- [ ] M2', '- [ ] M1')],
    ['skipped', (source) => source.replace('- [ ] M2', '- [ ] M4')],
    [
      'reordered',
      (source) => source
        .replace('- [x] M1 (2 pts): Foundation accepted', '__FIRST__')
        .replace('- [ ] M2 (3 pts): Runtime adapters accepted', '- [x] M1 (2 pts): Foundation accepted')
        .replace('__FIRST__', '- [ ] M2 (3 pts): Runtime adapters accepted'),
    ],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      const { result } = await evaluate('active', mutate);
      assertCode(result, 'milestone.sequence');
    });
  }
});

test('rejects forward, missing, and unchecked dependencies', async (context) => {
  const cases = [
    ['forward', (source) => source.replace('  - Depends-on: none', '  - Depends-on: M2')],
    ['missing', (source) => source.replace('  - Depends-on: M1', '  - Depends-on: M9')],
    [
      'unchecked',
      (source) => source
        .replace('- [ ] M3', '- [x] M3')
        .replace('  - Evidence: pending\n\n## Work packets', '  - Evidence: `final.txt` reviewed\n\n## Work packets'),
    ],
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, async () => {
      const { result } = await evaluate('active', mutate);
      assertCode(result, 'milestone.dependency');
    });
  }
});

test('rejects missing, unchecked, unevidenced, absolute, and escaping gate references', async (context) => {
  await context.test('missing', async () => {
    const { result } = await evaluate('complete', (source) => source.replace('sample.md#G1', 'absent.md#G1'));
    assertCode(result, 'gate.missing');
  });
  await context.test('unchecked', async () => {
    const fixture = await loadFixture('complete');
    const gatePath = join(fixture.root, '.unlazy', 'gates', 'sample.md');
    await writeFile(gatePath, (await readFile(gatePath, 'utf8')).replace('- [x] G1', '- [ ] G1'));
    const source = await readFile(fixture.planPath, 'utf8');
    const result = await validateProgram(parseProgram(source, fixture.planPath));
    assertCode(result, 'gate.unmet');
  });
  await context.test('pending evidence', async () => {
    const fixture = await loadFixture('complete');
    const gatePath = join(fixture.root, '.unlazy', 'gates', 'sample.md');
    await writeFile(gatePath, (await readFile(gatePath, 'utf8')).replace('EVIDENCE: fixture receipt', 'EVIDENCE: pending'));
    const source = await readFile(fixture.planPath, 'utf8');
    const result = await validateProgram(parseProgram(source, fixture.planPath));
    assertCode(result, 'gate.evidence');
  });
  await context.test('missing evidence', async () => {
    const fixture = await loadFixture('complete');
    const gatePath = join(fixture.root, '.unlazy', 'gates', 'sample.md');
    await writeFile(gatePath, (await readFile(gatePath, 'utf8')).replace('  EVIDENCE: fixture receipt\n', ''));
    const source = await readFile(fixture.planPath, 'utf8');
    const result = await validateProgram(parseProgram(source, fixture.planPath));
    assertCode(result, 'gate.evidence');
  });
  await context.test('absolute', async () => {
    const { result } = await evaluate('complete', (source) => source.replace('.unlazy/gates/sample.md#G1', '/etc/passwd#G1'));
    assertCode(result, 'gate.outside-root');
  });
  await context.test('escaping', async () => {
    const { result } = await evaluate('complete', (source) => source.replace('.unlazy/gates/sample.md#G1', '../outside.md#G1'));
    assertCode(result, 'gate.outside-root');
  });
});

test('rejects active current pointing to completed work', async () => {
  const { result } = await evaluate('active', (source) => source.replace('Current: M2', 'Current: M1'));
  assertCode(result, 'metadata.current');
});

test('rejects complete status while work remains', async () => {
  const { result } = await evaluate('active', (source) => source
    .replace('Status: active', 'Status: complete')
    .replace('Current: M2', 'Current: none'));
  assertCode(result, 'completion.incomplete');
});

test('rejects packet missing a field or naming an unknown parent', async (context) => {
  await context.test('missing field', async () => {
    const { result } = await evaluate('active', (source) => source.replace('Owner: main\n', ''));
    assertCode(result, 'packet.field');
  });
  await context.test('unknown parent', async () => {
    const { result } = await evaluate('active', (source) => source.replace('Parent: M2', 'Parent: M9'));
    assertCode(result, 'packet.parent');
  });
});

test('rejects active packet under a non-current milestone', async () => {
  const { result } = await evaluate('active', (source) => source.replace('Parent: M2', 'Parent: M3'));
  assertCode(result, 'packet.current');
});

test('allows a denominator-changing replan to move progress backward', async () => {
  const baseline = await evaluate('active');
  const replanned = await evaluate('active', (source) => source.replace('M2 (3 pts)', 'M2 (8 pts)'));
  assert.equal(replanned.result.valid, true);
  assert.ok(replanned.result.percent < baseline.result.percent);
  assert.equal(replanned.result.percent, 18);
});

test('caps diagnostics at twenty and reports the omitted count', async () => {
  const { result } = await evaluate('active', (source) => {
    const packets = Array.from({ length: 25 }, (_, index) => [
      `### WP-M2-${index + 2}: Invalid packet ${index + 1}`,
      'Parent: M2',
      'State: pending',
    ].join('\n')).join('\n\n');
    return source.replace('## Plan changes', `${packets}\n\n## Plan changes`);
  });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.length, 20);
  assert.ok(result.omittedDiagnostics > 0);
});

test('emits structured json and honors check-only mode', async () => {
  const fixture = await loadFixture('active');
  const jsonOut = [];
  const jsonErr = [];
  const jsonExit = await runCli(['--plan', fixture.planPath, '--json'], {
    cwd: fixture.root,
    stdout: (value) => jsonOut.push(value),
    stderr: (value) => jsonErr.push(value),
  });
  assert.equal(jsonExit, 0);
  assert.equal(jsonErr.length, 0);
  const payload = JSON.parse(jsonOut.join(''));
  assert.equal(payload.percent, 33);
  assert.equal(payload.earnedPoints, 2);
  assert.equal(JSON.stringify(payload).includes('fixture receipt'), false);

  const checkOut = [];
  const checkExit = await runCli(['--plan', fixture.planPath, '--check'], {
    cwd: fixture.root,
    stdout: (value) => checkOut.push(value),
    stderr: () => {},
  });
  assert.equal(checkExit, 0);
  assert.deepEqual(checkOut, []);
});

test('returns usage exit two for incompatible or unknown options', async () => {
  const io = { cwd: process.cwd(), stdout: () => {}, stderr: () => {} };
  assert.equal(await runCli(['--json', '--check'], io), 2);
  assert.equal(await runCli(['--unknown'], io), 2);
  assert.equal(await runCli(['--plan'], io), 2);
});

test('runs the CLI when its entrypoint is reached through a symlink', async () => {
  const fixture = await loadFixture('active');
  const linkRoot = await mkdtemp(join(tmpdir(), 'long-run-cli-link-'));
  const entrypoint = join(linkRoot, 'long-run-status.mjs');
  await symlink(resolve(import.meta.dirname, '../scripts/long-run-status.mjs'), entrypoint);
  const child = spawnSync(process.execPath, [entrypoint, '--plan', fixture.planPath], { encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.equal(
    child.stdout,
    'Fixture active program [███░░░░░░░] 33% · active · M2/3 — Runtime adapters accepted\n',
  );
});
