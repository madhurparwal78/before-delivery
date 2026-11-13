import type { Diagnostic, EvalResult, Solid, SolidOp, Values } from "../shared/records.js";
import { canonicalJson, digestOf, mm } from "../shared/canonical.js";
import { formatNumber } from "../shared/numbers.js";
import { evalExpr, exprNames, labelOfName, type Expr, type GeomLine, type ParsedSource } from "./tine.js";

/** A leaf geometry line, excluding repeat lines. */
export type LeafGeom = Exclude<GeomLine, { kind: "repeat" }>;

export interface ResolvedOp {
  op: "box" | "cylinder" | "boss" | "hole" | "slot";
  args: Record<string, number>;
  line: number;
  cutLabel: string | null;
  parameters: string[];
}

export interface ExpandContext {
  values: Values;
  derived: Record<string, number>;
}

export interface EvalOk extends EvalResult {
  ops: ResolvedOp[];
}
export interface EvalFail {
  diagnostics: Diagnostic[];
}

const MAX_MM = 10000;
const ROLE: Record<string, string> = { w: "Width", d: "Depth", h: "Height", dia: "Diameter", len: "Length" };

/** Declared defaults fill missing names; derived lets evaluate in order. */
export function resolveValues(parsed: ParsedSource, values: Values): { full: Values; derived: Record<string, number> } {
  const full: Values = {};
  for (const p of parsed.params) {
    full[p.name] = Object.prototype.hasOwnProperty.call(values, p.name) ? values[p.name]! : p.default;
  }
  const derived: Record<string, number> = {};
  for (const l of parsed.lets) derived[l.name] = evalExpr(l.expr, full, derived);
  return { full, derived };
}

interface Leaf {
  op: ResolvedOp["op"];
  args: Record<string, number>;
  line: number;
  cutLabel: string | null;
  parameters: string[];
  exprs: { key: string; e: Expr }[];
  copies: number;
  dropped: boolean;
}

/** Evaluate one leaf geometry line (repeat counts applied by the walker). */
function evalLeaf(gl: LeafGeom, ctx: ExpandContext, counters: { hole: number; slot: number; boss: number }, offsetX: number): Leaf {
  const num = (e: Expr): number => evalExpr(e, ctx.values, ctx.derived);
  const condOk = gl.cond === null ? true : ctx.values[gl.cond] === true;
  const args = (keys: string[], exprs: { key: string; e: Expr }[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of keys) out[k] = num(exprs.find((x) => x.key === k)!.e);
    if ("x" in out) out.x! += offsetX;
    return out;
  };
  if (gl.kind === "body-box") {
    const exprs = [{ key: "w", e: gl.w }, { key: "d", e: gl.d }, { key: "h", e: gl.h }];
    return { op: "box", args: args(["w", "d", "h"], exprs), line: gl.line, cutLabel: null, parameters: [...new Set([...exprNames(gl.w), ...exprNames(gl.d), ...exprNames(gl.h)])], exprs, copies: 1, dropped: !condOk };
  }
  if (gl.kind === "body-cyl") {
    const exprs = [{ key: "dia", e: gl.dia }, { key: "h", e: gl.h }];
    return { op: "cylinder", args: args(["dia", "h"], exprs), line: gl.line, cutLabel: null, parameters: [...new Set([...exprNames(gl.dia), ...exprNames(gl.h)])], exprs, copies: 1, dropped: !condOk };
  }
  if (!condOk) {
    const op = gl.kind === "boss" ? "boss" : gl.kind === "hole" ? "hole" : "slot";
    return { op, args: {}, line: gl.line, cutLabel: null, parameters: [], exprs: [], copies: 0, dropped: true };
  }
  if (gl.kind === "boss") {
    const exprs = [{ key: "dia", e: gl.dia }, { key: "h", e: gl.h }, { key: "x", e: gl.x }, { key: "y", e: gl.y }];
    counters.boss++;
    const a = args(["dia", "h", "x", "y"], exprs);
    return { op: "boss", args: a, line: gl.line, cutLabel: `Boss ${counters.boss}`, parameters: [...new Set([...exprNames(gl.dia), ...exprNames(gl.h), ...exprNames(gl.x), ...exprNames(gl.y)])], exprs, copies: 1, dropped: a.h! <= 0 };
  }
  if (gl.kind === "hole") {
    const exprs = [{ key: "dia", e: gl.dia }, { key: "x", e: gl.x }, { key: "y", e: gl.y }];
    counters.hole++;
    const a = args(["dia", "x", "y"], exprs);
    return { op: "hole", args: a, line: gl.line, cutLabel: `Hole ${counters.hole}`, parameters: [...new Set([...exprNames(gl.dia), ...exprNames(gl.x), ...exprNames(gl.y)])], exprs, copies: 1, dropped: false };
  }
  const exprs = [{ key: "w", e: gl.w }, { key: "len", e: gl.len }, { key: "x", e: gl.x }, { key: "y", e: gl.y }];
  counters.slot++;
  const a = args(["w", "len", "x", "y"], exprs);
  return { op: "slot", args: a, line: gl.line, cutLabel: `Slot ${counters.slot}`, parameters: [...new Set([...exprNames(gl.w), ...exprNames(gl.len), ...exprNames(gl.x), ...exprNames(gl.y)])], exprs, copies: 1, dropped: false };
}

/** All leaves with repeat expansion, in evaluated order. */
export function evalLeaves(parsed: ParsedSource, ctx: ExpandContext): Leaf[] {
  const counters = { hole: 0, slot: 0, boss: 0 };
  const out: Leaf[] = [];
  const num = (e: Expr): number => evalExpr(e, ctx.values, ctx.derived);
  const walk = (list: GeomLine[], factor: number, offsetX: number): void => {
    for (const g of list) {
      if (g.kind === "repeat") {
        const n = Math.max(0, Math.round(num(g.count)));
        const pitch = num(g.pitch);
        for (let i = 0; i < n; i++) walk(g.children, factor, offsetX + i * pitch);
        continue;
      }
      const leaf = evalLeaf(g, ctx, counters, offsetX);
      out.push({ ...leaf, copies: leaf.dropped || factor === 0 ? 0 : factor });
    }
  };
  const body = evalLeaf(parsed.body as LeafGeom, ctx, counters, 0);
  out.push({ ...body, copies: body.dropped ? 0 : 1 });
  walk(parsed.cuts, 1, 0);
  return out;
}

function argLabelParameter(exprs: { key: string; e: Expr }[], key: string): { label: string; parameter: string | null } {
  const entry = exprs.find((x) => x.key === key);
  const names = entry ? exprNames(entry.e) : [];
  if (names.length > 0) return { label: labelOfName(names[0]!), parameter: names[0]! };
  return { label: ROLE[key] ?? "Value", parameter: null };
}

/** Volume per the operation table; bodyHeight is the body's height. */
function opVolume(op: ResolvedOp["op"], args: Record<string, number>, bodyHeight: number): number {
  switch (op) {
    case "box": return args.w! * args.d! * args.h!;
    case "cylinder": return Math.PI * (args.dia! / 2) ** 2 * args.h!;
    case "boss": return Math.PI * (args.dia! / 2) ** 2 * args.h!;
    case "hole": return -Math.PI * (args.dia! / 2) ** 2 * bodyHeight;
    case "slot": return -((args.len! * args.w!) + Math.PI * (args.w! / 2) ** 2) * bodyHeight;
  }
}

export function opFaces(op: ResolvedOp["op"]): number {
  switch (op) {
    case "box": return 6;
    case "cylinder": return 3;
    case "boss": return 2;
    case "hole": return 1;
    case "slot": return 4;
  }
}

/** The solid's op list: body first, then cuts sorted by op name, x, y. */
function leavesToSolid(leaves: Leaf[]): ResolvedOp[] {
  const body = leaves[0]!;
  const ops: ResolvedOp[] = [{ op: body.op, args: body.args, line: body.line, cutLabel: null, parameters: body.parameters }];
  const cuts = leaves.slice(1).filter((l) => !l.dropped && l.copies > 0);
  cuts.sort((a, b) => {
    if (a.op !== b.op) return a.op < b.op ? -1 : 1;
    if ((a.args.x ?? 0) !== (b.args.x ?? 0)) return (a.args.x ?? 0) - (b.args.x ?? 0);
    return (a.args.y ?? 0) - (b.args.y ?? 0);
  });
  for (const c of cuts) ops.push({ op: c.op, args: c.args, line: c.line, cutLabel: c.cutLabel, parameters: c.parameters });
  return ops;
}

/** Bounding box of the solid: the body's, with z grown by bosses. */
function solidBbox(leaves: Leaf[]): [number, number, number] {
  const body = leaves[0]!;
  const bw = body.op === "box" ? body.args.w! : body.args.dia!;
  const bd = body.op === "box" ? body.args.d! : body.args.dia!;
  let bh = body.args.h!;
  for (const l of leaves.slice(1)) {
    if (!l.dropped && l.copies > 0 && l.op === "boss") bh = Math.max(bh, body.args.h! + l.args.h!);
  }
  return [bw, bd, bh];
}

/** Centre segment and radius of a cut, for wall maths. */
function segmentOf(op: ResolvedOp["op"], args: Record<string, number>): { ax: number; bx: number; y: number; r: number } {
  if (op === "hole") {
    const c = args.x ?? 0;
    return { ax: c, bx: c, y: args.y ?? 0, r: args.dia! / 2 };
  }
  const x = args.x ?? 0, len = args.len ?? 0;
  const lo = Math.min(x - len / 2, x + len / 2);
  const hi = Math.max(x - len / 2, x + len / 2);
  return { ax: lo, bx: hi, y: args.y ?? 0, r: args.w! / 2 };
}

/** Distance between two centre segments. */
function segmentDistance(a: { ax: number; bx: number; y: number; r: number }, b: { ax: number; bx: number; y: number; r: number }): number {
  const dx = Math.max(a.ax - b.bx, b.ax - a.bx, 0);
  const dy = Math.abs(a.y - b.y);
  return Math.hypot(dx, dy);
}

/** Wall from a cut to the body's outer edge. */
function wallToOuter(op: ResolvedOp["op"], args: Record<string, number>, body: ResolvedOp): number {
  const seg = segmentOf(op, args);
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

/** Wall between two cuts. */
function wallBetween(a: ResolvedOp, b: ResolvedOp): number {
  const sa = segmentOf(a.op, a.args), sb = segmentOf(b.op, b.args);
  return segmentDistance(sa, sb) - sa.r - sb.r;
}

/** Evaluate a parsed source at values. Diagnostics stop at the first failing check. */
export function evaluate(parsed: ParsedSource, values: Values, timeoutMs: number, isCancelled: () => boolean = () => false): { ok: EvalOk } | { fail: EvalFail } {
  const startedAt = Date.now();
  const timedOut = (): boolean => isCancelled() || Date.now() - startedAt > timeoutMs;
  const fail = (code: string, message: string, parameter: string | null): { fail: EvalFail } => ({ fail: { diagnostics: [{ code, message, parameter }] } });

  const { full, derived } = resolveValues(parsed, values);
  const ctx: ExpandContext = { values: full, derived };

  // 1. Too large: length parameter values in declaration order.
  for (const p of parsed.params) {
    if (p.kind !== "length") continue;
    const v = full[p.name];
    if (typeof v === "number" && v > MAX_MM) {
      return fail("E_TOO_LARGE", `${labelOfName(p.name)} is ${formatNumber(v, 2)}\u202Fmm; Tine allows at most 10\u2009000\u202Fmm.`, p.name);
    }
  }
  if (timedOut()) return fail("E_TIMEOUT", `Evaluation stopped after ${formatNumber(timeoutMs / 1000, 2)} s.`, null);

  const leaves = evalLeaves(parsed, ctx);

  // 1 (continued). Resolved size, diameter, width and length arguments in evaluated order.
  for (const l of leaves) {
    if (l.dropped || l.copies === 0) continue;
    const keys: string[] = l.op === "box" ? ["w", "d", "h"] : l.op === "cylinder" ? ["dia", "h"] : l.op === "boss" ? ["dia", "h"] : l.op === "hole" ? ["dia"] : ["w", "len"];
    for (const k of keys) {
      const v = l.args[k]!;
      if (v > MAX_MM) {
        const { label, parameter } = argLabelParameter(l.exprs, k);
        return fail("E_TOO_LARGE", `${label} is ${formatNumber(v, 2)}\u202Fmm; Tine allows at most 10\u2009000\u202Fmm.`, parameter);
      }
    }
  }
  // 2. Not positive: body sizes, diameters and slot widths in evaluated order.
  for (const l of leaves) {
    if (l.dropped || l.copies === 0) continue;
    const keys: string[] = l.op === "box" ? ["w", "d", "h"] : l.op === "cylinder" ? ["dia", "h"] : l.op === "boss" ? ["dia"] : l.op === "hole" ? ["dia"] : ["w"];
    for (const k of keys) {
      if (l.args[k]! <= 0) {
        const { label, parameter } = argLabelParameter(l.exprs, k);
        return fail("E_NONPOSITIVE", `${label} must be greater than 0\u202Fmm.`, parameter);
      }
    }
  }
  if (timedOut()) return fail("E_TIMEOUT", `Evaluation stopped after ${formatNumber(timeoutMs / 1000, 2)} s.`, null);

  // 3. Operation count: body plus every copy of every cut and join, drops excluded.
  const opCount = 1 + leaves.slice(1).reduce((s, l) => s + (l.dropped ? 0 : l.copies), 0);
  if (opCount > 256) {
    return fail("E_TOO_MANY_OPERATIONS", `Part has ${formatNumber(opCount, 0, { exact: true })} operations after repeats; Tine allows at most 256.`, null);
  }

  // 4. Each cut or join in evaluated order: outside, then overlap with an earlier one.
  const ops = leavesToSolid(leaves);
  const bodyOp = ops[0]!;
  const earlier: ResolvedOp[] = [];
  for (let i = 1; i < ops.length; i++) {
    const o = ops[i]!;
    const outer = wallToOuter(o.op, o.args, bodyOp);
    if (outer <= 0) {
      const w = bodyOp.op === "box" ? bodyOp.args.w! : bodyOp.args.dia!;
      const d = bodyOp.op === "box" ? bodyOp.args.d! : bodyOp.args.dia!;
      const size = o.op === "hole" ? o.args.dia! : o.op === "slot" ? o.args.w! : o.args.dia!;
      return fail("E_CUT_OUTSIDE", `${o.cutLabel} (\u00d8 ${formatNumber(size, 2)} mm) does not fit inside the ${formatNumber(w, 2)} \u00d7 ${formatNumber(d, 2)} mm body.`, null);
    }
    for (const e of earlier) {
      if (wallBetween(o, e) <= 0) {
        return fail("E_CUT_OVERLAP", `${o.cutLabel} overlaps ${e.cutLabel}.`, null);
      }
    }
    earlier.push(o);
    if (timedOut()) return fail("E_TIMEOUT", `Evaluation stopped after ${formatNumber(timeoutMs / 1000, 2)} s.`, null);
  }

  const solidOps: SolidOp[] = ops.map((o) => {
    const e: Record<string, unknown> = { op: o.op };
    for (const k of Object.keys(o.args)) e[k] = mm(o.args[k]!);
    return e as SolidOp;
  });
  const solid: Solid = { ops: solidOps };
  const digest = digestOf(canonicalJson(solid));
  const H = bodyOp.args.h!;
  let volume = 0;
  for (const o of ops) volume += opVolume(o.op, o.args, H);
  const bbox = solidBbox(leaves);
  let faces = 0;
  for (const o of ops) faces += opFaces(o.op);
  return {
    ok: {
      solid, digest, ops,
      volume: mm(volume),
      bbox: [mm(bbox[0]), mm(bbox[1]), mm(bbox[2])],
      faces,
    },
  };
}
