/**
 * Pipelines (rule C): the six processors, their conditions and the one failure handler.
 */
import { analyze } from "../shared/analyze";
import type { FilterOp, FieldType } from "../shared/types";
import { flatten, isIsoDate, valuesOf } from "../shared/util";
import { nowIso } from "./clock";

export interface Processor {
  type: string;
  [key: string]: unknown;
}

export interface Condition {
  field: string;
  op: "eq" | "ne" | "exists";
  value?: unknown;
}

export interface PipelineFailure {
  reason: string;
}

export interface StepOutcome {
  status: "applied" | "skipped" | "failed" | "dropped";
  event: Record<string, unknown>;
  changed: string[];
  text?: string;
}

/** The processor schemas for validation. */
const REQUIRED_SETTINGS: Record<string, string[]> = {
  split: ["field", "pattern", "targets"],
  rename: ["from", "to"],
  set: ["field", "value"],
  parse_date: ["field", "format"],
  drop: [],
  redact: ["field", "pattern"],
};

const IPV4_RE = /(?<!\d)(\d{1,2}|[01]\d\d|2[0-4]\d|25[0-5])(\.(\d{1,2}|[01]\d\d|2[0-4]\d|25[0-5])){3}(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DIGITS_RE = /[0-9]+/g;

export function validateProcessors(processors: unknown): { ok: boolean; reason?: string } {
  if (!Array.isArray(processors)) return { ok: false, reason: "Processors must be a list." };
  for (let k = 0; k < processors.length; k += 1) {
    const p = processors[k];
    if (p === null || typeof p !== "object" || Array.isArray(p)) {
      return { ok: false, reason: `Processor ${k + 1}: not an object.` };
    }
    const proc = p as Record<string, unknown>;
    const type = proc.type;
    if (typeof type !== "string" || !(type in REQUIRED_SETTINGS)) {
      return { ok: false, reason: `Processor ${k + 1}: unknown type.` };
    }
    for (const key of REQUIRED_SETTINGS[type]) {
      if (!(key in proc)) {
        return { ok: false, reason: `Processor ${k + 1}: setting ${key} is required.` };
      }
    }
    if ("if" in proc) {
      const cond = proc.if;
      if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
        return { ok: false, reason: `Processor ${k + 1}: condition must be an object.` };
      }
      const c = cond as Record<string, unknown>;
      if (typeof c.field !== "string" || !["eq", "ne", "exists"].includes(String(c.op))) {
        return { ok: false, reason: `Processor ${k + 1}: condition must have field and op.` };
      }
      if ((c.op === "eq" || c.op === "ne") && !("value" in c)) {
        return { ok: false, reason: `Processor ${k + 1}: condition needs a value.` };
      }
    }
  }
  return { ok: true };
}

function conditionHolds(cond: Condition, event: Record<string, unknown>): boolean {
  const flat = flatten(event);
  const raw = flat[cond.field];
  const present = raw !== undefined && raw !== null;
  if (cond.op === "exists") return present;
  const equal = valuesOf(raw).some((v) => v === cond.value) || raw === cond.value;
  if (cond.op === "eq") return equal;
  return !equal;
}

function setFlat(event: Record<string, unknown>, field: string, value: unknown): Record<string, unknown> {
  const rebuilt = flatten(event);
  rebuilt[field] = value;
  return unflatten(rebuilt);
}

/** Rebuild nested objects from dotted paths, keeping arrays. */
export function unflatten(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let cur: Record<string, unknown> = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      const next = cur[key];
      if (next === null || typeof next !== "object" || Array.isArray(next)) {
        cur[key] = {};
      }
      cur = cur[key] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

function deleteFlat(event: Record<string, unknown>, field: string): Record<string, unknown> {
  const flat = flatten(event);
  delete flat[field];
  return unflatten(flat);
}

/** Run one processor. Returns the new event, changed fields, or a failure reason. */
export function runProcessor(
  proc: Processor,
  event: Record<string, unknown>,
): { ok: true; event: Record<string, unknown>; changed: string[]; dropped?: boolean } | { ok: false; reason: string } {
  const flatIn = flatten(event);
  const before = JSON.stringify(event);
  switch (proc.type) {
    case "split": {
      const field = String(proc.field);
      const pattern = String(proc.pattern);
      const targets = proc.targets;
      if (!Array.isArray(targets) || targets.some((t) => typeof t !== "string")) {
        return { ok: false, reason: "targets must be a list of field names" };
      }
      const value = flatIn[field];
      if (value === undefined) return { ok: false, reason: `field ${field} is missing` };
      if (typeof value !== "string") return { ok: false, reason: `field ${field} is missing` };
      const parts = value.split(pattern);
      if (parts.length !== targets.length) {
        return { ok: false, reason: `split made ${parts.length} parts, expected ${targets.length}` };
      }
      let next = event;
      const changed: string[] = [];
      for (let i = 0; i < targets.length; i += 1) {
        next = setFlat(next, String(targets[i]), parts[i]);
        changed.push(String(targets[i]));
      }
      return { ok: true, event: next, changed };
    }
    case "rename": {
      const from = String(proc.from);
      const to = String(proc.to);
      const value = flatIn[from];
      if (value === undefined) return { ok: false, reason: `field ${from} is missing` };
      let next = deleteFlat(event, from);
      next = setFlat(next, to, value);
      return { ok: true, event: next, changed: [to] };
    }
    case "set": {
      const field = String(proc.field);
      const next = setFlat(event, field, proc.value);
      return { ok: true, event: next, changed: [field] };
    }
    case "parse_date": {
      const field = String(proc.field);
      const format = String(proc.format);
      const value = flatIn[field];
      if (value === undefined) return { ok: false, reason: `field ${field} is missing` };
      let iso: string | null = null;
      if (format === "iso") {
        if (typeof value === "string" && isIsoDate(value)) iso = value;
      } else if (format === "epoch_ms") {
        if (typeof value === "number") iso = new Date(value).toISOString();
        else if (typeof value === "string" && /^\d+$/.test(value)) iso = new Date(Number(value)).toISOString();
      }
      if (!iso) return { ok: false, reason: `${String(value)} is not a date` };
      const next = setFlat(event, "@timestamp", iso);
      return { ok: true, event: next, changed: ["@timestamp"] };
    }
    case "drop": {
      return { ok: true, event, changed: [], dropped: true };
    }
    case "redact": {
      const field = String(proc.field);
      const pattern = String(proc.pattern);
      const value = flatIn[field];
      if (typeof value !== "string") return { ok: true, event, changed: [] };
      let out = value;
      if (pattern === "ipv4") out = value.replace(IPV4_RE, "[hidden]");
      else if (pattern === "email") out = value.replace(EMAIL_RE, "[hidden]");
      else if (pattern === "digits") out = value.replace(DIGITS_RE, "[hidden]");
      const next = setFlat(event, field, out);
      return { ok: true, event: next, changed: out === value ? [] : [field] };
    }
  }
  return { ok: false, reason: "unknown processor" };
}

export interface PipelineRunResult {
  outcome: "stored" | "dropped" | "failed";
  event: Record<string, unknown>;
  error?: string;
  steps: StepOutcome[];
}

/** Run a whole pipeline on one event (rule C). */
export function runPipeline(
  name: string,
  processors: Processor[],
  event: Record<string, unknown>,
): PipelineRunResult {
  let current = event;
  const steps: StepOutcome[] = [];
  for (let k = 0; k < processors.length; k += 1) {
    const proc = processors[k];
    const cond = (proc.if ?? null) as Condition | null;
    if (cond && !conditionHolds(cond, current)) {
      steps.push({ status: "skipped", event: current, changed: [], text: "Skipped: condition false" });
      continue;
    }
    const res = runProcessor(proc, current);
    if (!res.ok) {
      const sentence = `Pipeline ${name} failed at processor ${k + 1}: ${res.reason}.`;
      return { outcome: "failed", event: current, error: sentence, steps };
    }
    if (res.dropped) {
      steps.push({ status: "dropped", event: current, changed: [], text: "Dropped" });
      return { outcome: "dropped", event: current, steps };
    }
    current = res.event;
    steps.push({ status: "applied", event: current, changed: res.changed });
  }
  return { outcome: "stored", event: current, steps };
}
