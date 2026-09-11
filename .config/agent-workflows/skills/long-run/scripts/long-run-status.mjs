#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '<!-- long-run:v1 -->';
const STATUS_VALUES = new Set(['active', 'blocked', 'complete']);
const PACKET_STATES = new Set(['pending', 'active', 'blocked', 'complete']);
const PACKET_FIELDS = [
  'Parent',
  'State',
  'Owner',
  'Outcome',
  'Scope',
  'Non-goals',
  'Dependencies',
  'Artifacts',
  'Checks',
  'Authority',
  'Stop',
  'Next',
];
const MILESTONE_CANDIDATE_RE = /^- \[([ xX])\] (M\d+)(?: \(([^)]*) pts\))?: (.+)$/;
const MILESTONE_FIELD_RE = /^  - (Depends-on|Acceptance|Gate|Evidence): (.*)$/;
const PACKET_RE = /^### (WP-M\d+-\d+): (.+)$/;
const RFC3339_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:?\d{2}$/;
const MAX_DIAGNOSTICS = 20;

/** @typedef {{ code: string, message: string, line: number }} Diagnostic */
/** @typedef {{ id: string, title: string, points: number, checked: boolean, dependsOn: string[], acceptance: string, evidence: string, gate: null | { path: string, id: string }, line: number, fieldLines: Record<string, number> }} Milestone */
/** @typedef {{ id: string, title: string, parent: string, state: string, fields: Record<string, string>, line: number, fieldLines: Record<string, number> }} WorkPacket */

function diagnostic(code, message, line = 1) {
  return { code, message, line };
}

function visibleLines(source) {
  const lines = source.split(/\r?\n/);
  let fence = null;
  return lines.map((text, index) => {
    const match = /^\s*(`{3,}|~{3,})/.exec(text);
    const outside = fence === null;
    if (match) {
      const marker = match[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return { text, line: index + 1, visible: false };
    }
    return { text, line: index + 1, visible: outside };
  });
}

function findSection(lines, heading) {
  const start = lines.findIndex((entry) => entry.visible && entry.text === heading);
  if (start === -1) return { start: -1, end: -1 };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].visible && /^## /.test(lines[index].text)) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function fieldValue(lines, prefix) {
  const entry = lines.find((item) => item.visible && item.text.startsWith(prefix));
  return entry ? { value: entry.text.slice(prefix.length).trim(), line: entry.line } : null;
}

function projectRootFor(planPath, cwd = process.cwd()) {
  const absolutePlan = resolve(cwd, planPath);
  if (basename(absolutePlan) === 'todo.md' && basename(dirname(absolutePlan)) === 'tasks') {
    return dirname(dirname(absolutePlan));
  }
  return resolve(cwd);
}

export function parseProgram(source, planPath, options = {}) {
  const absolutePlan = resolve(options.cwd ?? process.cwd(), planPath);
  const lines = visibleLines(source);
  const diagnostics = [];
  const firstNonblank = lines.find((entry) => entry.visible && entry.text.trim() !== '');
  if (!firstNonblank || firstNonblank.text.trim() !== MARKER) {
    diagnostics.push(diagnostic('marker.missing', `${MARKER} must be the first nonblank line`, firstNonblank?.line ?? 1));
  }

  const programField = fieldValue(lines, '# Program: ');
  const statusField = fieldValue(lines, 'Status: ');
  const currentField = fieldValue(lines, 'Current: ');
  const finalField = fieldValue(lines, 'Final: ');
  const updatedField = fieldValue(lines, 'Updated: ');
  const detailedPlanField = fieldValue(lines, 'Detailed-plan: ');
  const requiredMetadata = [
    ['# Program', programField],
    ['Status', statusField],
    ['Current', currentField],
    ['Final', finalField],
    ['Updated', updatedField],
    ['Detailed-plan', detailedPlanField],
  ];
  for (const [name, value] of requiredMetadata) {
    if (!value || !value.value) diagnostics.push(diagnostic('metadata.missing', `${name} is required`, value?.line ?? 1));
  }
  if (statusField && !STATUS_VALUES.has(statusField.value)) {
    diagnostics.push(diagnostic('metadata.status', `Status must be active, blocked, or complete`, statusField.line));
  }
  if (updatedField && !RFC3339_OFFSET_RE.test(updatedField.value)) {
    diagnostics.push(diagnostic('metadata.updated', `Updated must be RFC 3339 with an explicit numeric offset`, updatedField.line));
  }

  const outcomeSection = findSection(lines, '## Outcome');
  if (outcomeSection.start === -1) {
    diagnostics.push(diagnostic('section.missing', '## Outcome is required'));
  } else {
    const outcome = lines.slice(outcomeSection.start + 1, outcomeSection.end)
      .find((entry) => entry.visible && entry.text.trim() !== '');
    if (!outcome) diagnostics.push(diagnostic('outcome.missing', 'Outcome must contain one accepted parent outcome', lines[outcomeSection.start].line));
  }

  const milestoneSection = findSection(lines, '## Milestones');
  /** @type {Milestone[]} */
  const milestones = [];
  if (milestoneSection.start === -1) {
    diagnostics.push(diagnostic('section.missing', '## Milestones is required'));
  } else {
    const section = lines.slice(milestoneSection.start + 1, milestoneSection.end);
    for (let index = 0; index < section.length; index += 1) {
      const entry = section[index];
      if (!entry.visible || !entry.text.startsWith('- [')) continue;
      const match = MILESTONE_CANDIDATE_RE.exec(entry.text);
      if (!match) {
        diagnostics.push(diagnostic('milestone.syntax', 'Milestone must use - [ ] M1 (1 pts): Title', entry.line));
        continue;
      }
      const [, check, id, rawPoints, title] = match;
      const validWeight = typeof rawPoints === 'string' && /^[1-9]\d*$/.test(rawPoints);
      if (!validWeight) diagnostics.push(diagnostic('milestone.weight', `${id} points must be a positive integer`, entry.line));
      const fields = {};
      const fieldLines = {};
      for (let cursor = index + 1; cursor < section.length; cursor += 1) {
        const candidate = section[cursor];
        if (candidate.visible && candidate.text.startsWith('- [')) break;
        if (!candidate.visible) continue;
        const fieldMatch = MILESTONE_FIELD_RE.exec(candidate.text);
        if (fieldMatch) {
          const [, name, value] = fieldMatch;
          if (Object.hasOwn(fields, name)) diagnostics.push(diagnostic('milestone.field', `${id} repeats ${name}`, candidate.line));
          fields[name] = value.trim();
          fieldLines[name] = candidate.line;
        }
      }
      for (const required of ['Depends-on', 'Acceptance', 'Evidence']) {
        if (!Object.hasOwn(fields, required) || fields[required] === '') {
          diagnostics.push(diagnostic('milestone.field', `${id} requires ${required}`, entry.line));
        }
      }
      let gate = null;
      if (fields.Gate) {
        const gateMatch = /^`([^`]+)#(G\d+)`$/.exec(fields.Gate);
        if (!gateMatch) diagnostics.push(diagnostic('gate.reference', `${id} Gate must be a backticked project-relative path plus #G<number>`, fieldLines.Gate));
        else gate = { path: gateMatch[1], id: gateMatch[2] };
      }
      milestones.push({
        id,
        title: title.trim(),
        points: validWeight ? Number(rawPoints) : 0,
        checked: check.toLowerCase() === 'x',
        dependsOn: fields['Depends-on'] && fields['Depends-on'].toLowerCase() !== 'none'
          ? fields['Depends-on'].split(',').map((value) => value.trim()).filter(Boolean)
          : [],
        acceptance: fields.Acceptance ?? '',
        evidence: fields.Evidence ?? '',
        gate,
        line: entry.line,
        fieldLines,
      });
    }
  }
  if (milestones.length === 0) diagnostics.push(diagnostic('milestone.missing', 'At least one milestone is required', milestoneSection.start >= 0 ? lines[milestoneSection.start].line : 1));

  const packetSection = findSection(lines, '## Work packets');
  /** @type {WorkPacket[]} */
  const packets = [];
  if (packetSection.start === -1) {
    diagnostics.push(diagnostic('section.missing', '## Work packets is required'));
  } else {
    const section = lines.slice(packetSection.start + 1, packetSection.end);
    for (let index = 0; index < section.length; index += 1) {
      const entry = section[index];
      if (!entry.visible || !entry.text.startsWith('### ')) continue;
      const match = PACKET_RE.exec(entry.text);
      if (!match) {
        diagnostics.push(diagnostic('packet.syntax', 'Packet must use ### WP-M1-1: Title', entry.line));
        continue;
      }
      const fields = {};
      const fieldLines = {};
      for (let cursor = index + 1; cursor < section.length; cursor += 1) {
        const candidate = section[cursor];
        if (candidate.visible && candidate.text.startsWith('### ')) break;
        if (!candidate.visible) continue;
        const fieldMatch = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(candidate.text);
        if (fieldMatch) {
          fields[fieldMatch[1]] = fieldMatch[2].trim();
          fieldLines[fieldMatch[1]] = candidate.line;
        }
      }
      for (const required of PACKET_FIELDS) {
        if (!Object.hasOwn(fields, required) || fields[required] === '') {
          diagnostics.push(diagnostic('packet.field', `${match[1]} requires ${required}`, entry.line));
        }
      }
      packets.push({
        id: match[1],
        title: match[2].trim(),
        parent: fields.Parent ?? '',
        state: fields.State ?? '',
        fields,
        line: entry.line,
        fieldLines,
      });
    }
  }

  const planChanges = findSection(lines, '## Plan changes');
  if (planChanges.start === -1) diagnostics.push(diagnostic('section.missing', '## Plan changes is required'));

  return {
    planPath: absolutePlan,
    projectRoot: projectRootFor(absolutePlan, options.cwd),
    name: programField?.value ?? '',
    status: statusField?.value ?? '',
    current: currentField?.value ?? '',
    final: finalField?.value ?? '',
    updated: updatedField?.value ?? '',
    detailedPlan: detailedPlanField?.value ?? '',
    milestones,
    packets,
    diagnostics,
  };
}

function concreteEvidence(value) {
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'pending' && normalized !== 'none';
}

function contained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function gateReceipt(content, gateId) {
  const escapedId = gateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const gatePattern = new RegExp(`^- \\[([ xX])\\] ${escapedId}:`);
  const nextGatePattern = /^- \[[ xX]\] G\d+:/;
  const lines = content.split(/\r?\n/);
  const gateIndex = lines.findIndex((line) => gatePattern.test(line));
  if (gateIndex === -1) return { found: false, checked: false, evidence: '' };
  const match = lines[gateIndex].match(gatePattern);
  let evidence = '';
  for (let index = gateIndex + 1; index < lines.length; index += 1) {
    if (nextGatePattern.test(lines[index])) break;
    const evidenceMatch = lines[index].match(/^\s+EVIDENCE:\s*(.*)$/);
    if (evidenceMatch) {
      evidence = evidenceMatch[1];
      break;
    }
  }
  return { found: true, checked: match?.[1].toLowerCase() === 'x', evidence };
}

async function checkGate(program, milestone, diagnostics, readText, resolveRealpath) {
  if (!milestone.gate) return true;
  const gateLine = milestone.fieldLines.Gate ?? milestone.line;
  if (isAbsolute(milestone.gate.path)) {
    diagnostics.push(diagnostic('gate.outside-root', `${milestone.id} Gate path must be project-relative`, gateLine));
    return false;
  }
  const candidate = resolve(program.projectRoot, milestone.gate.path);
  if (!contained(program.projectRoot, candidate)) {
    diagnostics.push(diagnostic('gate.outside-root', `${milestone.id} Gate path escapes the project root`, gateLine));
    return false;
  }
  if (!milestone.checked) return false;
  let realCandidate;
  try {
    realCandidate = await resolveRealpath(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      diagnostics.push(diagnostic('gate.missing', `${milestone.id} Gate file does not exist`, gateLine));
      return false;
    }
    diagnostics.push(diagnostic('gate.read', `${milestone.id} Gate path could not be resolved`, gateLine));
    return false;
  }
  let realRoot;
  try {
    realRoot = await resolveRealpath(program.projectRoot);
  } catch {
    realRoot = program.projectRoot;
  }
  if (!contained(realRoot, realCandidate)) {
    diagnostics.push(diagnostic('gate.outside-root', `${milestone.id} Gate symlink escapes the project root`, gateLine));
    return false;
  }
  let content;
  try {
    content = await readText(realCandidate, 'utf8');
  } catch {
    diagnostics.push(diagnostic('gate.read', `${milestone.id} Gate file could not be read`, gateLine));
    return false;
  }
  const receipt = gateReceipt(content, milestone.gate.id);
  if (!receipt.found || !receipt.checked) {
    diagnostics.push(diagnostic('gate.unmet', `${milestone.id} references unchecked ${milestone.gate.id}`, gateLine));
    return false;
  }
  if (!concreteEvidence(receipt.evidence)) {
    diagnostics.push(diagnostic('gate.evidence', `${milestone.id} references ${milestone.gate.id} without concrete evidence`, gateLine));
    return false;
  }
  return true;
}

export async function validateProgram(program, options = {}) {
  const allDiagnostics = [...program.diagnostics];
  const readText = options.readText ?? readFile;
  const resolveRealpath = options.realpath ?? realpath;
  const milestoneById = new Map();
  const earnedById = new Map();
  const milestoneStates = [];

  program.milestones.forEach((milestone, index) => {
    const expected = `M${index + 1}`;
    if (milestone.id !== expected || milestoneById.has(milestone.id)) {
      allDiagnostics.push(diagnostic('milestone.sequence', `Expected ${expected} at position ${index + 1}; found ${milestone.id}`, milestone.line));
    }
    milestoneById.set(milestone.id, milestone);
  });

  for (let index = 0; index < program.milestones.length; index += 1) {
    const milestone = program.milestones[index];
    let dependencyStructureValid = true;
    for (const dependency of milestone.dependsOn) {
      const dependencyIndex = program.milestones.findIndex((candidate) => candidate.id === dependency);
      if (dependencyIndex === -1 || dependencyIndex >= index) {
        allDiagnostics.push(diagnostic('milestone.dependency', `${milestone.id} dependency ${dependency} must name an earlier milestone`, milestone.fieldLines['Depends-on'] ?? milestone.line));
        dependencyStructureValid = false;
      }
    }
    const dependenciesEarned = dependencyStructureValid
      && milestone.dependsOn.every((dependency) => earnedById.get(dependency) === true);
    if (milestone.checked && !dependenciesEarned) {
      allDiagnostics.push(diagnostic('milestone.dependency', `${milestone.id} is checked before all dependencies are earned`, milestone.line));
    }
    const evidenceValid = concreteEvidence(milestone.evidence);
    if (milestone.checked && !evidenceValid) {
      allDiagnostics.push(diagnostic('milestone.evidence', `${milestone.id} is checked without concrete evidence`, milestone.fieldLines.Evidence ?? milestone.line));
    }
    const gateValid = await checkGate(program, milestone, allDiagnostics, readText, resolveRealpath);
    const earned = milestone.checked && milestone.points > 0 && dependenciesEarned && evidenceValid && gateValid;
    earnedById.set(milestone.id, earned);
    milestoneStates.push({ ...milestone, earned });
  }

  const finalMilestone = program.milestones.at(-1);
  if (finalMilestone && program.final !== finalMilestone.id) {
    allDiagnostics.push(diagnostic('metadata.final', `Final must name ${finalMilestone.id}`, 1));
  }
  const currentMilestone = milestoneById.get(program.current);
  if (program.status === 'complete') {
    if (program.current !== 'none') allDiagnostics.push(diagnostic('metadata.current', 'Complete programs require Current: none', 1));
  } else if (STATUS_VALUES.has(program.status)) {
    if (!currentMilestone || currentMilestone.checked) {
      allDiagnostics.push(diagnostic('metadata.current', 'Current must name one unchecked milestone', 1));
    } else if (!currentMilestone.dependsOn.every((dependency) => earnedById.get(dependency) === true)) {
      allDiagnostics.push(diagnostic('metadata.current', 'Current milestone dependencies must already be earned', currentMilestone.line));
    }
  }

  const packetIds = new Set();
  for (const packet of program.packets) {
    if (packetIds.has(packet.id)) allDiagnostics.push(diagnostic('packet.id', `${packet.id} is duplicated`, packet.line));
    packetIds.add(packet.id);
    if (!milestoneById.has(packet.parent)) {
      allDiagnostics.push(diagnostic('packet.parent', `${packet.id} parent ${packet.parent || '(missing)'} is unknown`, packet.fieldLines.Parent ?? packet.line));
    }
    if (!PACKET_STATES.has(packet.state)) {
      allDiagnostics.push(diagnostic('packet.state', `${packet.id} State must be pending, active, blocked, or complete`, packet.fieldLines.State ?? packet.line));
    }
    if ((packet.state === 'active' || packet.state === 'blocked') && packet.parent !== program.current) {
      allDiagnostics.push(diagnostic('packet.current', `${packet.id} ${packet.state} parent must equal Current`, packet.fieldLines.Parent ?? packet.line));
    }
    if (packet.state === 'complete') {
      for (const field of ['Artifacts', 'Checks']) {
        if (!concreteEvidence(packet.fields[field] ?? '')) {
          allDiagnostics.push(diagnostic('packet.evidence', `${packet.id} complete packet requires concrete ${field}`, packet.fieldLines[field] ?? packet.line));
        }
      }
    }
  }

  const totalPoints = program.milestones.reduce((sum, milestone) => sum + milestone.points, 0);
  const earnedPoints = milestoneStates.reduce((sum, milestone) => sum + (milestone.earned ? milestone.points : 0), 0);
  const percent = totalPoints === 0 ? 0 : Math.floor((100 * earnedPoints) / totalPoints);
  const allEarned = milestoneStates.length > 0 && milestoneStates.every((milestone) => milestone.earned);
  if (program.status === 'complete' && (!allEarned || program.final !== finalMilestone?.id)) {
    allDiagnostics.push(diagnostic('completion.incomplete', 'Complete status requires every milestone and the final gate to be earned', 1));
  }
  if (program.status !== 'complete' && allEarned) {
    allDiagnostics.push(diagnostic('completion.status', 'All milestones are earned; Status must be complete', 1));
  }

  const diagnostics = allDiagnostics.slice(0, MAX_DIAGNOSTICS);
  return {
    valid: allDiagnostics.length === 0,
    diagnostics,
    omittedDiagnostics: Math.max(0, allDiagnostics.length - diagnostics.length),
    program: {
      planPath: program.planPath,
      projectRoot: program.projectRoot,
      name: program.name,
      status: program.status,
      current: program.current,
      final: program.final,
      updated: program.updated,
      detailedPlan: program.detailedPlan,
    },
    milestones: milestoneStates.map(({ fieldLines, ...milestone }) => milestone),
    packets: program.packets.map(({ fieldLines, ...packet }) => packet),
    earnedPoints,
    totalPoints,
    percent,
  };
}

export function renderStatus(result) {
  const filled = result.percent === 100 ? 10 : Math.floor(result.percent / 10);
  const bar = `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
  if (result.program.status === 'complete') {
    return `${result.program.name} [${bar}] ${result.percent}% · complete`;
  }
  const index = result.milestones.findIndex((milestone) => milestone.id === result.program.current);
  const current = result.milestones[index];
  const position = index >= 0 ? index + 1 : '?';
  const title = current?.title ?? 'invalid current milestone';
  return `${result.program.name} [${bar}] ${result.percent}% · ${result.program.status} · M${position}/${result.milestones.length} — ${title}`;
}

function parseArgs(argv) {
  let planPath = 'tasks/todo.md';
  let json = false;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) return { error: '--plan requires a path' };
      planPath = argv[index + 1];
      index += 1;
    } else if (arg === '--json') json = true;
    else if (arg === '--check') check = true;
    else return { error: `unknown option: ${arg}` };
  }
  if (json && check) return { error: '--json and --check are mutually exclusive' };
  return { planPath, json, check };
}

function defaultWriter(stream) {
  return (value) => stream.write(value);
}

export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? defaultWriter(process.stdout);
  const stderr = io.stderr ?? defaultWriter(process.stderr);
  const cwd = io.cwd ?? process.cwd();
  const args = parseArgs(argv);
  if (args.error) {
    stderr(`long-run-status: ${args.error}\n`);
    return 2;
  }
  const planPath = resolve(cwd, args.planPath);
  let source;
  try {
    source = await readFile(planPath, 'utf8');
  } catch (error) {
    stderr(`long-run-status: cannot read ${planPath}: ${error.code ?? 'I/O error'}\n`);
    return 2;
  }
  const result = await validateProgram(parseProgram(source, planPath, { cwd }));
  if (args.json) stdout(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) {
    for (const item of result.diagnostics) {
      stderr(`${planPath}:${item.line} [${item.code}] ${item.message}\n`);
    }
    if (result.omittedDiagnostics > 0) stderr(`${planPath}: ${result.omittedDiagnostics} additional diagnostics omitted\n`);
    return 1;
  }
  if (!args.json && !args.check) stdout(`${renderStatus(result)}\n`);
  return 0;
}

const invokedPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : '';
if (realpathSync(fileURLToPath(import.meta.url)) === invokedPath) {
  process.exitCode = await runCli(process.argv.slice(2));
}
