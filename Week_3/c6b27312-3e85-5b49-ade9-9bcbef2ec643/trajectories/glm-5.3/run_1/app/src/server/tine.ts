import type { Values } from "../shared/records.js";
import type { TapeOperation } from "../shared/records.js";

export interface ParsedParam {
  name: string;
  kind: "length" | "angle" | "count" | "boolean" | "enum";
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  declaredStep?: string;
  options?: string[];
  group: string;
  order: number;
  line: number;
}

export interface ParsedLet {
  name: string;
  expr: Expr;
  group: string;
  order: number;
  line: number;
}

export type Expr =
  | { t: "num"; v: number }
  | { t: "name"; name: string }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr }
  | { t: "neg"; a: Expr }
  | { t: "pick"; name: string; pairs: { option: string; value: number }[] };

export type GeomLine =
  | { kind: "body-box"; w: Expr; d: Expr; h: Expr; line: number; cond: string | null }
  | { kind: "body-cyl"; dia: Expr; h: Expr; line: number; cond: string | null }
  | { kind: "boss"; dia: Expr; h: Expr; x: Expr; y: Expr; line: number; cond: string | null }
  | { kind: "hole"; dia: Expr; x: Expr; y: Expr; line: number; cond: string | null }
  | { kind: "slot"; w: Expr; len: Expr; x: Expr; y: Expr; line: number; cond: string | null }
  | { kind: "repeat"; count: Expr; pitch: Expr; children: GeomLine[]; line: number };

export interface ParsedSource {
  params: ParsedParam[];
  lets: ParsedLet[];
  body: GeomLine;
  cuts: GeomLine[];
  lineCount: number;
}

export function labelOfName(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2");
  const parts = spaced.split(" ").filter(Boolean).join(" ");
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

const IDENT = /^[A-Za-z][A-Za-z0-9_]*/;
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?/;
export const NUMBER_IN_TEXT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/;

/** Parse an expression string (no spaces) into an Expr, or null. */
export function parseExpr(s: string): Expr | null {
  let i = 0;
  const peek = (): string => s[i] ?? "";
  const take = (re: RegExp): string | null => {
    const m = re.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  function primary(): Expr | null {
    if (peek() === "(") {
      i++;
      const e = add();
      if (!e || peek() !== ")") return null;
      i++;
      return e;
    }
    if (peek() === "-") {
      i++;
      const e = primary();
      return e ? { t: "neg", a: e } : null;
    }
    const p = /^pick\(([A-Za-z][A-Za-z0-9]*),([^)]*)\)/.exec(s.slice(i));
    if (p) {
      const inner = p[2]!.trim();
      const pairs = inner.split(",").map((kv) => {
        const idx = kv.indexOf(":");
        return { option: kv.slice(0, idx).trim(), value: Number(kv.slice(idx + 1)) };
      });
      if (pairs.some((x) => x.option === "" || !Number.isFinite(x.value))) return null;
      i += p[0].length;
      return { t: "pick", name: p[1]!, pairs };
    }
    const n = take(NUMBER);
    if (n !== null) return { t: "num", v: Number(n) };
    const id = take(IDENT);
    if (id !== null) return { t: "name", name: id };
    return null;
  }
  function mul(): Expr | null {
    let a = primary();
    if (!a) return null;
    for (;;) {
      const c = peek();
      if (c === "*" || c === "/") {
        i++;
        const b = primary();
        if (!b) return null;
        a = { t: "bin", op: c, a, b };
      } else return a;
    }
  }
  function add(): Expr | null {
    let a = mul();
    if (!a) return null;
    for (;;) {
      const c = peek();
      if (c === "+" || c === "-") {
        i++;
        const b = mul();
        if (!b) return null;
        a = { t: "bin", op: c, a, b };
      } else return a;
    }
  }
  const e = add();
  return e && i === s.length ? e : null;
}

/** Evaluate an expression at values, with derived lets already resolved. */
export function evalExpr(e: Expr, values: Values, derived: Record<string, number>): number {
  switch (e.t) {
    case "num": return e.v;
    case "name": {
      if (e.name in derived) return derived[e.name]!;
      const v = values[e.name];
      return typeof v === "number" ? v : NaN;
    }
    case "neg": return -evalExpr(e.a, values, derived);
    case "bin": {
      const a = evalExpr(e.a, values, derived);
      const b = evalExpr(e.b, values, derived);
      switch (e.op) {
        case "+": return a + b;
        case "*": return a * b;
        case "-": return a - b;
        case "/": return a / b;
      }
    }
    case "pick": {
      const v = values[e.name];
      const pair = e.pairs.find((p) => p.option === v);
      return pair ? pair.value : NaN;
    }
  }
}

/** Parameter names an expression reads, in order of first mention. */
export function exprNames(e: Expr): string[] {
  switch (e.t) {
    case "num": return [];
    case "name": return [e.name];
    case "neg": return exprNames(e.a);
    case "bin": return [...exprNames(e.a), ...exprNames(e.b)];
    case "pick": return [e.name, ...e.pairs.flatMap(() => [])];
  }
}


export function parseSource(source: string): { parsed: ParsedSource } | { error: { line: number; reason: string } } {
  const lines = source.split("\n");
  if (Buffer.byteLength(source, "utf8") > 20000) {
    return { error: { line: 1, reason: "Source is over 20\u2009000 bytes." } };
  }
  const params: ParsedParam[] = [];
  const lets: ParsedLet[] = [];
  const cuts: GeomLine[] = [];
  let body: GeomLine | null = null;
  let group = "Dimensions";
  let order = 0;
  const stack: { line: number; count: Expr; pitch: Expr; children: GeomLine[] }[] = [];

  for (let ln = 0; ln < lines.length; ln++) {
    const text = lines[ln]!.trim();
    const line = ln + 1;
    if (text === "" || text.startsWith("#")) continue;
    if (text === "}") {
      const open = stack.pop();
      if (!open) return { error: { line, reason: "Unmatched closing brace." } };
      const repeat: GeomLine = { kind: "repeat", count: open.count, pitch: open.pitch, children: open.children, line: open.line };
      if (stack.length === 0) {
        if (!body) return { error: { line, reason: "The body must come before a repeat block." } };
        cuts.push(repeat);
      } else {
        return { error: { line, reason: "Repeat blocks cannot nest." } };
      }
      continue;
    }
    if (text.endsWith("{")) {
      const tail = text.slice(0, -1).trim();
      const m = /^repeat\s+(\S+)\s+(\S+)$/.exec(tail);
      if (!m) return { error: { line, reason: "A repeat line needs a count and a pitch." } };
      const count = /^\d/.test(m[1]!) ? { t: "num" as const, v: Number(m[1]) } : parseExpr(m[1]!);
      const pitch = parseExpr(m[2]!);
      if (!count || !pitch) return { error: { line, reason: "A repeat line needs a count and a pitch." } };
      if (stack.length > 0) return { error: { line, reason: "Repeat blocks cannot nest." } };
      stack.push({ line, count, pitch, children: [] });
      continue;
    }
    const sec = /^section\s+"([^"]*)"$/.exec(text);
    if (sec) { group = sec[1]!; continue; }

    if (text.startsWith("param ")) {
      const rest = text.slice(6);
      const eq = rest.indexOf("=");
      if (eq === -1) return { error: { line, reason: "A param line needs a name and a value." } };
      const name = rest.slice(0, eq).trim();
      const after = rest.slice(eq + 1).trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return { error: { line, reason: "A param name starts with a letter." } };
      if (after === "true" || after === "false") {
        params.push({ name, kind: "boolean", default: after === "true", group, order: order++, line });
        continue;
      }
      const em = /^([A-Za-z][A-Za-z0-9_]*)\s+options\s+([A-Za-z0-9]+(?:,\s*[A-Za-z0-9]+)*)$/.exec(after);
      if (em) {
        params.push({ name, kind: "enum", default: em[1]!, options: em[2]!.split(",").map((o) => o.trim()), group, order: order++, line });
        continue;
      }
      const um = /^(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?)\s*(mm|deg|count)(?:\s+(.*))?$/.exec(after);
      if (!um) return { error: { line, reason: "A param needs a value in mm, deg or count." } };
      const v = Number(um[1]!);
      const kind = um[2] === "mm" ? "length" : um[2] === "deg" ? "angle" : "count";
      let min: number | undefined, max: number | undefined, step: number | undefined, declaredStep: string | undefined;
      const tailC = (um[3] ?? "").trim();
      if (tailC) {
        const cm = /^(?:min\s+(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?))?\s*(?:max\s+(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?))?\s*(?:step\s+(-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?))?$/.exec(tailC);
        if (!cm || (!cm[1] && !cm[2] && !cm[3])) return { error: { line, reason: "A param's limits are min, max and step." } };
        if (cm[1] !== undefined) min = Number(cm[1]);
        if (cm[2] !== undefined) max = Number(cm[2]);
        if (cm[3] !== undefined) { step = Number(cm[3]); declaredStep = cm[3]; }
      }
      params.push({ name, kind, default: kind === "count" ? Math.round(v) : v, min, max, step, declaredStep, group, order: order++, line });
      continue;
    }

    if (text.startsWith("let ")) {
      const rest = text.slice(4);
      const eq = rest.indexOf("=");
      if (eq === -1) return { error: { line, reason: "A let line needs a name and an expression." } };
      const name = rest.slice(0, eq).trim();
      const expr = parseExpr(rest.slice(eq + 1).trim());
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !expr) return { error: { line, reason: "A let line needs a name and an expression." } };
      lets.push({ name, expr, group, order: order++, line });
      continue;
    }

    const condM = /^(.*?)(?:\s+if\s+([A-Za-z][A-Za-z0-9_]*))?$/.exec(text)!;
    const geomText = condM[1]!.trim();
    const cond = condM[2] ?? null;
    // Cut and join lines carry an `at` before their position: `hole 5 at -20 0`.
    const atM = /^(\S+)\s+(.*?)\s+at\s+(\S+)\s+(\S+)$/.exec(geomText);
    const noAtM = /^(\S+)\s+(.*)$/.exec(geomText);
    let verb: string, args: string[];
    if (atM && (atM[1] === "hole" || atM[1] === "boss" || atM[1] === "slot")) {
      verb = atM[1]!;
      args = [...atM[2]!.split(/\s+/).filter(Boolean), atM[3]!, atM[4]!];
    } else if (noAtM) {
      verb = noAtM[1]!;
      args = noAtM[2]!.length === 0 ? [] : noAtM[2]!.split(/\s+/);
    } else {
      return { error: { line, reason: "This line does not parse." } };
    }
    const exprs = args.map((p) => parseExpr(p));
    if (exprs.some((e) => !e)) {
      return { error: { line, reason: `The ${verb} line does not parse.` } };
    }
    const E = exprs as Expr[];
    if (verb === "box" || verb === "cylinder") {
      if (body) return { error: { line, reason: "Only one body operation is allowed." } };
      if (stack.length > 0) return { error: { line, reason: "The body must come before a repeat block." } };
      if (verb === "box" && E.length !== 3) return { error: { line, reason: "A box takes width, depth and height." } };
      if (verb === "cylinder" && E.length !== 2) return { error: { line, reason: "A cylinder takes a diameter and a height." } };
      body = verb === "box"
        ? { kind: "body-box", w: E[0]!, d: E[1]!, h: E[2]!, line, cond }
        : { kind: "body-cyl", dia: E[0]!, h: E[1]!, line, cond };
      continue;
    }
    let gl: GeomLine | null = null;
    if (verb === "boss" && E.length === 4) gl = { kind: "boss", dia: E[0]!, h: E[1]!, x: E[2]!, y: E[3]!, line, cond };
    else if (verb === "hole" && E.length === 3) gl = { kind: "hole", dia: E[0]!, x: E[1]!, y: E[2]!, line, cond };
    else if (verb === "slot" && E.length === 4) gl = { kind: "slot", w: E[0]!, len: E[1]!, x: E[2]!, y: E[3]!, line, cond };
    if (!gl) {
      return { error: { line, reason: `The ${verb} line does not parse.` } };
    }
    if (!body) return { error: { line, reason: "The body must come first." } };
    if (stack.length === 0) cuts.push(gl);
    else stack[stack.length - 1]!.children.push(gl);
  }
  if (stack.length > 0) return { error: { line: stack[stack.length - 1]!.line, reason: "A repeat block is missing its closing brace." } };
  if (!body) return { error: { line: Math.max(1, lines.length), reason: "The source has no body operation." } };
  if (params.length > 40) return { error: { line: 1, reason: "A part can have at most 40 parameters." } };
  return { parsed: { params, lets, body, cuts, lineCount: lines.length } };
}

/** Number of tape operations after operation 0. */
export function tapeOpCount(parsed: ParsedSource): number {
  let n = parsed.params.length + parsed.lets.length;
  for (const c of parsed.cuts) n += geomLineCount(c);
  return n;
}

function geomLineCount(g: GeomLine): number {
  if (g.kind === "repeat") return 1 + g.children.reduce((s, c) => s + geomLineCount(c), 0);
  return 1;
}

/** One tape step before evaluation: its identity and source line. */
export interface TapeStep {
  kind: TapeOperation["kind"];
  op: string;
  line: number | null;
  /** The partial source up to and including this step, for evaluation. */
  sourceUpTo: string;
}

/**
 * The tape in source order. Operation 0 is the start; then one entry per
 * param/let/repeat/geometry line (comments, blank lines, section and `}` excluded).
 * Each step's partial source closes any open repeat block, so the enclosed
 * operation's evaluation adds all its copies at once.
 */
export function tapeSteps(source: string, parsed: ParsedSource): TapeStep[] {
  const lines = source.split("\n");
  const steps: TapeStep[] = [{ kind: "start", op: "empty", line: null, sourceUpTo: "" }];
  const add = (line: number, kind: TapeStep["kind"], op: string): void => {
    const head = lines.slice(0, line);
    // Close any repeat block left open at this line.
    let open = 0;
    for (const l of head) {
      const t = l.trim();
      if (t.endsWith("{")) open++;
      else if (t === "}") open--;
    }
    const sourceUpTo = open > 0 ? [...head, ...Array.from({ length: open }, () => "}")].join("\n") : head.join("\n");
    steps.push({ kind, op, line, sourceUpTo });
  };
  // Statements in source order: params/lets interleaved with body/cuts/repeat.
  const events: { line: number; run: () => void }[] = [];
  for (const p of parsed.params) events.push({ line: p.line, run: () => add(p.line, "params", `param ${p.name}`) });
  for (const l of parsed.lets) events.push({ line: l.line, run: () => add(l.line, "params", `let ${l.name}`) });
  const walk = (g: GeomLine): void => {
    if (g.kind === "repeat") {
      events.push({ line: g.line, run: () => add(g.line, "params", "repeat") });
      for (const c of g.children) walk(c);
      return;
    }
    const op = g.kind === "body-box" ? "box" : g.kind === "body-cyl" ? "cylinder" : g.kind === "boss" ? "boss" : g.kind === "hole" ? "hole" : "slot";
    const kind = g.kind === "body-box" || g.kind === "body-cyl" ? "body" : g.kind === "boss" ? "join" : "cut";
    events.push({ line: g.line, run: () => add(g.line, kind, op) });
  };
  walk(parsed.body);
  for (const c of parsed.cuts) walk(c);
  events.sort((a, b) => a.line - b.line);
  for (const e of events) e.run();
  return steps;
}
