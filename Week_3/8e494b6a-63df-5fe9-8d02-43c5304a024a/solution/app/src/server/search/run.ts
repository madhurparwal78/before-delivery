// Running a search: limits, parse, load, evaluate, filter, sort; and shaping matched events for the API.
import { config } from "../config";
import { errors } from "../errors";
import { now } from "../clock";
import { parseIsoInstant } from "../../shared/time";
import { Evaluator, WorkMeter, type Match } from "./evaluate";
import { apiEvent, type ApiEvent, type Explanation, type Mark, type StoredEvent } from "./events";
import { eventValues, matchesFilter, type Filter } from "./filters";
import { checkLimits, parseQuery } from "./parser";
import { conflictSentence, loadUniverse, schemaOf, type StreamContext, type Universe } from "./context";
import { partText, showNumber, totalScore, type ScoredPart } from "./scoring";
import type { Scalar } from "./fields";

export interface QueryRequest {
  q: string;
  filters: Filter[];
  from: number;
  to: number;
}

export interface Matched {
  event: StoredEvent;
  parts: ScoredPart[];
  marks: Mark[];
}

interface QueryOutcome {
  universe: Universe;
  matched: Matched[];
  scored: boolean;
}

const NO_MATCH: Match = { parts: [], marks: [] };

export async function runQuery(ctx: StreamContext, request: QueryRequest): Promise<QueryOutcome> {
  const { settings } = config;
  const meter = new WorkMeter(settings.queryWorkMax, settings.queryBudgetMs);
  const nowMs = now();
  const scored = request.q !== "";
  if (scored) checkLimits(request.q);
  const ast = scored ? parseQuery(request.q, schemaOf(ctx), nowMs) : null;
  const universe = await loadUniverse(ctx, request.from, request.to);
  meter.checkTime();
  const matches = ast ? await new Evaluator({ events: universe.events, index: universe.index, types: ctx.types, nowMs, meter }).run(ast) : null;
  const matched: Matched[] = [];
  for (const event of universe.events) {
    const match = matches ? matches.get(event.id) : NO_MATCH;
    if (!match || !request.filters.every((filter) => matchesFilter(event, filter))) continue;
    matched.push({ event, parts: match.parts, marks: match.marks });
  }
  return { universe, matched, scored };
}

const byTimestampThenId = (a: Matched, b: Matched): number =>
  b.event.ts - a.event.ts || (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0);

function sortKey(values: Scalar[], descending: boolean): Scalar | undefined {
  const keyed = values.map((value) => (typeof value === "string" ? (parseIsoInstant(value) ?? value) : value));
  if (keyed.length === 0) return undefined;
  return keyed.reduce((best, value) => ((descending ? value > best : value < best) ? value : best));
}

interface SortSpec {
  field: string;
  descending: boolean;
}

export function parseSort(text: string | null): SortSpec | null | "invalid" {
  if (!text) return null;
  const match = /^(.+):(asc|desc)$/.exec(text);
  return match ? { field: match[1] as string, descending: match[2] === "desc" } : "invalid";
}

/** Score order with a query, timestamp order without; an explicit sort puts missing values last. */
export function sortMatched(ctx: StreamContext, matched: Matched[], sort: SortSpec | null, request: QueryRequest, scored: boolean): Matched[] {
  if (sort) {
    const sentence = conflictSentence(ctx, sort.field, request.from, request.to);
    if (sentence) throw errors.fieldConflict(sentence);
    const keys = new Map(matched.map((m) => [m, sortKey(eventValues(m.event, sort.field), sort.descending)]));
    return [...matched].sort((a, b) => {
      const x = keys.get(a);
      const y = keys.get(b);
      if (x === undefined || y === undefined) return x === y ? byTimestampThenId(a, b) : x === undefined ? 1 : -1;
      const order = x < y ? -1 : x > y ? 1 : 0;
      return (sort.descending ? -order : order) || byTimestampThenId(a, b);
    });
  }
  if (!scored) return [...matched].sort(byTimestampThenId);
  const scores = new Map(matched.map((m) => [m, totalScore(m.parts)]));
  return [...matched].sort((a, b) => (scores.get(b) as number) - (scores.get(a) as number) || byTimestampThenId(a, b));
}

function explanationOf(parts: ScoredPart[]): Explanation {
  const value = totalScore(parts);
  return {
    value,
    text: `Score ${showNumber(value)}`,
    children: parts.map((part) => ({ value: part.value, leaf: part.leaf, field: part.field, idf: part.idf, tf_norm: part.tfNorm, boost: part.boost, text: partText(part) })),
  };
}

export function shape(item: Matched, scored: boolean, explain: boolean): ApiEvent {
  return apiEvent(item.event, scored ? totalScore(item.parts) : null, item.marks, explain ? explanationOf(item.parts) : undefined);
}
