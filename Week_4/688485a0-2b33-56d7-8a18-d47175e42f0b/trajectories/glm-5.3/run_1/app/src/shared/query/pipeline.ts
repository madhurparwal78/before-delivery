import { JsonObj, JsonValue, compareValues, roundHalfAwayFromZero, compactJson } from "../values.js";
import { parseFilter, matches, parseSort, FilterPlan, SortKey } from "./filter.js";
import { sortDocs } from "./sort.js";
import { parseProjection, applyProjection, ProjectionError } from "./projection.js";
import { splitPath, getPathValue } from "./paths.js";
import { QUERY_DEPTH_LIMIT } from "../config.js";
import { fail, RequestError } from "../errors.js";

/**
 * The pipeline engine (DP-19 … DP-28): stage parsing, execution, exact counts,
 * preview documents and pinned-document tracking.
 */

export interface RawStage { op: string; body: unknown }

const STAGE_NAMES = new Set(["$match", "$project", "$sort", "$limit", "$skip", "$unwind", "$group", "$count"]);

export interface CompiledStage {
  index: number;
  op: string;
  disabled: boolean;
  match?: FilterPlan;
  projection?: ReturnType<typeof parseProjection>;
  sort?: SortKey[];
  limit?: number;
  skip?: number;
  unwind?: string;
  group?: GroupSpec;
  countName?: string;
}

interface GroupSpec {
  keyKind: "null" | "path" | "object";
  keyPath: string | undefined;
  /** Object keys: field name -> source path. */
  keyFields: { name: string; path: string }[] | undefined;
  fields: { name: string; acc: string; source: string }[];
}

/** Parse one stage object, reporting errors against its 0-based index. */
export function parseStage(obj: unknown, index: number): { op: string; body: unknown } {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) fail("invalid_stage", 422, { index });
  const keys = Object.keys(obj);
  if (keys.length !== 1) fail("invalid_stage", 422, { index });
  const op = keys[0];
  if (!STAGE_NAMES.has(op)) fail("unknown_stage", 422, { stage: op, index });
  return { op, body: (obj as JsonObj)[op] };
}

function stageDepth(v: unknown, d: number): number {
  if (typeof v !== "object" || v === null) return d;
  let m = d;
  for (const k in v as JsonObj) m = Math.max(m, stageDepth((v as JsonObj)[k], d + 1));
  return m;
}

export function compileStage(op: string, body: unknown, index: number): CompiledStage {
  const base: CompiledStage = { index, op, disabled: false };
  try {
    if (stageDepth(body, 0) > QUERY_DEPTH_LIMIT) fail("query_too_deep", 422, { limit: QUERY_DEPTH_LIMIT });
    switch (op) {
      case "$match": {
        const match = parseFilter(body, index);
        return { ...base, match };
      }
      case "$project": {
        try {
          const projection = parseProjection(body, true);
          return { ...base, projection };
        } catch (err) {
          if (err instanceof ProjectionError) fail("invalid_stage", 422, { index });
          throw err;
        }
      }
      case "$sort": {
        const sort = parseSort(body, index);
        return { ...base, sort };
      }
      case "$limit": {
        if (typeof body !== "number" || !Number.isInteger(body) || body < 1) fail("invalid_stage", 422, { index });
        return { ...base, limit: body };
      }
      case "$skip": {
        if (typeof body !== "number" || !Number.isInteger(body) || body < 0) fail("invalid_stage", 422, { index });
        return { ...base, skip: body };
      }
      case "$unwind": {
        if (typeof body !== "string" || !body.startsWith("$") || body.length < 2) fail("invalid_stage", 422, { index });
        return { ...base, unwind: body.slice(1) };
      }
      case "$group": {
        return { ...base, group: parseGroup(body, index) };
      }
      default: {
        // $count
        if (typeof body !== "string" || body.length === 0 || body.startsWith("$") || body.includes(".")) {
          fail("invalid_stage", 422, { index });
        }
        return { ...base, countName: body };
      }
    }
  } catch (err) {
    if (err instanceof RequestError && err.code === "query_too_deep") {
      // the pipeline reports invalid_stage at the stage level
      fail("invalid_stage", 422, { index });
    }
    throw err;
  }
}

function parseGroup(body: unknown, index: number): GroupSpec {
  if (typeof body !== "object" || body === null || Array.isArray(body)) fail("invalid_stage", 422, { index });
  const obj = body as JsonObj;
  if (!Object.prototype.hasOwnProperty.call(obj, "_id")) fail("invalid_stage", 422, { index });
  const idSpec = obj["_id"];
  let keyKind: "null" | "path" | "object" = "null";
  let keyPath: string | undefined;
  let keyFields: { name: string; path: string }[] | undefined;
  if (idSpec === null) {
    keyKind = "null";
  } else if (typeof idSpec === "string" && idSpec.startsWith("$") && idSpec.length > 1) {
    keyKind = "path";
    keyPath = idSpec.slice(1);
  } else if (typeof idSpec === "object" && !Array.isArray(idSpec)) {
    keyKind = "object";
    keyFields = [];
    for (const n of Object.keys(idSpec)) {
      const v = (idSpec as JsonObj)[n];
      if (typeof v !== "string" || !v.startsWith("$") || v.length < 2) fail("invalid_stage", 422, { index });
      keyFields.push({ name: n, path: v.slice(1) });
    }
  } else {
    fail("invalid_stage", 422, { index });
  }
  const fields: { name: string; acc: string; source: string }[] = [];
  for (const name of Object.keys(obj)) {
    if (name === "_id") continue;
    const spec = obj[name];
    if (typeof spec !== "object" || spec === null || Array.isArray(spec)) fail("invalid_stage", 422, { index });
    const accKeys = Object.keys(spec);
    if (accKeys.length !== 1) fail("invalid_stage", 422, { index });
    const acc = accKeys[0];
    if (!/^\$(sum|avg|min|max|count|push|first|last)$/.test(acc)) fail("invalid_stage", 422, { index });
    const source = (spec as JsonObj)[acc];
    if (acc === "$count") {
      // $count takes an empty object
      if (typeof source !== "object" || source === null || Array.isArray(source) || Object.keys(source).length !== 0) {
        fail("invalid_stage", 422, { index });
      }
    } else if (typeof source !== "string" || !source.startsWith("$") || source.length < 2) {
      fail("invalid_stage", 422, { index });
    }
    fields.push({ name, acc: acc.slice(1), source: acc === "$count" ? "" : (source as string).slice(1) });
  }
  return { keyKind, keyPath, keyFields, fields };
}

/** A unique id for each input document, so pin tracking can follow provenance. */
export interface WithProv {
  doc: JsonObj;
  /** Input indexes this output came from: one for plain stages, many for $group and $count. */
  provs: number[];
}

export function runPipeline(
  input: JsonObj[],
  stages: CompiledStage[],
  opts: { previewDocs: number; pin?: string },
): {
  stages: { index: number; count: number; documents: JsonObj[] }[];
  pin: { _id: string; stopped_at: number | null } | undefined;
} {
  let cur: WithProv[] = input.map((doc, i) => ({ doc, provs: [i] }));
  const out: { index: number; count: number; documents: JsonObj[] }[] = [];
  let pinProv: Set<number> | undefined;
  if (opts.pin !== undefined) {
    pinProv = new Set<number>(input.map((d, i) => d["_id"] === opts.pin ? i : -1).filter(i => i >= 0));
  }
  let pinStopped: number | null = null;
  for (const st of stages) {
    const after = st.disabled ? cur : executeStage(st, cur);
    if (pinProv !== undefined && pinStopped === null && !st.disabled) {
      const next = new Set<number>();
      for (const x of after) for (const p of x.provs) if (pinProv.has(p)) next.add(p);
      if (next.size === 0) pinStopped = st.index;
      else pinProv = next;
    }
    out.push({ index: st.index, count: after.length, documents: after.slice(0, opts.previewDocs).map(x => x.doc) });
    cur = after;
  }
  const pin = opts.pin !== undefined ? { _id: opts.pin, stopped_at: pinStopped } : undefined;
  return { stages: out, pin };
}

function executeStage(st: CompiledStage, cur: WithProv[]): WithProv[] {
  switch (st.op) {
    case "$match":
      return cur.filter(x => st.match !== undefined && matches(st.match, x.doc));
    case "$project":
      return cur.map(x => ({ doc: applyProjection(x.doc, st.projection ?? { mode: "none", paths: [], dropId: false, copies: [] }), provs: x.provs }));
    case "$sort": {
      const sorted = sortDocs(cur.map(x => x.doc), st.sort ?? []);
      const byDoc = new Map<JsonObj, number[]>();
      cur.forEach((x, i) => {
        const list = byDoc.get(x.doc);
        if (list) list.push(i);
        else byDoc.set(x.doc, [i]);
      });
      return sorted.map(d => {
        const list = byDoc.get(d) as number[];
        const i = list.shift() as number;
        return { doc: d, provs: cur[i].provs };
      });
    }
    case "$limit":
      return cur.slice(0, st.limit);
    case "$skip":
      return cur.slice(st.skip);
    case "$unwind": {
      const out: WithProv[] = [];
      const parts = splitPath(st.unwind ?? "");
      for (const x of cur) {
        const v = getPathValue(x.doc, parts);
        if (v === undefined || v === null) continue; // missing, null dropped
        if (Array.isArray(v)) {
          if (v.length === 0) continue; // empty arrays dropped
          for (const el of v) out.push({ doc: replaceAt(x.doc, parts, el), provs: x.provs });
        } else {
          out.push(x); // non-arrays pass through unchanged
        }
      }
      return out;
    }
    case "$group": {
      const groups = new Map<string, { key: JsonValue; items: WithProv[] }>();
      for (const x of cur) {
        const key = groupKey(st.group as GroupSpec, x.doc);
        const text = compactJson(key);
        let g = groups.get(text);
        if (!g) {
          g = { key, items: [] };
          groups.set(text, g);
        }
        g.items.push(x);
      }
      const out: WithProv[] = [];
      const sorted = [...groups.values()].sort((a, b) => compareValues(a.key, b.key));
      for (const g of sorted) {
        const doc: JsonObj = { _id: g.key };
        for (const f of (st.group as GroupSpec).fields) {
          doc[f.name] = accumulate(f, g.items);
        }
        out.push({ doc, provs: g.items.flatMap(x => x.provs) });
      }
      return out;
    }
    default: {
      // $count: one document from every input; none when the input is empty
      if (cur.length === 0) return [];
      return [{ doc: { [st.countName as string]: cur.length }, provs: cur.flatMap(x => x.provs) }];
    }
  }
}

function groupKey(spec: GroupSpec, doc: JsonObj): JsonValue {
  if (spec.keyKind === "null") return null;
  if (spec.keyKind === "path") return getPathValue(doc, splitPath(spec.keyPath as string)) ?? null;
  const out: JsonObj = {};
  for (const kf of spec.keyFields ?? []) {
    out[kf.name] = getPathValue(doc, splitPath(kf.path)) ?? null;
  }
  return out;
}

function accumulate(f: { name: string; acc: string; source: string }, items: WithProv[]): JsonValue {
  const parts = f.source ? splitPath(f.source) : [];
  const values = items.map(x => getPathValue(x.doc, parts));
  switch (f.acc) {
    case "sum": {
      let s = 0;
      for (const v of values) if (typeof v === "number" && !Number.isNaN(v)) s += v;
      return s;
    }
    case "avg": {
      const nums = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
      if (nums.length === 0) return null;
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return roundHalfAwayFromZero(avg, 10);
    }
    case "min": case "max": {
      let best: JsonValue | undefined;
      for (const v of values) {
        if (v === undefined) continue;
        if (v === null) continue;
        if (best === undefined || (f.acc === "min" ? compareValues(v, best) < 0 : compareValues(v, best) > 0)) best = v;
      }
      return best ?? null;
    }
    case "push": {
      const out: JsonValue[] = [];
      for (const v of values) if (v !== undefined) out.push(v);
      return out;
    }
    case "first": return values.length > 0 ? (values[0] ?? null) : null;
    case "last": return values.length > 0 ? (values[values.length - 1] ?? null) : null;
    default: return items.length; // $count
  }
}

function replaceAt(doc: JsonObj, parts: string[], value: JsonValue): JsonObj {
  const out = structuredClone(doc);
  let cur: JsonObj = out;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]] as JsonObj;
  }
  if (parts.length > 0) cur[parts[parts.length - 1]] = value;
  return out;
}
