import { LANES, MAX_INPUT_EVENTS, type InputEvent, type Lane } from "../shared/model.js";

// The replay file rules. A small JSON reader keeps each number's written form, refuses repeated
// keys and stops as soon as nesting passes the published depth, so any body is judged quickly.

const MAX_DEPTH = 4;
const EVENT_KEYS = ["step", "throttle", "brake", "drift", "lane"];

type Value =
  | { kind: "object"; entries: Map<string, Value> }
  | { kind: "array"; items: Value[] }
  | { kind: "string"; value: string }
  | { kind: "number"; raw: string }
  | { kind: "literal"; raw: "true" | "false" | "null" };

class Unreadable extends Error {}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPES: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class Reader {
  private at = 0;

  constructor(private readonly text: string) {}

  document(): Value {
    const value = this.value(1);
    this.space();
    if (this.at !== this.text.length) throw new Unreadable();
    return value;
  }

  private space(): void {
    for (;;) {
      const c = this.text.charCodeAt(this.at);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.at += 1;
      else return;
    }
  }

  // Only arrays and objects add a nesting level.
  private value(depth: number): Value {
    this.space();
    const c = this.text[this.at];
    if ((c === "{" || c === "[") && depth > MAX_DEPTH) throw new Unreadable();
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (c === '"') return { kind: "string", value: this.string() };
    for (const raw of ["true", "false", "null"] as const) {
      if (this.text.startsWith(raw, this.at)) {
        this.at += raw.length;
        return { kind: "literal", raw };
      }
    }
    NUMBER.lastIndex = this.at;
    const match = NUMBER.exec(this.text);
    if (!match) throw new Unreadable();
    this.at += match[0].length;
    return { kind: "number", raw: match[0] };
  }

  private object(depth: number): Value {
    this.at += 1;
    const entries = new Map<string, Value>();
    this.space();
    if (this.text[this.at] === "}") {
      this.at += 1;
      return { kind: "object", entries };
    }
    for (;;) {
      this.space();
      if (this.text[this.at] !== '"') throw new Unreadable();
      const key = this.string();
      if (entries.has(key)) throw new Unreadable();
      this.space();
      if (this.text[this.at] !== ":") throw new Unreadable();
      this.at += 1;
      entries.set(key, this.value(depth + 1));
      this.space();
      const next = this.text[this.at++];
      if (next === "}") return { kind: "object", entries };
      if (next !== ",") throw new Unreadable();
    }
  }

  private array(depth: number): Value {
    this.at += 1;
    const items: Value[] = [];
    this.space();
    if (this.text[this.at] === "]") {
      this.at += 1;
      return { kind: "array", items };
    }
    for (;;) {
      items.push(this.value(depth + 1));
      this.space();
      const next = this.text[this.at++];
      if (next === "]") return { kind: "array", items };
      if (next !== ",") throw new Unreadable();
    }
  }

  private string(): string {
    this.at += 1;
    let out = "";
    for (;;) {
      const c = this.text[this.at++];
      if (c === undefined || c.charCodeAt(0) < 0x20) throw new Unreadable();
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const e = this.text[this.at++];
      if (e === "u") {
        const hex = this.text.slice(this.at, this.at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Unreadable();
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.at += 4;
      } else if (e !== undefined && e in ESCAPES) {
        out += ESCAPES[e];
      } else {
        throw new Unreadable();
      }
    }
  }
}

type ReplayVerdict =
  | { ok: true; inputs: InputEvent[] }
  | { ok: false; reason: "invalid_inputs" | "seed_mismatch" };

const DECODER = new TextDecoder("utf-8", { fatal: true });

function pedal(value: Value | undefined): 0 | 1 | null {
  return value?.kind === "number" && (value.raw === "0" || value.raw === "1") ? (value.raw === "1" ? 1 : 0) : null;
}

// Judges a stored replay against the run's seed and step limit, checks in the published order.
export function readReplay(bytes: Buffer, seed: string, stepLimit: number): ReplayVerdict {
  const invalid: ReplayVerdict = { ok: false, reason: "invalid_inputs" };
  let root: Value;
  try {
    root = new Reader(DECODER.decode(bytes)).document();
  } catch {
    return invalid;
  }
  if (root.kind !== "object") return invalid;
  const seedValue = root.entries.get("seed");
  const inputsValue = root.entries.get("inputs");
  if (!seedValue || inputsValue?.kind !== "array") return invalid;
  if (seedValue.kind !== "string" || seedValue.value !== seed) return { ok: false, reason: "seed_mismatch" };

  const events = inputsValue.items;
  if (events.length < 1 || events.length > MAX_INPUT_EVENTS) return invalid;
  const inputs: InputEvent[] = [];
  for (const event of events) {
    if (event.kind !== "object" || event.entries.size !== EVENT_KEYS.length) return invalid;
    if (!EVENT_KEYS.every((key) => event.entries.has(key))) return invalid;
    const stepValue = event.entries.get("step");
    if (stepValue?.kind !== "number" || !/^(0|[1-9]\d*)$/.test(stepValue.raw)) return invalid;
    const step = Number(stepValue.raw);
    if (step > stepLimit - 1) return invalid;
    const previous = inputs[inputs.length - 1];
    if (previous ? step <= previous.step : step !== 0) return invalid;
    const throttle = pedal(event.entries.get("throttle"));
    const brake = pedal(event.entries.get("brake"));
    const drift = pedal(event.entries.get("drift"));
    const laneValue = event.entries.get("lane");
    if (throttle === null || brake === null || drift === null) return invalid;
    if (laneValue?.kind !== "string" || !LANES.includes(laneValue.value as Lane)) return invalid;
    inputs.push({ step, throttle, brake, drift, lane: laneValue.value as Lane });
  }
  return { ok: true, inputs };
}
