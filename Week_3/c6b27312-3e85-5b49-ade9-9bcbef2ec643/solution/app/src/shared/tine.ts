// The Tine language: parser, evaluator, diagnostics, manifest, solids and camera poses.
// Every domain rule of the part language is decided here, once, for the server and the browser.
import { NNBSP, display, parseDecimal, roundHalfEven, trimmed } from "./numbers";
import { compareText } from "./order";
import { labelOf } from "./text";

export type Value = number | boolean | string;
export type Values = Record<string, Value>;
export type Kind = "length" | "angle" | "count" | "boolean" | "enum";

const MAX_LENGTH = 10000;
const MAX_OPERATIONS = 256;
const MAX_SOURCE_BYTES = 20000;
const MAX_PARAMETERS = 40;
const MAX_TAPE_OPERATIONS = 64;

// ---------------------------------------------------------------------------------------------- expressions

type Expr =
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "neg"; a: Expr }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: Expr; b: Expr }
  | { t: "pick"; name: string; options: [string, number][] };

class Fail extends Error {}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Numbers as a Tine source writes them (any number of decimals). Numbers entering through the API follow the plain-decimal grammar in numbers.ts. */
const NUMBER = /^-?\d+(\.\d+)?$/;

function parseExpr(text: string, known: Map<string, Decl>): Expr {
  let i = 0;
  const peek = () => text[i];
  const ident = (): string => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (!m) throw new Fail(`Expected a name in "${text}".`);
    i += m[0].length;
    return m[0];
  };
  const sum = (): Expr => {
    let a = product();
    while (peek() === "+" || peek() === "-") {
      const op = text[i++] as "+" | "-";
      a = { t: "bin", op, a, b: product() };
    }
    return a;
  };
  const product = (): Expr => {
    let a = unary();
    while (peek() === "*" || peek() === "/") {
      const op = text[i++] as "*" | "/";
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr => {
    if (peek() === "-") {
      i += 1;
      return { t: "neg", a: unary() };
    }
    return primary();
  };
  const primary = (): Expr => {
    const c = peek();
    if (c === "(") {
      i += 1;
      const inner = sum();
      if (peek() !== ")") throw new Fail(`Missing ")" in "${text}".`);
      i += 1;
      return inner;
    }
    const num = /^\d+(\.\d+)?/.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      return { t: "num", v: Number(num[0]) };
    }
    if (c === undefined || !/[A-Za-z_]/.test(c)) throw new Fail(`Unexpected "${c ?? "end of line"}" in "${text}".`);
    const name = ident();
    if (name === "pick" && peek() === "(") {
      i += 1;
      const target = ident();
      const decl = known.get(target);
      if (!decl || decl.kind !== "enum") throw new Fail(`pick needs an enum parameter, not "${target}".`);
      const options: [string, number][] = [];
      while (peek() === ",") {
        i += 1;
        const option = ident();
        if (peek() !== ":") throw new Fail(`pick option "${option}" needs a value after ":".`);
        i += 1;
        const m = /^-?\d+(\.\d+)?/.exec(text.slice(i));
        if (!m) throw new Fail(`pick option "${option}" needs a number.`);
        i += m[0].length;
        if (!decl.options?.includes(option)) throw new Fail(`"${option}" is not an option of ${target}.`);
        options.push([option, Number(m[0])]);
      }
      if (peek() !== ")" || options.length === 0) throw new Fail(`Malformed pick in "${text}".`);
      i += 1;
      return { t: "pick", name: target, options };
    }
    const decl = known.get(name);
    if (!decl) throw new Fail(`Unknown name "${name}".`);
    if (decl.kind === "enum" || decl.kind === "boolean") throw new Fail(`"${name}" cannot be used in a number expression.`);
    return { t: "ref", name };
  };
  const result = sum();
  if (i !== text.length) throw new Fail(`Unexpected "${text[i]}" in "${text}".`);
  return result;
}

function exprValue(e: Expr, env: Map<string, Value>): number {
  switch (e.t) {
    case "num":
      return e.v;
    case "ref":
      return env.get(e.name) as number;
    case "neg":
      return -exprValue(e.a, env);
    case "bin": {
      const a = exprValue(e.a, env);
      const b = exprValue(e.b, env);
      return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : a / b;
    }
    case "pick": {
      const word = env.get(e.name);
      const found = e.options.find(([option]) => option === word);
      return found ? found[1] : Number.NaN;
    }
  }
}

/** Names an expression mentions, left to right. */
function exprRefs(e: Expr, out: string[] = []): string[] {
  if (e.t === "ref") out.push(e.name);
  else if (e.t === "pick") out.push(e.name);
  else if (e.t === "neg") exprRefs(e.a, out);
  else if (e.t === "bin") {
    exprRefs(e.a, out);
    exprRefs(e.b, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- the model

interface ParamDecl {
  name: string;
  kind: Kind;
  unit: "mm" | "°" | null;
  default: Value;
  min?: number;
  max?: number;
  step?: number;
  precision: number;
  options?: string[];
  group: string;
  derived: false;
  order: number;
  line: number;
}

interface LetDecl {
  name: string;
  kind: "length";
  unit: "mm";
  expr: Expr;
  group: string;
  derived: true;
  order: number;
  line: number;
}

type Decl = ParamDecl | LetDecl;

type GeometryVerb = "box" | "cylinder" | "boss" | "hole" | "slot";

interface Repeat {
  count: Expr;
  pitch: Expr;
  line: number;
}

interface Geometry {
  verb: GeometryVerb;
  args: Expr[];
  at: [Expr, Expr] | null;
  condition: string | null;
  repeat: Repeat | null;
  line: number;
  opIndex: number;
}

export interface TapeStep {
  index: number;
  kind: "start" | "params" | "body" | "cut" | "join";
  op: string;
  line: number | null;
}

export interface Model {
  lines: string[];
  decls: Decl[];
  geometry: Geometry[];
  tape: TapeStep[];
  bodyIndex: number;
  /** Lines (1-based) that open or sit inside each repeat block, keyed by operation index. */
  blockOf: Map<number, number>;
}

type Parsed = { ok: true; model: Model } | { ok: false; line: number; reason: string };

const ARG_ROLES: Record<GeometryVerb, string[]> = {
  box: ["Width", "Depth", "Height"],
  cylinder: ["Diameter", "Height"],
  boss: ["Diameter", "Height"],
  hole: ["Diameter"],
  slot: ["Width", "Length"],
};

function stepPrecision(token: string): number {
  const dot = token.indexOf(".");
  return dot < 0 ? 0 : token.length - dot - 1;
}

function derivedStep(value: number): { step: number; precision: number } {
  const magnitude = Math.floor(Math.log10(Math.abs(value === 0 ? 1 : value)));
  return { step: Number(`1e${magnitude - 2}`), precision: Math.max(0, 2 - magnitude) };
}

export function parseTine(source: string): Parsed {
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > MAX_SOURCE_BYTES) return { ok: false, line: 1, reason: `Source is ${bytes} bytes; Tine allows at most ${MAX_SOURCE_BYTES}.` };
  const lines = source.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const decls: Decl[] = [];
  const known = new Map<string, Decl>();
  const geometry: Geometry[] = [];
  const tape: TapeStep[] = [{ index: 0, kind: "start", op: "empty", line: null }];
  const blockOf = new Map<number, number>();
  let group = "Dimensions";
  let body = -1;
  let repeat: Repeat | null = null;
  let params = 0;
  let n = 0;

  const addStep = (kind: TapeStep["kind"], op: string, line: number): number => {
    const index = tape.length;
    tape.push({ index, kind, op, line });
    return index;
  };

  try {
    for (let k = 0; k < lines.length; k++) {
      n = k + 1;
      const text = (lines[k] as string).replace(/\r$/, "").trim();
      if (text === "" || text.startsWith("#")) continue;
      const word = text.split(/\s+/)[0] as string;
      if (word === "section") {
        const m = /^section\s+"([^"]+)"$/.exec(text);
        if (!m) throw new Fail('A section reads: section "Title".');
        group = m[1] as string;
      } else if (word === "param") {
        if (repeat) throw new Fail("Parameters cannot sit inside a repeat block.");
        params += 1;
        if (params > MAX_PARAMETERS) throw new Fail(`Tine allows at most ${MAX_PARAMETERS} parameters.`);
        const decl = parseParam(text, group, decls.length, n);
        if (known.has(decl.name)) throw new Fail(`"${decl.name}" is already declared.`);
        decls.push(decl);
        known.set(decl.name, decl);
        addStep("params", `param ${decl.name}`, n);
      } else if (word === "let") {
        if (repeat) throw new Fail("Lets cannot sit inside a repeat block.");
        const m = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)$/.exec(text);
        if (!m) throw new Fail("A let reads: let name = expression (no spaces in the expression).");
        const name = m[1] as string;
        if (known.has(name)) throw new Fail(`"${name}" is already declared.`);
        const decl: LetDecl = { name, kind: "length", unit: "mm", expr: parseExpr(m[2] as string, known), group, derived: true, order: decls.length, line: n };
        decls.push(decl);
        known.set(name, decl);
        addStep("params", `let ${name}`, n);
      } else if (word === "repeat") {
        if (repeat) throw new Fail("Repeat blocks cannot be nested.");
        if (body < 0) throw new Fail("A repeat comes after the body operation.");
        const m = /^repeat\s+(\S+)\s+(\S+)\s*\{$/.exec(text);
        if (!m) throw new Fail("A repeat reads: repeat count pitch {");
        repeat = { count: parseExpr(m[1] as string, known), pitch: parseExpr(m[2] as string, known), line: n };
        addStep("params", "repeat", n);
      } else if (text === "}") {
        if (!repeat) throw new Fail('Unexpected "}".');
        repeat = null;
      } else if (word === "box" || word === "cylinder" || word === "boss" || word === "hole" || word === "slot") {
        const verb: GeometryVerb = word;
        const isBody = verb === "box" || verb === "cylinder";
        if (isBody && body >= 0) throw new Fail("Tine allows one body operation.");
        if (!isBody && body < 0) throw new Fail("The body operation (box or cylinder) must come first.");
        if (isBody && repeat) throw new Fail("The body cannot sit inside a repeat block.");
        const statement = parseGeometry(verb, text, known, repeat, n);
        statement.opIndex = addStep(isBody ? "body" : verb === "boss" ? "join" : "cut", verb, n);
        if (isBody) body = statement.opIndex;
        if (repeat) blockOf.set(statement.opIndex, repeat.line);
        geometry.push(statement);
      } else {
        throw new Fail(`Unknown statement "${word}".`);
      }
      if (tape.length - 1 > MAX_TAPE_OPERATIONS) throw new Fail(`The build tape has more than ${MAX_TAPE_OPERATIONS} operations.`);
    }
    n = lines.length || 1;
    if (repeat) throw new Fail("A repeat block is not closed with }.");
    if (body < 0) throw new Fail("The part has no body operation (box or cylinder).");
  } catch (error) {
    if (error instanceof Fail) return { ok: false, line: n, reason: error.message };
    throw error;
  }
  return { ok: true, model: { lines, decls, geometry, tape, bodyIndex: body, blockOf } };
}

function parseParam(text: string, group: string, order: number, line: number): ParamDecl {
  const tokens = text.split(/\s+/);
  const name = tokens[1] ?? "";
  if (!IDENT.test(name) || tokens[2] !== "=" || tokens[3] === undefined) throw new Fail("A param reads: param name = value unit.");
  const raw = tokens[3];
  const base = { name, group, derived: false as const, order, line };
  if ((raw === "true" || raw === "false") && tokens.length === 4) {
    return { ...base, kind: "boolean", unit: null, default: raw === "true", precision: 0 };
  }
  if (tokens[4] === "options") {
    const options = tokens.slice(5).join(" ").split(",").map((o) => o.trim());
    if (options.length === 0 || options.some((o) => !IDENT.test(o))) throw new Fail("Enum options are words separated by commas.");
    if (!options.includes(raw)) throw new Fail(`"${raw}" is not one of the options.`);
    return { ...base, kind: "enum", unit: null, default: raw, precision: 0, options };
  }
  if (!NUMBER.test(raw)) throw new Fail(`"${raw}" is not a number.`);
  const unitWord = tokens[4];
  if (unitWord !== "mm" && unitWord !== "deg" && unitWord !== "count") throw new Fail("A numeric param ends its value with mm, deg or count.");
  const value = Number(raw);
  const limits: { min?: number; max?: number; step?: number } = {};
  let stepToken = "";
  for (let i = 5; i < tokens.length; i += 2) {
    const key = tokens[i];
    const number = tokens[i + 1];
    if ((key !== "min" && key !== "max" && key !== "step") || number === undefined || !NUMBER.test(number)) {
      throw new Fail("Limits read: min n, max n, step n.");
    }
    if (key === "step") stepToken = number;
    limits[key] = Number(number);
  }
  if (unitWord === "count") {
    if (!Number.isInteger(value) || "step" in limits) throw new Fail("A count is a whole number with no step.");
    return { ...base, kind: "count", unit: null, default: value, precision: 0, step: 1, ...pick(limits, "min", "max") };
  }
  const derived = limits.step === undefined ? derivedStep(value) : { step: limits.step, precision: stepPrecision(stepToken) };
  return {
    ...base,
    kind: unitWord === "mm" ? "length" : "angle",
    unit: unitWord === "mm" ? "mm" : "°",
    default: value,
    ...derived,
    ...pick(limits, "min", "max"),
  };
}

function pick(limits: { min?: number; max?: number }, ...keys: ("min" | "max")[]): { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {};
  for (const key of keys) if (limits[key] !== undefined) out[key] = limits[key];
  return out;
}

function parseGeometry(verb: GeometryVerb, text: string, known: Map<string, Decl>, repeat: Repeat | null, line: number): Geometry {
  const tokens = text.split(/\s+/);
  let condition: string | null = null;
  if (tokens.length >= 3 && tokens[tokens.length - 2] === "if") {
    condition = tokens[tokens.length - 1] as string;
    tokens.length -= 2;
    const decl = known.get(condition);
    if (!decl || decl.kind !== "boolean") throw new Fail(`"if" needs a boolean parameter, not "${condition}".`);
    if (verb === "box" || verb === "cylinder") throw new Fail("The body cannot be conditional.");
  }
  const roles = ARG_ROLES[verb];
  const placed = verb === "boss" || verb === "hole" || verb === "slot";
  const expected = 1 + roles.length + (placed ? 3 : 0);
  if (tokens.length !== expected || (placed && tokens[1 + roles.length] !== "at")) {
    throw new Fail(`${verb} reads: ${verb} ${roles.map((r) => r.toLowerCase()).join(" ")}${placed ? " at x y" : ""}.`);
  }
  const args = roles.map((_, i) => parseExpr(tokens[1 + i] as string, known));
  const at: [Expr, Expr] | null = placed
    ? [parseExpr(tokens[2 + roles.length] as string, known), parseExpr(tokens[3 + roles.length] as string, known)]
    : null;
  return { verb, args, at, condition, repeat, line, opIndex: 0 };
}

// ---------------------------------------------------------------------------------------------- manifest

export interface ManifestEntry {
  name: string;
  label: string;
  kind: Kind;
  unit: "mm" | "°" | null;
  value: Value;
  default: Value;
  min?: number;
  max?: number;
  step?: number;
  precision: number;
  options?: string[];
  group: string;
  derived: boolean;
  order: number;
}

function resolve(model: Model, values: Values): Map<string, Value> {
  const env = new Map<string, Value>();
  for (const decl of model.decls) {
    if (decl.derived) env.set(decl.name, exprValue(decl.expr, env));
    else {
      const given = values[decl.name];
      env.set(decl.name, given !== undefined && typeof given === typeof decl.default ? given : decl.default);
    }
  }
  return env;
}

export function buildManifest(model: Model, values: Values): ManifestEntry[] {
  const now = resolve(model, values);
  const defaults = resolve(model, {});
  return model.decls.map((decl): ManifestEntry => {
    const shared = { name: decl.name, label: labelOf(decl.name), group: decl.group, order: decl.order };
    if (decl.derived) {
      const initial = defaults.get(decl.name) as number;
      return { ...shared, kind: "length", unit: "mm", value: now.get(decl.name) as number, default: initial, precision: derivedStep(initial).precision, derived: true };
    }
    const entry: ManifestEntry = {
      ...shared,
      kind: decl.kind,
      unit: decl.unit,
      value: now.get(decl.name) as Value,
      default: decl.default,
      precision: decl.precision,
      derived: false,
    };
    if (decl.min !== undefined) entry.min = decl.min;
    if (decl.max !== undefined) entry.max = decl.max;
    if (decl.kind === "length" || decl.kind === "angle" || decl.kind === "count") entry.step = decl.step as number;
    if (decl.options) entry.options = decl.options;
    return entry;
  });
}

/** The values of every non-derived parameter at the source defaults. */
export function defaultValues(model: Model): Values {
  const out: Values = {};
  for (const decl of model.decls) if (!decl.derived) out[decl.name] = decl.default;
  return out;
}

/** Why a value is not valid for its parameter, or null. Counts and numbers have already passed the number grammar. */
export function checkValue(entry: ManifestEntry, value: unknown): string | null {
  if (entry.kind === "enum") {
    return typeof value === "string" && entry.options?.includes(value) ? null : `Choose one of ${entry.options?.join(", ")}.`;
  }
  if (entry.kind === "boolean") return typeof value === "boolean" ? null : "Enter true or false.";
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
  const unit = entry.unit ? `${NNBSP}${entry.unit}` : "";
  const below = entry.min !== undefined && value < entry.min;
  const above = entry.max !== undefined && value > entry.max;
  if (below || above) {
    if (entry.min !== undefined && entry.max !== undefined) return `${entry.label} must be between ${trimmed(entry.min)} and ${trimmed(entry.max)}${unit}.`;
    return entry.min !== undefined ? `${entry.label} must be at least ${trimmed(entry.min)}${unit}.` : `${entry.label} must be at most ${trimmed(entry.max as number)}${unit}.`;
  }
  if (entry.kind === "count" && !Number.isInteger(value)) return "Enter a whole number.";
  return null;
}

/** One `name=value` pair of a configuration address, as a value, or null when it is unusable. */
export function configValue(entry: ManifestEntry, text: string): Value | null {
  if (entry.derived) return null;
  let value: Value | null;
  if (entry.kind === "boolean") value = text === "true" ? true : text === "false" ? false : null;
  else if (entry.kind === "enum") value = text;
  else value = parseDecimal(text);
  return value !== null && checkValue(entry, value) === null ? value : null;
}

// ---------------------------------------------------------------------------------------------- solids

export type SolidOp =
  | { op: "box"; w: number; d: number; h: number }
  | { op: "cylinder"; dia: number; h: number }
  | { op: "boss"; dia: number; h: number; x: number; y: number }
  | { op: "hole"; dia: number; x: number; y: number }
  | { op: "slot"; w: number; len: number; x: number; y: number };

export interface Solid {
  ops: SolidOp[];
}

export type Vec3 = [number, number, number];

export interface Measure {
  volume: number;
  bbox: Vec3;
  faces: number;
}

const FACES: Record<SolidOp["op"], number> = { box: 6, cylinder: 3, boss: 2, hole: 1, slot: 4 };

export function bodyHeight(solid: Solid): number {
  const body = solid.ops[0];
  return body && (body.op === "box" || body.op === "cylinder") ? body.h : 0;
}

/** Volume, bounding box and face count of a solid, each volume and size rounded to 0.001. */
export function measure(solid: Solid): Measure {
  const body = solid.ops[0];
  if (!body || (body.op !== "box" && body.op !== "cylinder")) return { volume: 0, bbox: [0, 0, 0], faces: 0 };
  const height = body.h;
  let volume = body.op === "box" ? body.w * body.d * body.h : Math.PI * (body.dia / 2) ** 2 * body.h;
  let top = height;
  let faces = 0;
  for (const op of solid.ops) {
    faces += FACES[op.op];
    if (op.op === "boss") {
      volume += Math.PI * (op.dia / 2) ** 2 * op.h;
      top = Math.max(top, height + op.h);
    } else if (op.op === "hole") volume -= Math.PI * (op.dia / 2) ** 2 * height;
    else if (op.op === "slot") volume -= (op.len * op.w + Math.PI * (op.w / 2) ** 2) * height;
  }
  const plan: [number, number] = body.op === "box" ? [body.w, body.d] : [body.dia, body.dia];
  return {
    volume: roundHalfEven(volume, 3),
    bbox: [roundHalfEven(plan[0], 3), roundHalfEven(plan[1], 3), roundHalfEven(top, 3)],
    faces,
  };
}

export interface Pose {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
}

/** The camera pose of a box: its centre as target, d·(1, −1, 1)/√3 away, d = max(40, 2.5 × the diagonal). */
export function poseOfBox(min: readonly number[], max: readonly number[]): Pose {
  const [x0 = 0, y0 = 0, z0 = 0] = min;
  const [x1 = 0, y1 = 0, z1 = 0] = max;
  const target: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const diagonal = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const reach = Math.max(40, 2.5 * diagonal) / Math.sqrt(3);
  const round3 = (v: number) => roundHalfEven(v, 3);
  return {
    position: [round3(target[0] + reach), round3(target[1] - reach), round3(target[2] + reach)],
    target: [round3(target[0]), round3(target[1]), round3(target[2])],
    up: [0, 0, 1],
    fov: 35,
  };
}

/** The part's default view: the pose of its bounding box. */
export function poseOfSolid(solid: Solid): Pose {
  const { bbox } = measure(solid);
  return poseOfBox([-bbox[0] / 2, -bbox[1] / 2, 0], [bbox[0] / 2, bbox[1] / 2, bbox[2]]);
}

// ---------------------------------------------------------------------------------------------- evaluation

export interface Diagnostic {
  code: "E_TOO_LARGE" | "E_NONPOSITIVE" | "E_TOO_MANY_OPERATIONS" | "E_CUT_OUTSIDE" | "E_CUT_OVERLAP" | "E_TIMEOUT";
  message: string;
  parameter: string | null;
}

/** An operation placed in the part: repeats expanded, dropped operations left out. */
export interface Placed {
  verb: GeometryVerb;
  /** Resolved arguments in millimetres, unrounded: w d h dia len x y. */
  v: { w: number; d: number; h: number; dia: number; len: number; x: number; y: number };
  label: string | null;
  opIndex: number;
  line: number;
  /** Non-derived parameters named by the operation's arguments. */
  parameters: string[];
  /** The smallest distance from a hole's or slot's edge to the body's edge or another cut's edge. */
  wall: number | null;
}

export type Outcome =
  | { ok: true; solid: Solid; body: Placed | null; placed: Placed[] }
  | { ok: false; diagnostics: Diagnostic[] };

const KEYS: Record<GeometryVerb, ("w" | "d" | "h" | "dia" | "len")[]> = {
  box: ["w", "d", "h"],
  cylinder: ["dia", "h"],
  boss: ["dia", "h"],
  hole: ["dia"],
  slot: ["w", "len"],
};

function argInfo(statement: Geometry, index: number): { label: string; parameter: string | null } {
  const first = exprRefs(statement.args[index] as Expr)[0];
  return first ? { label: labelOf(first), parameter: first } : { label: ARG_ROLES[statement.verb][index] as string, parameter: null };
}

function parametersOf(model: Model, statement: Geometry): string[] {
  const out: string[] = [];
  const visit = (name: string) => {
    const decl = model.decls.find((d) => d.name === name);
    if (!decl) return;
    if (decl.derived) exprRefs(decl.expr).forEach(visit);
    else if (!out.includes(name)) out.push(name);
  };
  const exprs = [...statement.args, ...(statement.at ?? [])];
  for (const e of exprs) exprRefs(e).forEach(visit);
  return out;
}

interface Capsule {
  ax: number;
  bx: number;
  y: number;
  r: number;
}

function capsuleOf(p: Placed): Capsule {
  const half = p.verb === "slot" ? p.v.len / 2 : 0;
  return { ax: p.v.x - half, bx: p.v.x + half, y: p.v.y, r: p.verb === "slot" ? p.v.w / 2 : p.v.dia / 2 };
}

/** Distance between two edges: segments lie along x, so the gap is horizontal or vertical or diagonal at the ends. */
function gap(a: Capsule, b: Capsule): number {
  const dx = Math.max(0, a.ax - b.bx, b.ax - a.bx);
  return Math.hypot(dx, a.y - b.y) - a.r - b.r;
}

function outerWall(body: Placed, p: Placed): number {
  const c = capsuleOf(p);
  if (body.verb === "box") return Math.min(body.v.w / 2 - Math.max(Math.abs(c.ax), Math.abs(c.bx)) - c.r, body.v.d / 2 - Math.abs(c.y) - c.r);
  return body.v.dia / 2 - Math.max(Math.hypot(c.ax, c.y), Math.hypot(c.bx, c.y)) - c.r;
}

function bodyFootprint(body: Placed): string {
  const w = body.verb === "box" ? body.v.w : body.v.dia;
  const d = body.verb === "box" ? body.v.d : body.v.dia;
  return `${trimmed(w)} × ${trimmed(d)}${NNBSP}mm`;
}

function round3(n: number): number {
  return roundHalfEven(n, 3);
}

function toSolidOp(p: Placed): SolidOp {
  const r = (n: number) => round3(n);
  switch (p.verb) {
    case "box":
      return { op: "box", w: r(p.v.w), d: r(p.v.d), h: r(p.v.h) };
    case "cylinder":
      return { op: "cylinder", dia: r(p.v.dia), h: r(p.v.h) };
    case "boss":
      return { op: "boss", dia: r(p.v.dia), h: r(p.v.h), x: r(p.v.x), y: r(p.v.y) };
    case "hole":
      return { op: "hole", dia: r(p.v.dia), x: r(p.v.x), y: r(p.v.y) };
    case "slot":
      return { op: "slot", w: r(p.v.w), len: r(p.v.len), x: r(p.v.x), y: r(p.v.y) };
  }
}

function compareOps(a: SolidOp, b: SolidOp): number {
  const byName = compareText(a.op, b.op);
  if (byName !== 0) return byName;
  const ax = "x" in a ? a.x : 0;
  const bx = "x" in b ? b.x : 0;
  if (ax !== bx) return ax < bx ? -1 : 1;
  const ay = "y" in a ? a.y : 0;
  const by = "y" in b ? b.y : 0;
  return ay === by ? 0 : ay < by ? -1 : 1;
}

/**
 * Evaluates a part at the given values. With `upTo`, only operations up to that tape index are built
 * (a build-tape snapshot). Checks run in the published order and stop at the first failure.
 */
export function evaluate(model: Model, values: Values, upTo = Number.POSITIVE_INFINITY): Outcome {
  const env = resolve(model, values);
  const fail = (code: Diagnostic["code"], message: string, parameter: string | null): Outcome => ({ ok: false, diagnostics: [{ code, message, parameter }] });
  const statements = model.geometry.filter((s) => s.opIndex <= upTo && (s.condition === null || env.get(s.condition) === true));
  const sized = statements.map((s) => ({ s, args: s.args.map((e) => exprValue(e, env)) }));

  const tooLarge = (value: number, label: string, parameter: string | null): Outcome | null =>
    !Number.isFinite(value) || Math.abs(value) <= MAX_LENGTH
      ? null
      : fail("E_TOO_LARGE", `${label} is ${trimmed(value)}${NNBSP}mm; Tine allows at most ${display(MAX_LENGTH, 0)}${NNBSP}mm.`, parameter);

  for (const decl of model.decls) {
    if (decl.derived || decl.kind !== "length") continue;
    const found = tooLarge(env.get(decl.name) as number, labelOf(decl.name), decl.name);
    if (found) return found;
  }
  for (const { s, args } of sized) {
    for (let i = 0; i < args.length; i++) {
      const info = argInfo(s, i);
      const found = tooLarge(args[i] as number, info.label, info.parameter);
      if (found) return found;
    }
  }
  for (const { s, args } of sized) {
    const roleKeys = KEYS[s.verb];
    for (let i = 0; i < args.length; i++) {
      const key = roleKeys[i] as string;
      const value = args[i] as number;
      const allowsZero = (s.verb === "boss" && key === "h") || (s.verb === "slot" && key === "len");
      if (!Number.isFinite(value) || value < 0 || (value === 0 && !allowsZero)) {
        const info = argInfo(s, i);
        return fail("E_NONPOSITIVE", `${info.label} must be greater than 0${NNBSP}mm.`, info.parameter);
      }
    }
  }

  // Expansion. A statement inside a repeat is placed count times; dropped operations are left out.
  const counts = new Map<Repeat, number>();
  const copiesOf = (s: Geometry): number => {
    if (!s.repeat) return 1;
    if (!counts.has(s.repeat)) {
      const raw = exprValue(s.repeat.count, env);
      counts.set(s.repeat, Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0);
    }
    return counts.get(s.repeat) as number;
  };
  const kept = sized.filter(({ s, args }) => s.verb !== "boss" || (args[1] as number) > 0);
  const total = kept.reduce((n, { s }) => n + copiesOf(s), 0);
  if (total > MAX_OPERATIONS) return fail("E_TOO_MANY_OPERATIONS", `Part has ${display(total, 0)} operations after repeats; Tine allows at most ${MAX_OPERATIONS}.`, null);

  const placed: Placed[] = [];
  const labels = new Map<GeometryVerb, number>();
  let body: Placed | null = null;
  for (const { s, args } of kept) {
    const copies = copiesOf(s);
    const pitch = s.repeat ? exprValue(s.repeat.pitch, env) : 0;
    const base = { w: 0, d: 0, h: 0, dia: 0, len: 0, x: 0, y: 0 };
    KEYS[s.verb].forEach((key, i) => {
      base[key] = args[i] as number;
    });
    const parameters = parametersOf(model, s);
    for (let copy = 0; copy < copies; copy++) {
      const v = { ...base };
      if (s.at) {
        v.x = exprValue(s.at[0], env) + copy * pitch;
        v.y = exprValue(s.at[1], env);
      }
      const number = (labels.get(s.verb) ?? 0) + 1;
      if (s.verb !== "box" && s.verb !== "cylinder") labels.set(s.verb, number);
      const label = s.verb === "box" || s.verb === "cylinder" ? null : `${s.verb === "hole" ? "Hole" : s.verb === "slot" ? "Slot" : "Boss"} ${number}`;
      const item: Placed = { verb: s.verb, v, label, opIndex: s.opIndex, line: s.line, parameters, wall: null };
      if (label === null) body = item;
      else placed.push(item);
    }
  }

  if (body) {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i] as Placed;
      const edge = p.verb === "slot" ? p.v.w : p.v.dia;
      const diameterArg = sized.find(({ s }) => s.opIndex === p.opIndex);
      if (outerWall(body, p) <= 0) {
        const info = argInfo((diameterArg as { s: Geometry }).s, 0);
        return fail("E_CUT_OUTSIDE", `${p.label} (Ø ${trimmed(edge)}${NNBSP}mm) does not fit inside the ${bodyFootprint(body)} body.`, info.parameter);
      }
      for (let j = 0; j < i; j++) {
        const earlier = placed[j] as Placed;
        if (gap(capsuleOf(p), capsuleOf(earlier)) <= 0) {
          const info = argInfo((diameterArg as { s: Geometry }).s, 0);
          return fail("E_CUT_OVERLAP", `${p.label} overlaps ${earlier.label}.`, info.parameter);
        }
      }
    }
    for (const p of placed) {
      if (p.verb !== "hole" && p.verb !== "slot") continue;
      let wall = outerWall(body, p);
      for (const other of placed) {
        if (other !== p && (other.verb === "hole" || other.verb === "slot")) wall = Math.min(wall, gap(capsuleOf(p), capsuleOf(other)));
      }
      p.wall = wall;
    }
  }

  const rest = placed.map(toSolidOp).sort(compareOps);
  return { ok: true, solid: { ops: body ? [toSolidOp(body), ...rest] : [] }, body, placed };
}

/** The lines of the source up to a tape operation, closing a repeat block that the cut leaves open. */
export function forkSource(model: Model, operation: number): string {
  const step = model.tape[operation] as TapeStep;
  const kept = model.lines.slice(0, step.line ?? 0);
  const insideBlock = step.op === "repeat" || model.blockOf.has(operation);
  return `${[...kept, ...(insideBlock ? ["}"] : [])].join("\n")}\n`;
}
