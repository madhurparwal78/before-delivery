// Ingest pipelines (Business rules C): six processors, one optional condition each, one failure handler.
import { formatIso, parseIsoInstant } from "../../shared/time";
import { pool } from "../db";
import { flatten, isPlainObject, type Doc } from "../search/fields";

const CONDITION_OPS = ["eq", "ne", "exists"] as const;
const REDACT_PATTERNS = ["ipv4", "email", "digits"] as const;
const DATE_FORMATS = ["iso", "epoch_ms"] as const;

export interface Condition {
  field: string;
  op: (typeof CONDITION_OPS)[number];
  value?: unknown;
}

export type Processor = { if?: Condition } & (
  | { type: "split"; field: string; pattern: string; targets: string[] }
  | { type: "rename"; from: string; to: string }
  | { type: "set"; field: string; value: unknown }
  | { type: "parse_date"; field: string; format: (typeof DATE_FORMATS)[number] }
  | { type: "drop" }
  | { type: "redact"; field: string; pattern: (typeof REDACT_PATTERNS)[number] }
);

export interface StoredPipeline {
  name: string;
  version: number;
  processors: Processor[];
}

interface Step {
  step: number;
  processor: string;
  status: "applied" | "skipped" | "failed" | "dropped";
  event: Doc;
  changed: string[];
  text?: string;
}

type PipelineRun =
  | { outcome: "stored"; doc: Doc; steps: Step[] }
  | { outcome: "dropped"; steps: Step[] }
  | { outcome: "failed"; error: string; steps: Step[] };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** The first problem in a processor list as `Processor <k>: <reason>.`, or null when it is valid. */
export function processorProblem(list: unknown): string | null {
  if (!Array.isArray(list)) return "Processors must be a list.";
  for (const [index, item] of list.entries()) {
    const at = `Processor ${index + 1}`;
    if (!isPlainObject(item)) return `${at}: must be an object.`;
    const need = (key: string, ok: boolean): string | null => (ok ? null : `${at}: ${key} is required.`);
    const common = item.if === undefined ? null : conditionProblem(item.if, at);
    if (common) return common;
    const found =
      item.type === "split"
        ? need("field", isText(item.field)) ?? need("pattern", isText(item.pattern)) ??
          need("targets", Array.isArray(item.targets) && item.targets.length > 0 && item.targets.every(isText))
        : item.type === "rename"
          ? need("from", isText(item.from)) ?? need("to", isText(item.to))
          : item.type === "set"
            ? need("field", isText(item.field)) ?? need("value", "value" in item)
            : item.type === "parse_date"
              ? need("field", isText(item.field)) ?? (DATE_FORMATS.includes(item.format as never) ? null : `${at}: format must be iso or epoch_ms.`)
              : item.type === "drop"
                ? null
                : item.type === "redact"
                  ? need("field", isText(item.field)) ?? (REDACT_PATTERNS.includes(item.pattern as never) ? null : `${at}: pattern must be ipv4, email or digits.`)
                  : typeof item.type === "string" ? `${at}: unknown type ${item.type}.` : `${at}: type is required.`;
    if (found) return found;
  }
  return null;
}

function conditionProblem(condition: unknown, at: string): string | null {
  if (!isPlainObject(condition) || !isText(condition.field) || !CONDITION_OPS.includes(condition.op as never)) {
    return `${at}: if needs a field and an op of eq, ne or exists.`;
  }
  return null;
}

function walk(doc: Doc, path: string, remove = false): unknown {
  const segments = path.split(".");
  let holder: Doc = doc;
  for (const segment of segments.slice(0, -1)) {
    const next = holder[segment];
    if (!isPlainObject(next)) return undefined;
    holder = next;
  }
  const last = segments[segments.length - 1] as string;
  const value = holder[last];
  if (remove) delete holder[last];
  return value;
}

const getPath = (doc: Doc, path: string): unknown => walk(doc, path);
const removePath = (doc: Doc, path: string): unknown => walk(doc, path, true);

function setPath(doc: Doc, path: string, value: unknown): void {
  const segments = path.split(".");
  let holder: Doc = doc;
  for (const segment of segments.slice(0, -1)) {
    const next = holder[segment];
    if (isPlainObject(next)) holder = next;
    else holder = holder[segment] = {};
  }
  holder[segments[segments.length - 1] as string] = value;
}

function conditionHolds(condition: Condition, doc: Doc): boolean {
  const have = getPath(doc, condition.field);
  if (condition.op === "exists") return have !== undefined;
  const same = JSON.stringify(have) === JSON.stringify(condition.value);
  return condition.op === "eq" ? have !== undefined && same : !(have !== undefined && same);
}

function redact(text: string, pattern: "ipv4" | "email" | "digits"): string {
  if (pattern === "digits") return text.replace(/[0-9]+/g, "[hidden]");
  if (pattern === "email") return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[hidden]");
  return text.replace(/(?<![0-9])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![0-9])/g, (whole, ...groups: string[]) =>
    groups.slice(0, 4).every((group) => Number(group) <= 255) ? "[hidden]" : whole,
  );
}

/** Applies one processor; returns a failure reason, "drop", or null when it applied. */
function apply(processor: Processor, doc: Doc): string | null {
  switch (processor.type) {
    case "split": {
      const value = getPath(doc, processor.field);
      if (value === undefined) return `field ${processor.field} is missing`;
      const parts = String(value).split(processor.pattern);
      if (parts.length !== processor.targets.length) return `split made ${parts.length} parts, expected ${processor.targets.length}`;
      processor.targets.forEach((target, at) => setPath(doc, target, parts[at]));
      return null;
    }
    case "rename": {
      const value = getPath(doc, processor.from);
      if (value === undefined) return `field ${processor.from} is missing`;
      removePath(doc, processor.from);
      setPath(doc, processor.to, value);
      return null;
    }
    case "set":
      setPath(doc, processor.field, structuredClone(processor.value));
      return null;
    case "parse_date": {
      const value = getPath(doc, processor.field);
      if (value === undefined) return `field ${processor.field} is missing`;
      const ms = processor.format === "iso" ? (typeof value === "string" ? parseIsoInstant(value) : null) : typeof value === "number" && Number.isFinite(value) ? value : null;
      if (ms === null || Number.isNaN(new Date(ms).getTime())) return `${String(value)} is not a date`;
      doc["@timestamp"] = formatIso(ms);
      return null;
    }
    case "drop":
      return "drop";
    case "redact": {
      const value = getPath(doc, processor.field);
      if (typeof value === "string") setPath(doc, processor.field, redact(value, processor.pattern));
      return null;
    }
  }
}

function changedPaths(before: Doc, after: Doc): string[] {
  const a = flatten(before);
  const b = flatten(after);
  const changed: string[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path))) changed.push(path);
  }
  return changed.sort();
}

export function runPipeline(pipeline: StoredPipeline, input: Doc, trace: boolean): PipelineRun {
  const doc = structuredClone(input);
  const steps: Step[] = [];
  const record = (entry: Omit<Step, "event"> & { before: Doc }): void => {
    if (!trace) return;
    const { before, ...rest } = entry;
    steps.push({ ...rest, event: structuredClone(doc), changed: rest.status === "applied" ? changedPaths(before, doc) : [] });
  };
  for (const [index, processor] of pipeline.processors.entries()) {
    const base = { step: index + 1, processor: processor.type, changed: [] as string[], before: trace ? structuredClone(doc) : doc };
    if (processor.if && !conditionHolds(processor.if, doc)) {
      record({ ...base, status: "skipped", text: "Skipped: condition false" });
      continue;
    }
    const result = apply(processor, doc);
    if (result === "drop") {
      record({ ...base, status: "dropped", text: "Dropped" });
      return { outcome: "dropped", steps };
    }
    if (result !== null) {
      const error = `Pipeline ${pipeline.name} failed at processor ${index + 1}: ${result}.`;
      record({ ...base, status: "failed", text: error });
      return { outcome: "failed", error, steps };
    }
    record({ ...base, status: "applied" });
  }
  return { outcome: "stored", doc, steps };
}

export async function findPipeline(spaceId: number, name: string): Promise<StoredPipeline | null> {
  const { rows } = await pool.query<{ name: string; version: number; processors: Processor[] }>(
    "SELECT name, version, processors FROM pipelines WHERE space_id = $1 AND name = $2", [spaceId, name],
  );
  return rows[0] ?? null;
}

export async function savePipeline(spaceId: number, name: string, processors: Processor[]): Promise<{ created: boolean; version: number }> {
  const { rows } = await pool.query<{ version: number; inserted: boolean }>(
    `INSERT INTO pipelines (space_id, name, version, processors) VALUES ($1, $2, 1, $3)
     ON CONFLICT (space_id, name) DO UPDATE SET version = pipelines.version + 1, processors = EXCLUDED.processors
     RETURNING version, (xmax = 0) AS inserted`,
    [spaceId, name, JSON.stringify(processors)],
  );
  const row = rows[0] as { version: number; inserted: boolean };
  return { created: row.inserted, version: row.version };
}

/** Runs a saved pipeline over sample lines and stores nothing. */
export function simulate(pipeline: StoredPipeline, text: string) {
  const results: Array<{ event: number; outcome: "stored" | "dropped" | "failed"; error?: string; steps: Step[] }> = [];
  text.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    const event = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      results.push({ event, outcome: "failed", error: `Event ${event}: not valid JSON.`, steps: [] });
      return;
    }
    if (!isPlainObject(parsed)) {
      results.push({ event, outcome: "failed", error: `Event ${event}: not an object.`, steps: [] });
      return;
    }
    const run = runPipeline(pipeline, parsed, true);
    results.push({ event, outcome: run.outcome, ...(run.outcome === "failed" ? { error: run.error } : {}), steps: run.steps });
  });
  return results;
}
