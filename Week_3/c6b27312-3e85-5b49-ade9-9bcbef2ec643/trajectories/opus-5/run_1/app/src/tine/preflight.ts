import { sentenceCaseLabel } from '../shared/labels';
import { cmpNumber, cmpText } from '../shared/order';
import { displayAtMost, money, oneSignificantFigure, withUnit } from '../shared/numbers';
import { Box, Pose, boxOfBbox, poseOfBox } from '../shared/pose';
import { TineProgram } from './ast';
import { EvaluatedOp, TapeStep } from './evaluate';
import { Bbox, SolidOp, centreLine, cutGap, outerWall } from './solid';
import { Measures } from './solid';

export type ProcessId = 'fdm-04' | 'mill-3' | 'laser-sheet';

export type PreflightProcess = {
  id: ProcessId;
  label: string;
  envelope: Bbox;
  wallBlocking: number;
  wallAdvisory: number;
  holeDepthRatio: number | null;
  setup: number;
  rate: number;
  leadTime: string;
};

export const PROCESSES: PreflightProcess[] = [
  {
    id: 'fdm-04',
    label: 'FDM print, 0.4 mm nozzle',
    envelope: [220, 220, 250],
    wallBlocking: 1.2,
    wallAdvisory: 2.0,
    holeDepthRatio: null,
    setup: 2,
    rate: 0.06,
    leadTime: '2–4 working days',
  },
  {
    id: 'mill-3',
    label: 'Three-axis mill',
    envelope: [300, 200, 100],
    wallBlocking: 1.0,
    wallAdvisory: 1.5,
    holeDepthRatio: 6,
    setup: 40,
    rate: 0.45,
    leadTime: '5–10 working days',
  },
  {
    id: 'laser-sheet',
    label: 'Laser-cut sheet',
    envelope: [600, 400, 6],
    wallBlocking: 1.5,
    wallAdvisory: 3.0,
    holeDepthRatio: null,
    setup: 8,
    rate: 0.3,
    leadTime: '3–6 working days',
  },
];

export function findProcess(id: string): PreflightProcess | undefined {
  return PROCESSES.find((process) => process.id === id);
}

export { poseOfBox } from '../shared/pose';
export type { Box, Pose } from '../shared/pose';

export function partBox(bbox: Bbox): Box {
  return boxOfBbox(bbox);
}

export function cutBox(op: SolidOp, height: number): Box {
  switch (op.op) {
    case 'hole': {
      const radius = op.dia / 2;
      return { min: [op.x - radius, op.y - radius, 0], max: [op.x + radius, op.y + radius, height] };
    }
    case 'slot': {
      const radius = op.w / 2;
      return {
        min: [op.x - op.len / 2 - radius, op.y - radius, 0],
        max: [op.x + op.len / 2 + radius, op.y + radius, height],
      };
    }
    case 'boss': {
      const radius = op.dia / 2;
      return {
        min: [op.x - radius, op.y - radius, height],
        max: [op.x + radius, op.y + radius, height + op.h],
      };
    }
    default:
      return { min: [0, 0, 0], max: [0, 0, 0] };
  }
}

export type Severity = 'Blocking' | 'Advisory' | 'Pass';

export type Finding = {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  cutLabel: string | null;
  measured: number;
  threshold: number;
  operation: number;
  parameters: string[];
  pose: Pose;
};

export type CostBand = { quantity: number; low: number; high: number; text: string };

export type PreflightReport = {
  process: ProcessId;
  status: 'complete' | 'unsupported';
  message: string | null;
  findings: Finding[];
  costBands: CostBand[];
  confidence: 'High' | 'Medium' | 'Low' | null;
};

function shortfallOf(finding: Finding): number {
  return Math.abs(finding.measured - finding.threshold) / finding.threshold;
}

const SEVERITY_RANK: Record<Severity, number> = { Blocking: 0, Advisory: 1, Pass: 2 };

/** The wall of a cut: its smallest distance to the body's outer edge or another cut. */
export function wallOf(op: SolidOp, ops: SolidOp[], body: SolidOp): number {
  const line = centreLine(op);
  if (!line) return Infinity;
  let wall = outerWall(line, body);
  for (const other of ops) {
    if (other === op) continue;
    const otherLine = centreLine(other);
    if (!otherLine) continue;
    wall = Math.min(wall, cutGap(line, otherLine));
  }
  return wall;
}

export function costBands(volumeMm3: number, process: PreflightProcess): CostBand[] {
  const volumeCm3 = volumeMm3 / 1000;
  return [1, 10, 100].map((quantity) => {
    const unit = process.setup / quantity + volumeCm3 * process.rate;
    const low = oneSignificantFigure(0.8 * unit);
    const high = oneSignificantFigure(1.25 * unit);
    return { quantity, low, high, text: `${money(low)}–${money(high)} each` };
  });
}

export const ESTIMATE_LINE = 'Estimate from geometry alone. Not a quote: no supplier has seen this part.';

export function leadTimeLine(process: PreflightProcess): string {
  return `Typical lead time ${process.leadTime}`;
}

function parametersOfStatement(op: EvaluatedOp, named: Set<string>): string[] {
  const texts =
    op.statement.k === 'cut'
      ? [...op.statement.args.map((entry) => entry.text), op.statement.at[0].text, op.statement.at[1].text]
      : op.statement.args.map((entry) => entry.text);
  const names: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
      if (match[0] !== 'pick' && named.has(match[0]) && !names.includes(match[0])) names.push(match[0]);
    }
  }
  return names;
}

/** A report is computed only from its own request's values and process. */
export function runPreflight(
  program: TineProgram,
  ops: EvaluatedOp[],
  measures: Measures,
  tape: TapeStep[],
  process: PreflightProcess,
): PreflightReport {
  const named = new Set(program.parameters.map((entry) => entry.name));
  const solids = ops.map((op) => op.solid);
  const body = ops[0];
  const bodySolid = body.solid;
  const height = bodySolid.op === 'box' ? bodySolid.h : bodySolid.op === 'cylinder' ? bodySolid.h : 0;

  const operationOfLine = new Map<number, number>();
  for (const step of tape) {
    if ((step.kind === 'body' || step.kind === 'cut' || step.kind === 'join') && step.line !== null) {
      operationOfLine.set(step.line, step.index);
    }
  }

  if (process.id === 'laser-sheet' && ops.some((op) => op.solid.op === 'boss')) {
    return {
      process: process.id,
      status: 'unsupported',
      message: 'Laser-cut sheet needs a part of one uniform thickness.',
      findings: [],
      costBands: [],
      confidence: null,
    };
  }

  const findings: Finding[] = [];
  const bbox = measures.bbox;
  const overruns = bbox.map((size, axis) => size - process.envelope[axis]);
  if (overruns.some((overrun) => overrun > 0)) {
    let worstAxis = 0;
    let worst = -Infinity;
    for (let axis = 0; axis < 3; axis += 1) {
      const ratio = overruns[axis] / process.envelope[axis];
      if (ratio > worst) {
        worst = ratio;
        worstAxis = axis;
      }
    }
    findings.push({
      id: 'envelope:part',
      severity: 'Blocking',
      code: 'envelope',
      message: `Part is ${displayAtMost(bbox[0], 2)} × ${displayAtMost(bbox[1], 2)} × ${withUnit(
        displayAtMost(bbox[2], 2),
        'mm',
      )}; the ${process.label} envelope is ${displayAtMost(process.envelope[0], 2)} × ${displayAtMost(
        process.envelope[1],
        2,
      )} × ${withUnit(displayAtMost(process.envelope[2], 2), 'mm')}.`,
      cutLabel: null,
      measured: bbox[worstAxis],
      threshold: process.envelope[worstAxis],
      operation: operationOfLine.get(body.line) ?? 0,
      parameters: parametersOfStatement(body, named),
      pose: poseOfBox(partBox(bbox)),
    });
  }

  for (const op of ops) {
    if (op.solid.op !== 'hole' && op.solid.op !== 'slot') continue;
    const wall = wallOf(op.solid, solids, bodySolid);
    const threshold =
      wall < process.wallBlocking
        ? process.wallBlocking
        : wall < process.wallAdvisory
          ? process.wallAdvisory
          : null;
    if (threshold === null) continue;
    findings.push({
      id: `wall:${op.label}`,
      severity: wall < process.wallBlocking ? 'Blocking' : 'Advisory',
      code: 'wall',
      message: `Wall beside ${op.label} is ${withUnit(displayAtMost(wall, 2), 'mm')}; ${
        process.label
      } needs at least ${withUnit(displayAtMost(threshold, 2), 'mm')}.`,
      cutLabel: op.label,
      measured: wall,
      threshold,
      operation: operationOfLine.get(op.line) ?? 0,
      parameters: parametersOfStatement(op, named),
      pose: poseOfBox(cutBox(op.solid, height)),
    });
  }

  if (process.holeDepthRatio !== null) {
    for (const op of ops) {
      if (op.solid.op !== 'hole') continue;
      const ratio = height / op.solid.dia;
      if (ratio <= process.holeDepthRatio) continue;
      findings.push({
        id: `hole_depth:${op.label}`,
        severity: 'Blocking',
        code: 'hole_depth',
        message: `${op.label} is ${displayAtMost(ratio, 2)}× deeper than its diameter; ${
          process.label
        } allows at most ${displayAtMost(process.holeDepthRatio, 2)}×.`,
        cutLabel: op.label,
        measured: ratio,
        threshold: process.holeDepthRatio,
        operation: operationOfLine.get(op.line) ?? 0,
        parameters: parametersOfStatement(op, named),
        pose: poseOfBox(cutBox(op.solid, height)),
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: 'pass:part',
      severity: 'Pass',
      code: 'pass',
      message: `Every check passed for ${process.label}.`,
      cutLabel: null,
      measured: 0,
      threshold: 1,
      operation: operationOfLine.get(body.line) ?? 0,
      parameters: [],
      pose: poseOfBox(partBox(bbox)),
    });
  }

  const cutOrder = new Map<string, number>();
  ops.forEach((op, index) => {
    if (op.label) cutOrder.set(op.label, index);
  });

  findings.sort((a, b) => {
    const bySeverity = cmpNumber(SEVERITY_RANK[a.severity], SEVERITY_RANK[b.severity]);
    if (bySeverity !== 0) return bySeverity;
    const byShortfall = -cmpNumber(shortfallOf(a), shortfallOf(b));
    if (byShortfall !== 0) return byShortfall;
    const envelopeFirst = cmpNumber(a.cutLabel === null ? 0 : 1, b.cutLabel === null ? 0 : 1);
    if (envelopeFirst !== 0) return envelopeFirst;
    const byCut = cmpNumber(cutOrder.get(a.cutLabel ?? '') ?? 0, cutOrder.get(b.cutLabel ?? '') ?? 0);
    if (byCut !== 0) return byCut;
    const byCode = cmpText(a.code, b.code);
    if (byCode !== 0) return byCode;
    return cmpText(a.id, b.id);
  });

  const blocking = findings.some((finding) => finding.severity === 'Blocking');
  const advisory = findings.some((finding) => finding.severity === 'Advisory');
  return {
    process: process.id,
    status: 'complete',
    message: null,
    findings,
    costBands: costBands(measures.volume, process),
    confidence: blocking ? 'Low' : advisory ? 'Medium' : 'High',
  };
}

/** `Pre-flight complete: <b> blocking, <a> advisory.` counts. */
export function findingCounts(findings: Finding[]): { blocking: number; advisory: number } {
  return {
    blocking: findings.filter((finding) => finding.severity === 'Blocking').length,
    advisory: findings.filter((finding) => finding.severity === 'Advisory').length,
  };
}

export const SEVERITY_WORDS: Severity[] = ['Blocking', 'Advisory', 'Pass'];

export function labelOfProcessParameter(name: string): string {
  return sentenceCaseLabel(name);
}
