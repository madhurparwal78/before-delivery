import { parseSource, tapeSteps, labelOfName, evalExpr, type ParsedSource } from "./tine.js";
import { evaluate, type ResolvedOp } from "./evaluate.js";
import { canonicalJson, digestOf, mm } from "../shared/canonical.js";
import { formatNumber, formatBBoxTriple } from "../shared/numbers.js";
import type { ManifestEntry, Solid, TapeOperation, Values } from "../shared/records.js";
import { PROCESSES, CATEGORIES } from "../shared/records.js";

/** Parse a stored source; stored sources always parse. */
export function parseStored(source: string): ParsedSource {
  const r = parseSource(source);
  if ("error" in r) throw new Error(`Stored source failed to parse: ${r.error.reason}`);
  return r.parsed;
}

/** The manifest in declaration order with values applied. */
export function buildManifest(parsed: ParsedSource, values: Values): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const p of parsed.params) {
    let step: number | undefined, precision: number;
    if (p.kind === "count") { step = 1; precision = 0; }
    else if (p.step !== undefined) {
      step = p.step;
      precision = p.declaredStep!.includes(".") ? p.declaredStep!.split(".")[1]!.length : 0;
    } else {
      const mag = Math.floor(Math.log10(Math.abs(Number(p.default)) || 1));
      step = 10 ** (mag - 2);
      precision = Math.max(0, 2 - mag);
    }
    const has = Object.prototype.hasOwnProperty.call(values, p.name);
    out.push({
      name: p.name,
      label: labelOfName(p.name),
      kind: p.kind,
      unit: p.kind === "length" ? "mm" : p.kind === "angle" ? "\u00b0" : null,
      value: has ? values[p.name]! : p.default,
      default: p.default,
      ...(p.min !== undefined ? { min: p.min } : {}),
      ...(p.max !== undefined ? { max: p.max } : {}),
      ...(step !== undefined ? { step } : {}),
      precision,
      ...(p.options ? { options: p.options } : {}),
      group: p.group,
      derived: false,
      order: p.order,
    });
  }
  // Derived lets: default at source defaults, value at current values.
  const defaults: Values = {};
  const current: Values = {};
  for (const p of parsed.params) {
    defaults[p.name] = p.default;
    current[p.name] = Object.prototype.hasOwnProperty.call(values, p.name) ? values[p.name]! : p.default;
  }
  const evalAt = (v: Values): Record<string, number> => {
    const d: Record<string, number> = {};
    for (const l of parsed.lets) d[l.name] = evalExpr(l.expr, v, d);
    return d;
  };
  const derivedDefault = evalAt(defaults);
  const derivedCurrent = evalAt(current);
  for (const l of parsed.lets) {
    const def = derivedDefault[l.name]!;
    const mag = Math.floor(Math.log10(Math.abs(def) || 1));
    const precision = Math.max(0, 2 - mag);
    out.push({
      name: l.name,
      label: labelOfName(l.name),
      kind: "length",
      unit: "mm",
      value: derivedCurrent[l.name]!,
      default: def,
      precision,
      group: l.group,
      derived: true,
      order: l.order,
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

const EMPTY_DIGEST = digestOf(canonicalJson({ ops: [] }));

export interface TapeEntry extends TapeOperation {
  solid: Solid;
}

/**
 * The build tape: one entry per params/repeat/geometry line in source order,
 * each carrying the solid so far. Params and repeat steps repeat the previous
 * digest; geometry steps evaluate the source truncated after their line.
 */
export function buildTape(source: string, parsed: ParsedSource, values: Values): { operations: TapeEntry[]; finalDigest: string } {
  const steps = tapeSteps(source, parsed);
  const entries: TapeEntry[] = [];
  let prevDigest = EMPTY_DIGEST;
  let prevVolume = 0;
  let prevBbox: [number, number, number] = [0, 0, 0];
  let prevFaces = 0;
  let prevSolid: Solid = { ops: [] };
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    let solid: Solid, digest: string, volume: number, bbox: [number, number, number], faces: number;
    if (step.kind === "start" || step.kind === "params") {
      solid = prevSolid;
      digest = prevDigest;
      volume = prevVolume;
      bbox = prevBbox;
      faces = prevFaces;
    } else {
      const partial = parsePartial(step.sourceUpTo);
      const rr = evaluate(partial, values, 8000);
      if ("fail" in rr) throw new Error(`Tape evaluation failed at ${step.op}: ${rr.fail.diagnostics[0]?.code}`);
      solid = rr.ok.solid;
      digest = rr.ok.digest;
      volume = rr.ok.volume;
      bbox = rr.ok.bbox;
      faces = rr.ok.faces;
    }
    entries.push({
      index: i,
      kind: step.kind,
      op: step.op,
      line: step.line,
      digest,
      volume: mm(volume),
      delta: mm(volume - prevVolume),
      bbox,
      solid,
    });
    prevDigest = digest;
    prevVolume = volume;
    prevBbox = bbox;
    prevFaces = faces;
    prevSolid = solid;
  }
  return { operations: entries, finalDigest: entries[entries.length - 1]!.digest };
}

/** Parse a source prefix; a body-less prefix gets a placeholder body. */
function parsePartial(sourceUpTo: string): ParsedSource {
  const r = parseSource(sourceUpTo);
  if ("error" in r) {
    const r2 = parseSource(sourceUpTo + "\nbox 1 1 1");
    if ("error" in r2) throw new Error(`Partial source failed to parse: ${r.error.reason}`);
    return r2.parsed;
  }
  return r.parsed;
}

/** Cut information for pre-flight walls and depths. */
export interface CutInfo {
  label: string;
  op: "hole" | "slot" | "boss";
  wall: number;
  depthRatio: number | null;
  operation: number;
  parameters: string[];
}

export interface Finding {
  id: string;
  severity: "Blocking" | "Advisory" | "Pass";
  code: string;
  message: string;
  cutLabel: string | null;
  measured: number;
  threshold: number;
  operation: number;
  parameters: string[];
  pose: { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; fov: number };
}

export interface CostBand { quantity: number; low: number; high: number; text: string }

/** The pose of a box, per the brief's camera rules. */
export function poseOfBox(box: { min: [number, number, number]; max: [number, number, number] }): Finding["pose"] {
  const cx = (box.min[0] + box.max[0]) / 2;
  const cy = (box.min[1] + box.max[1]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  const diag = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  const d = Math.max(40, 2.5 * diag);
  const k = d / Math.sqrt(3);
  return {
    position: [mm(cx + k), mm(cy - k), mm(cz + k)],
    target: [mm(cx), mm(cy), mm(cz)],
    up: [0, 0, 1],
    fov: 35,
  };
}

/** Shortfall |measured − threshold| ÷ threshold, for finding order. */
function shortfall(measured: number, threshold: number): number {
  if (threshold === 0) return 0;
  return Math.abs(measured - threshold) / threshold;
}

/**
 * Pre-flight for one request: computed only from its own values and process.
 * The caller guarantees the values evaluate cleanly (status complete path).
 */
export function preflightReport(
  parsed: ParsedSource,
  processId: string,
  evaluated: { digest: string; volume: number; bbox: [number, number, number]; solid: Solid; ops: ResolvedOp[] }
): {
  status: "complete" | "unsupported";
  message: string | null;
  findings: Finding[];
  costBands: CostBand[];
  confidence: "High" | "Medium" | "Low" | null;
} {
  const proc = PROCESSES.find((p) => p.id === processId);
  if (!proc) throw new Error(`Unknown process ${processId}`);
  const hasBoss = evaluated.solid.ops.some((o) => o.op === "boss");
  if (hasBoss && processId === "laser-sheet") {
    return {
      status: "unsupported",
      message: "Laser-cut sheet needs a part of one uniform thickness.",
      findings: [],
      costBands: [],
      confidence: null,
    };
  }
  const findings: Finding[] = [];
  const body = evaluated.ops[0]!;
  const bodyH = body.args.h!;
  const bbox = evaluated.bbox;
  // Tape operation index by source line.
  const lineToOp = tapeIndexByLine(parsed);

  // Envelope: each axis compared without rotation.
  const [ex, ey, ez] = proc.envelope;
  const overruns: number[] = [];
  const axes: [string, number, number][] = [["x", bbox[0], ex], ["y", bbox[1], ey], ["z", bbox[2], ez]];
  let envOverrun = 0;
  let envAxis: [string, number, number] | null = null;
  for (const ax of axes) {
    if (ax[1] > ax[2]) {
      const ratio = (ax[1] - ax[2]) / ax[2];
      if (ratio > envOverrun) { envOverrun = ratio; envAxis = ax; }
    }
  }
  if (envAxis) {
    findings.push({
      id: "envelope",
      severity: "Blocking",
      code: "envelope",
      message: `Part is ${formatBBoxTriple(bbox)}; the ${proc.label} envelope is ${formatNumber(ex, 2)} \u00d7 ${formatNumber(ey, 2)} \u00d7 ${formatNumber(ez, 2)}\u202Fmm.`,
      cutLabel: null,
      measured: envAxis[1],
      threshold: envAxis[2],
      operation: lineToOp.get(body.line) ?? 0,
      parameters: body.parameters,
      pose: poseOfBox({ min: [-bbox[0] / 2, -bbox[1] / 2, 0], max: [bbox[0] / 2, bbox[1] / 2, bbox[2]] }),
    });
  }
  void overruns;

  // Walls and hole depths per cut, in evaluated order.
  const earlier: ResolvedOp[] = [];
  for (let i = 1; i < evaluated.ops.length; i++) {
    const o = evaluated.ops[i]!;
    if (o.op === "boss") { earlier.push(o); continue; }
    const wall = cutWall(o, earlier, body);
    if (wall < proc.wallAdvisory) {
      const sev = wall < proc.wallBlocking ? "Blocking" : "Advisory";
      const t = sev === "Blocking" ? proc.wallBlocking : proc.wallAdvisory;
      findings.push({
        id: `wall-${o.cutLabel}`,
        severity: sev,
        code: "wall",
        message: `Wall beside ${o.cutLabel} is ${formatNumber(wall, 2)} mm; ${proc.label} needs at least ${formatNumber(t, 2)}\u202Fmm.`,
        cutLabel: o.cutLabel,
        measured: wall,
        threshold: t,
        operation: lineToOp.get(o.line) ?? 0,
        parameters: o.parameters,
        pose: poseOfBox(cutBox(o, body)),
      });
    }
    if (o.op === "hole" && proc.depthRatio !== null) {
      const ratio = bodyH / o.args.dia!;
      if (ratio > proc.depthRatio) {
        findings.push({
          id: `depth-${o.cutLabel}`,
          severity: "Blocking",
          code: "hole_depth",
          message: `${o.cutLabel} is ${formatNumber(ratio, 2)}\u00d7 deeper than its diameter; ${proc.label} allows at most ${formatNumber(proc.depthRatio, 2)}\u00d7.`,
          cutLabel: o.cutLabel,
          measured: ratio,
          threshold: proc.depthRatio,
          operation: lineToOp.get(o.line) ?? 0,
          parameters: o.parameters,
          pose: poseOfBox(cutBox(o, body)),
        });
      }
    }
    earlier.push(o);
  }

  // No findings: one Pass row.
  if (findings.length === 0) {
    findings.push({
      id: "pass",
      severity: "Pass",
      code: "pass",
      message: `Every check passed for ${proc.label}.`,
      cutLabel: null,
      measured: 0,
      threshold: 0,
      operation: lineToOp.get(body.line) ?? 0,
      parameters: body.parameters,
      pose: poseOfBox({ min: [-bbox[0] / 2, -bbox[1] / 2, 0], max: [bbox[0] / 2, bbox[1] / 2, bbox[2]] }),
    });
  }

  // Order per H3: severity, shortfall desc, envelope before cuts, cut order, code, id.
  const sevRank: Record<string, number> = { Blocking: 0, Advisory: 1, Pass: 2 };
  findings.sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    const sa = shortfall(a.measured, a.threshold), sb = shortfall(b.measured, b.threshold);
    if (sa !== sb) return sb - sa;
    const envRank = (f: Finding): number => (f.code === "envelope" ? 0 : 1);
    if (envRank(a) !== envRank(b)) return envRank(a) - envRank(b);
    if (a.operation !== b.operation) return a.operation - b.operation;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  // Cost bands at 1, 10 and 100.
  const cm3 = evaluated.volume / 1000;
  const costBands: CostBand[] = [];
  for (const q of [1, 10, 100]) {
    const unit = proc.setup / q + cm3 * proc.ratePerCm3;
    const low = oneSigFig(0.8 * unit);
    const high = oneSigFig(1.25 * unit);
    costBands.push({ quantity: q, low, high, text: `$${formatNumber(low, 2, { exact: true })}\u2013$${formatNumber(high, 2, { exact: true })} each` });
  }
  const anyBlocking = findings.some((f) => f.severity === "Blocking");
  const confidence = anyBlocking ? "Low" : findings.some((f) => f.severity === "Advisory") ? "Medium" : "High";
  return { status: "complete", message: null, findings, costBands, confidence };
}

/** One significant figure, per H2. */
function oneSigFig(n: number): number {
  if (n === 0) return 0;
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const scaled = Math.abs(n) / 10 ** exp;
  const rounded = scaled >= 9.5 ? 10 : Math.round(scaled);
  const r = rounded * 10 ** exp;
  return n < 0 ? -r : r;
}

/** Wall beside a cut: the smallest distance to the body edge or another cut. */
function cutWall(cut: ResolvedOp, earlier: ResolvedOp[], body: ResolvedOp): number {
  const outer = wallToOuterResolved(cut, body);
  let min = outer;
  for (const e of earlier) {
    const w = wallBetweenResolved(cut, e);
    if (w < min) min = w;
  }
  return min;
}

function segOf(op: ResolvedOp): { ax: number; bx: number; y: number; r: number } {
  if (op.op === "hole") {
    const c = op.args.x ?? 0;
    return { ax: c, bx: c, y: op.args.y ?? 0, r: op.args.dia! / 2 };
  }
  const x = op.args.x ?? 0, len = op.args.len ?? 0;
  return { ax: Math.min(x - len / 2, x + len / 2), bx: Math.max(x - len / 2, x + len / 2), y: op.args.y ?? 0, r: op.args.w! / 2 };
}

function wallToOuterResolved(cut: ResolvedOp, body: ResolvedOp): number {
  const seg = segOf(cut);
  if (body.op === "box") {
    const w = body.args.w!, d = body.args.d!;
    const left = seg.ax + w / 2;
    const right = w / 2 - seg.bx;
    const near = Math.min(seg.y + d / 2, d / 2 - seg.y);
    return Math.min(left, right, near) - seg.r;
  }
  const R = body.args.dia! / 2;
  const far = Math.max(Math.hypot(seg.ax, seg.y), Math.hypot(seg.bx, seg.y));
  return R - far - seg.r;
}

function wallBetweenResolved(a: ResolvedOp, b: ResolvedOp): number {
  const sa = segOf(a), sb = segOf(b);
  const dx = Math.max(sa.ax - sb.bx, sb.ax - sa.bx, 0);
  const dy = Math.abs(sa.y - sb.y);
  return Math.hypot(dx, dy) - sa.r - sb.r;
}

/** The box a cut sits in, for its camera pose. */
function cutBox(cut: ResolvedOp, body: ResolvedOp): { min: [number, number, number]; max: [number, number, number] } {
  const seg = segOf(cut);
  const H = body.args.h!;
  return {
    min: [seg.ax - seg.r, seg.y - seg.r, 0],
    max: [seg.bx + seg.r, seg.y + seg.r, H],
  };
}

/** Tape operation index (0-based step index) by source line. */
export function tapeIndexByLine(parsed: ParsedSource): Map<number, number> {
  const events: { line: number; isGeom: boolean }[] = [];
  for (const p of parsed.params) events.push({ line: p.line, isGeom: false });
  for (const l of parsed.lets) events.push({ line: l.line, isGeom: false });
  const walk = (g: parsedGeom): void => {
    if (g.kind === "repeat") {
      events.push({ line: g.line, isGeom: false });
      for (const c of g.children) walk(c);
      return;
    }
    events.push({ line: g.line, isGeom: true });
  };
  walk(parsed.body);
  for (const c of parsed.cuts) walk(c);
  events.sort((a, b) => a.line - b.line);
  const map = new Map<number, number>();
  let idx = 0;
  for (const e of events) {
    idx++;
    map.set(e.line, idx);
  }
  return map;
}

type parsedGeom = import("./tine.js").GeomLine;

export { PROCESSES, CATEGORIES, evaluate, evalExpr, type ParsedSource, type Values, type Solid, type ResolvedOp };
