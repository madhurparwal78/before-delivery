/**
 * Search: query parsing, matching, scoring (rule E), sorting and highlighting.
 */
import type { PoolClient } from "pg";
import { analyze, standardTokensAll } from "../shared/analyze";
import { collectLeaves, parseQuery, QueryError, type Node, type ParseCtx } from "../shared/query";
import type { FieldType, Filter, FlattenedEvent } from "../shared/types";
import { filterMatches, flatten, roundHalfAway, valuesOf } from "../shared/util";
import { STOPWORDS } from "../shared/analyze";
import { errors } from "./errors";
import {
  type EventRow,
  type GenerationRow,
  type StreamRow,
  fieldConflicts,
  listGenerations,
  readSegment,
  unionMapping,
} from "./events";
import { nowMs } from "./clock";

export interface SearchParams {
  stream: StreamRow;
  spaceSlug: string;
  q: string;
  fromMs: number;
  toMs: number;
  filters: Filter[];
  sort: string | null;
  size: number;
  offset: number;
  explain: boolean;
  id: string | null;
}

export interface LoadedEvent {
  row: EventRow;
  generation: GenerationRow;
}

const K1 = 1.2;
const B = 0.75;

export interface ScoringPart {
  value: number;
  leaf: string;
  field: string;
  idf: number;
  tf_norm: number;
  boost: number;
  text: string;
}

export interface MatchOutcome {
  matched: boolean;
  score: number;
  highlights: Record<string, [number, number][]>;
  parts: ScoringPart[];
}

/** Load the range's events from Postgres and archive segments. */
export async function loadRange(
  db: PoolClient,
  params: SearchParams,
): Promise<{ events: LoadedEvent[]; partial: boolean; skipped: number }> {
  const gens = await listGenerations(db, params.stream.id);
  const events: LoadedEvent[] = [];
  let partial = false;
  let skipped = 0;
  for (const g of gens) {
    if (g.phase === "delete") continue;
    if (g.phase === "archive") {
      try {
        const seg = await readSegment(g, params.spaceSlug, params.stream.name);
        for (const e of seg) {
          const t = e.ts.getTime();
          if (t >= params.fromMs && t < params.toMs) {
            events.push({
              row: { ...e, id: e.event_id, generation_id: g.id },
              generation: g,
            });
          }
        }
      } catch {
        partial = true;
        skipped += 1;
      }
      continue;
    }
    const res = await db.query<EventRow>(
      "SELECT id, generation_id, event_id, ts, fields, pipeline FROM events WHERE generation_id = $1 AND ts >= $2 AND ts < $3",
      [g.id, new Date(params.fromMs), new Date(params.toMs)],
    );
    for (const r of res.rows) events.push({ row: r, generation: g });
  }
  return { events, partial, skipped };
}

export interface PreparedQuery {
  node: Node | null;
  leaves: Node[];
  fieldTypes: Map<string, FieldType>;
  conflicts: Map<string, string>;
}

export async function prepareQuery(db: PoolClient, params: SearchParams): Promise<PreparedQuery> {
  const gens = await listGenerations(db, params.stream.id);
  const fieldTypes = await unionMapping(db, gens);
  const conflicts = await fieldConflicts(db, gens);
  if (params.q.trim() === "") {
    return { node: null, leaves: [], fieldTypes, conflicts };
  }
  const ctx: ParseCtx = { fieldTypes, nowMs: nowMs() };
  const node = parseQuery(params.q, ctx);
  return { node, leaves: collectLeaves(node), fieldTypes, conflicts };
}

/** A text leaf index over the loaded range (rule E: N and df over the whole range). */
interface LeafIndex {
  kind: "term" | "phrase";
  field: string;
  matches: Map<string, { tf: number; dl: number; offsets: [number, number][] }>;
  df: number;
  N: number;
  avgdl: number;
  idf: number;
}

async function buildLeafIndex(
  leaf: Node,
  fieldTypes: Map<string, FieldType>,
  events: LoadedEvent[],
): Promise<LeafIndex | null> {
  if (leaf.kind !== "term" && leaf.kind !== "phrase") return null;
  const field = leaf.field ?? "message";
  const type = fieldTypes.get(field);
  const isText = type !== "keyword";
  const matches = new Map<string, { tf: number; dl: number; offsets: [number, number][] }>();
  let N = 0;
  let dlTotal = 0;
  for (const le of events) {
    const flat = flatten(le.row.fields);
    const raw = flat[field];
    if (raw === undefined) continue;
    const vals = valuesOf(raw).filter((v): v is string => typeof v === "string");
    if (vals.length === 0) continue;
    let dl = 0;
    let tf = 0;
    const offsets: [number, number][] = [];
    for (const v of vals) {
      const tokens = analyze(isText ? "standard" : "keyword", v);
      if (isText) dl += tokens.length;
      if (leaf.kind === "term") {
        const needle = leaf.value.toLowerCase();
        if (isText) {
          for (const t of tokens) {
            if (t.token === needle) {
              tf += 1;
              offsets.push([t.start, t.end]);
            }
          }
        } else if (v === leaf.value) {
          tf += 1;
          dl = vals.length;
          offsets.push([0, v.length]);
        }
      } else if (isText) {
        // Phrases match by position with stopwords holding their slot (rule E).
        const phrasePositions = textPositionsOf(leaf.value);
        const all = standardTokensAll(v);
        for (let i = 0; i + phrasePositions.length <= all.length; i += 1) {
          const start = all[i].position;
          let ok = true;
          for (let j = 0; j < phrasePositions.length; j += 1) {
            const cand = all[i + j];
            const want = phrasePositions[j];
            if (STOPWORDS.has(cand.raw.toLowerCase())) {
              ok = false;
              break;
            }
            if (cand.token !== want.token || cand.position - start !== want.position - phrasePositions[0].position) {
              ok = false;
              break;
            }
          }
          if (ok) {
            tf += 1;
            for (let j = 0; j < phrasePositions.length; j += 1) {
              offsets.push([all[i + j].start, all[i + j].end]);
            }
          }
        }
      } else if (v === leaf.value) {
        tf += 1;
        dl = vals.length;
        offsets.push([0, v.length]);
      }
    }
    if (!isText) dl = vals.length;
    if (dl > 0) {
      N += 1;
      dlTotal += dl;
    }
    if (tf > 0) matches.set(le.row.event_id, { tf, dl, offsets });
  }
  const df = matches.size;
  const avgdl = N > 0 ? dlTotal / N : 0;
  const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
  return {
    kind: leaf.kind,
    field,
    matches,
    df,
    N,
    avgdl,
    idf,
  };
}

/** Does one filter match one event (rule G)? */
export function eventMatchesFilters(event: EventRow, filters: Filter[]): boolean {
  const flat = flatten(event.fields);
  return filters.every((f) => filterMatches(flat[f.field], f.op, f.value));
}

/** Evaluate a query node against one event. */
async function evalNode(
  node: Node,
  le: LoadedEvent,
  fieldTypes: Map<string, FieldType>,
  leafIndexes: Map<Node, LeafIndex>,
  underNot: boolean,
): Promise<boolean> {
  const flat = flatten(le.row.fields);
  switch (node.kind) {
    case "and":
      for (const c of node.children) {
        if (!(await evalNode(c, le, fieldTypes, leafIndexes, underNot))) return false;
      }
      return true;
    case "or":
      for (const c of node.children) {
        if (await evalNode(c, le, fieldTypes, leafIndexes, underNot)) return true;
      }
      return false;
    case "not": {
      const inner = await evalNode(node.child, le, fieldTypes, leafIndexes, true);
      return !inner;
    }
    case "scope": {
      const objects = scopeObjects(flat[node.field]);
      return objects.some((obj) => evalScoped(node.child, obj, fieldTypes, leafIndexes, underNot));
    }
    default:
      return evalLeafIn(node, flat, fieldTypes, leafIndexes, underNot);
  }
}

/** The objects of an array of objects, or one synthetic object for a plain value. */
function scopeObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => v !== null && typeof v === "object");
  }
  if (value !== null && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

/** Evaluate inside an object scope: fields are relative to the scope's field. */
function evalScoped(
  node: Node,
  obj: Record<string, unknown>,
  fieldTypes: Map<string, FieldType>,
  leafIndexes: Map<Node, LeafIndex>,
  underNot: boolean,
): boolean {
  switch (node.kind) {
    case "and":
      return node.children.every((c) => evalScoped(c, obj, fieldTypes, leafIndexes, underNot));
    case "or":
      return node.children.some((c) => evalScoped(c, obj, fieldTypes, leafIndexes, underNot));
    case "not":
      return !evalScoped(node.child, obj, fieldTypes, leafIndexes, true);
    case "scope": {
      const inner = scopeObjects(obj[node.field]);
      return inner.some((o) => evalScoped(node.child, o, fieldTypes, leafIndexes, underNot));
    }
    default: {
      const flat = flatten(obj);
      const scopeFields = new Map<string, FieldType>();
      for (const [k, v] of Object.entries(flat)) {
        scopeFields.set(k, inferScopeType(v));
      }
      return evalLeafIn(node, flat, scopeFields, leafIndexes, underNot);
    }
  }
}

function inferScopeType(v: unknown): FieldType {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "text";
}

/** A leaf against a flattened field map. */
function evalLeafIn(
  leaf: Node,
  flat: Record<string, unknown>,
  fieldTypes: Map<string, FieldType>,
  leafIndexes: Map<Node, LeafIndex>,
  underNot: boolean,
): boolean {
  const field = leaf.kind === "exists" || leaf.kind === "range" || leaf.kind === "values"
    ? leaf.field
    : leaf.kind === "and" || leaf.kind === "or" || leaf.kind === "not" || leaf.kind === "scope"
      ? "@timestamp"
      : leaf.field ?? "message";
  const type = fieldTypes.get(field) ?? "text";
  const raw = flat[field];
  switch (leaf.kind) {
    case "term":
      if (leaf.field === null) {
        return valueHasToken(raw, leaf.value);
      }
      if (type === "keyword") return valuesOf(raw).some((v) => v === leaf.value);
      if (type === "number") return valuesOf(raw).some((v) => v === Number(leaf.value));
      if (type === "boolean") return valuesOf(raw).some((v) => v === (leaf.value === "true"));
      if (type === "date") return valuesOf(raw).some((v) => v === leaf.value);
      return valueHasToken(raw, leaf.value);
    case "phrase": {
      if (type === "keyword") return valuesOf(raw).some((v) => v === leaf.value);
      return valueHasPhrase(raw, leaf.value);
    }
    case "wildcard": {
      const re = wildcardRe(leaf.pattern, type);
      return valuesOf(raw).some((v) => typeof v === "string" && re.test(v));
    }
    case "exists":
      return valuesOf(raw).some((v) => v !== null && v !== undefined);
    case "range": {
      const num = typeof leaf.value === "number" ? leaf.value : new Date(leaf.value).getTime();
      return valuesOf(raw).some((v) => {
        const vn = typeof v === "number" ? v : typeof v === "string" ? new Date(v).getTime() : NaN;
        if (isNaN(vn)) return false;
        if (leaf.op === ">") return vn > num;
        if (leaf.op === ">=") return vn >= num;
        if (leaf.op === "<") return vn < num;
        return vn <= num;
      });
    }
    case "values": {
      const index = leafIndexes.get(leaf);
      if (leaf.field === null) {
        return leaf.values.some((v) => valueHasToken(raw, v));
      }
      if (type === "keyword") return leaf.values.some((v) => valuesOf(raw).some((x) => x === v));
      if (type === "number") return leaf.values.some((v) => valuesOf(raw).some((x) => x === Number(v)));
      if (type === "boolean") return leaf.values.some((v) => valuesOf(raw).some((x) => x === (v === "true")));
      return leaf.values.some((v) => valueHasToken(raw, v));
    }
  }
  return false;
}

function valueHasToken(raw: unknown, needle: string): boolean {
  const lower = needle.toLowerCase();
  return valuesOf(raw).some((v) => {
    if (typeof v !== "string") return false;
    return analyze("standard", v).some((t) => t.token === lower);
  });
}

/**
 * A phrase matches where its tokens sit at the same relative positions they have in
 * the phrase, with stopwords holding their slot (rule E). The analysis keeps the
 * position of every run, dropped stopwords included, so positions compare directly.
 */
function valueHasPhrase(raw: unknown, phrase: string): boolean {
  const phrasePositions = phrasePositionsOf(phrase);
  if (phrasePositions.length === 0) return true;
  return valuesOf(raw).some((v) => {
    if (typeof v !== "string") return false;
    const textPositions = textPositionsOf(v);
    outer: for (let i = 0; i + phrasePositions.length <= textPositions.length; i += 1) {
      const start = textPositions[i].position;
      for (let j = 0; j < phrasePositions.length; j += 1) {
        if (textPositions[i + j].token !== phrasePositions[j].token) continue outer;
        if (textPositions[i + j].position - start !== phrasePositions[j].position - phrasePositions[0].position) continue outer;
      }
      return true;
    }
    return false;
  });
}

/** Analysed tokens with positions, including the positions of dropped stopwords. */
interface PositionedToken {
  token: string;
  position: number;
}

function textPositionsOf(value: string): PositionedToken[] {
  // Kept tokens with their true positions: stopwords are dropped but still hold a slot.
  const all = standardTokensAll(value);
  return all.filter((t) => !STOPWORDS.has(t.raw.toLowerCase())).map((t) => ({ token: t.token, position: t.position }));
}

function phrasePositionsOf(phrase: string): PositionedToken[] {
  return textPositionsOf(phrase);
}

export function wildcardRe(pattern: string, type: FieldType | undefined): RegExp {
  const parts = pattern.split("*");
  const re = parts.map(escapeRe).join(".*");
  return new RegExp(type === "keyword" ? `^${re}$` : re);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Run the search and return the scored, sorted results.
 */
export async function runSearch(
  db: PoolClient,
  params: SearchParams,
): Promise<{
  total: number;
  events: FlattenedEvent[];
  partial: boolean;
  skipped_generations: number;
  ordered: LoadedEvent[];
  scores: ScoreMap;
}> {
  const { events, partial, skipped } = await loadRange(db, params);
  const prepared = await prepareQuery(db, params);
  const filtered = events.filter((le) => eventMatchesFilters(le.row, params.filters));
  // Leaf indexes are built over the whole time range, so N and df ignore the query and filters.
  const leafIndexes = new Map<Node, LeafIndex>();
  for (const leaf of prepared.leaves) {
    const idx = await buildLeafIndex(leaf, prepared.fieldTypes, events);
    if (idx) leafIndexes.set(leaf, idx);
  }

  const scores: ScoreMap = new Map();
  const matched: LoadedEvent[] = [];
  for (const le of filtered) {
    let ok = true;
    if (prepared.node) {
      ok = await evalNode(prepared.node, le, prepared.fieldTypes, leafIndexes, false);
    }
    if (ok) matched.push(le);
  }

  // Scoring (rule E).
  for (const le of matched) {
    let total = 0;
    const parts: ScoringPart[] = [];
    const highlights: Record<string, [number, number][]> = {};
    for (const leaf of prepared.leaves) {
      const idx = leafIndexes.get(leaf);
      if (!idx) continue;
      const m = idx.matches.get(le.row.event_id);
      if (!m) continue;
      const field = idx.field;
      const type = prepared.fieldTypes.get(field);
      if (type !== "text" && type !== undefined) continue;
      if (leaf.kind !== "term" && leaf.kind !== "phrase") continue;
      const boost = field === "message" ? 2.0 : 1.0;
      const tf = m.tf;
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (m.dl / (idx.avgdl > 0 ? idx.avgdl : 1))));
      const value = idx.idf * tfNorm * boost;
      const rounded = roundHalfAway(value, 4);
      total += rounded;
      parts.push({
        value: rounded,
        leaf: leaf.kind === "phrase" ? `"${leaf.value}"` : leaf.value,
        field,
        idf: idx.idf,
        tf_norm: tfNorm,
        boost,
        text: `${leaf.kind === "phrase" ? `"${leaf.value}"` : leaf.value} in ${field}: ${fmtNum(rounded)} = idf ${fmtNum(idx.idf)} x tf_norm ${fmtNum(tfNorm)} x boost ${fmtNum(boost)}`,
      });
      const hl = highlights[field] ?? [];
      hl.push(...m.offsets);
      highlights[field] = hl;
    }
    scores.set(le.row.event_id, { score: roundHalfAway(total, 4), parts, highlights });
  }

  sortResults(matched, params, prepared.conflicts, scores, prepared.leaves.length > 0);
  return {
    total: matched.length,
    events: matched.slice(params.offset, params.offset + params.size).map((le) =>
      toEvent(le, scores.get(le.row.event_id) ?? null),
    ),
    partial,
    skipped_generations: skipped,
    ordered: matched,
    scores,
  };
}

function fmtNum(v: number): string {
  const r = roundHalfAway(v, 4);
  let s = r.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "" ? "0" : s;
}

export type ScoreMap = Map<
  string,
  { score: number; parts: ScoringPart[]; highlights: Record<string, [number, number][]> }
>;

export function sortResults(
  matched: LoadedEvent[],
  params: SearchParams,
  conflicts: Map<string, string>,
  scores: ScoreMap,
  hasScoring: boolean,
): void {
  const cmp = (a: LoadedEvent, b: LoadedEvent): number => {
    if (params.sort) {
      const [col, dir] = params.sort.split(":");
      if (conflicts.has(col)) {
        throw errors.fieldConflict(conflicts.get(col)!);
      }
      const av = flatten(a.row.fields)[col];
      const bv = flatten(b.row.fields)[col];
      const missing = (v: unknown): boolean => v === undefined || v === null;
      if (missing(av) && !missing(bv)) return 1;
      if (!missing(av) && missing(bv)) return -1;
      let c = compare(av, bv);
      if (dir === "desc") c = -c;
      if (c !== 0) return c;
      return tiebreak(a, b);
    }
    if (hasScoring) {
      const sa = scores.get(a.row.event_id)?.score ?? 0;
      const sb = scores.get(b.row.event_id)?.score ?? 0;
      if (sb !== sa) return sb - sa;
    }
    return tiebreak(a, b);
  };
  matched.sort(cmp);
}

function tiebreak(a: LoadedEvent, b: LoadedEvent): number {
  const ta = a.row.ts.getTime();
  const tb = b.row.ts.getTime();
  if (tb !== ta) return tb - ta;
  return a.row.event_id < b.row.event_id ? -1 : a.row.event_id > b.row.event_id ? 1 : 0;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function toEvent(
  le: LoadedEvent,
  score: { score: number; parts: ScoringPart[]; highlights: Record<string, [number, number][]> } | null,
): FlattenedEvent {
  const flat = flatten(le.row.fields);
  return {
    _id: le.row.event_id,
    "@timestamp": le.row.ts.toISOString(),
    _generation: le.generation.number,
    _phase: le.generation.phase === "delete" ? "warm" : le.generation.phase,
    _pipeline: le.row.pipeline,
    _score: score && score.parts.length > 0 ? score.score : null,
    fields: flat,
    highlights: score?.highlights ?? {},
  };
}
