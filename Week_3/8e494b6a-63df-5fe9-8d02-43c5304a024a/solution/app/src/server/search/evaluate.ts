// Evaluates a parsed Spoor Query over the events of a time range, counting work and scoring text leaves.
import { ApiError } from "../errors";
import { config } from "../config";
import { parseIsoInstant, parseQueryDate } from "../../shared/time";
import { analyze, type Token } from "./analysis";
import { eventValues } from "./filters";
import { flatten, isPlainObject, type Doc, type FieldType, type Scalar } from "./fields";
import type { Mark, StoredEvent } from "./events";
import type { TermIndex, PostingHit } from "./index";
import type { Leaf, QueryNode } from "./parser";
import { scorePart, type ScoredPart } from "./scoring";

export class WorkMeter {
  used = 0;
  private readonly deadline: number;

  constructor(private readonly max: number, budgetMs: number) {
    this.deadline = Date.now() + budgetMs;
  }

  /** One unit per term looked up and per posting or dictionary entry examined. */
  add(units: number): void {
    this.used += units;
    this.checkTime();
    if (this.used >= this.max) throw new ApiError(422, "query_work_limit", `Query stopped: work limit of ${this.max} reached.`);
  }

  remaining(): number {
    return Math.max(1, this.max - this.used);
  }

  checkTime(): void {
    if (Date.now() > this.deadline) {
      throw new ApiError(422, "query_time_budget", `Query stopped: time budget of ${config.settings.queryBudgetMs} ms reached.`);
    }
  }
}

export interface Match {
  parts: ScoredPart[];
  marks: Mark[];
}
type Matches = Map<string, Match>;

interface EvalInput {
  events: StoredEvent[];
  index: TermIndex;
  types: Map<number, Map<string, FieldType>>;
  nowMs: number;
  meter: WorkMeter;
}

const EMPTY: Match = { parts: [], marks: [] };
const YIELD_EVERY = 4000;
const yieldToServer = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function literal(leaf: Leaf): string {
  return leaf.parts.map((part) => part ?? "*").join("");
}

function wildcardRegex(parts: Array<string | null>, lower: boolean): RegExp {
  const source = parts.map((part) => (part === null ? ".*" : (lower ? part.toLowerCase() : part).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${source}$`, "s");
}

const isWildcard = (leaf: Leaf): boolean => !leaf.quoted && leaf.parts.includes(null);

/** Start positions where the phrase tokens sit at their relative positions; stopwords hold their slot. */
function phraseStarts(tokens: Token[], positionsOf: (token: string) => number[] | undefined): number[] {
  const first = tokens[0];
  if (!first) return [];
  const starts: number[] = [];
  for (const start of positionsOf(first.token) ?? []) {
    if (tokens.every((token) => positionsOf(token.token)?.includes(start + token.position - first.position))) starts.push(start);
  }
  return starts;
}

function compare(have: number, op: string, want: number): boolean {
  if (op === ":") return have === want;
  return op === ">" ? have > want : op === ">=" ? have >= want : op === "<" ? have < want : have <= want;
}

/** One leaf against the values of one event field, by the field's type in that generation. */
function valuesMatchLeaf(values: Scalar[], type: FieldType, leaf: Leaf, nowMs: number): boolean {
  if (leaf.exists) return values.length > 0;
  const text = literal(leaf);
  switch (type) {
    case "number":
      return values.some((value) => typeof value === "number" && compare(value, leaf.op, Number(text)));
    case "date": {
      const want = parseQueryDate(text, nowMs);
      return want !== null && values.some((value) => {
        const have = typeof value === "string" ? parseIsoInstant(value) : null;
        return have !== null && compare(have, leaf.op, want);
      });
    }
    case "boolean":
      return leaf.op === ":" && values.some((value) => value === (text === "true"));
    case "keyword": {
      if (leaf.op !== ":") return false;
      const test = isWildcard(leaf) ? wildcardRegex(leaf.parts, false) : null;
      return values.some((value) => typeof value === "string" && (test ? test.test(value) : value === text));
    }
    case "text": {
      if (leaf.op !== ":") return false;
      if (isWildcard(leaf)) {
        const test = wildcardRegex(leaf.parts, true);
        return values.some((value) => typeof value === "string" && analyze("standard", value).some((token) => test.test(token.token)));
      }
      const wanted = analyze("standard", text);
      if (wanted.length === 0) return false;
      return values.some((value) => {
        if (typeof value !== "string") return false;
        const seen = new Map<string, number[]>();
        for (const token of analyze("standard", value)) seen.set(token.token, [...(seen.get(token.token) ?? []), token.position]);
        return phraseStarts(wanted, (token) => seen.get(token)).length > 0;
      });
    }
  }
}

function objectsAt(value: unknown, segments: string[]): Doc[] {
  if (Array.isArray(value)) return value.flatMap((item) => objectsAt(item, segments));
  if (!isPlainObject(value)) return [];
  const [head, ...rest] = segments;
  return head === undefined ? [value] : objectsAt(value[head], rest);
}

function typeIn(input: EvalInput, generation: number, field: string): FieldType | undefined {
  if (field === "@timestamp") return "date";
  if (field === "_id") return "keyword";
  return input.types.get(generation)?.get(field);
}

export class Evaluator {
  private readonly lengthsCache = new Map<string, ReturnType<TermIndex["lengths"]>>();

  constructor(private readonly input: EvalInput) {}

  run(node: QueryNode, scoring = true): Promise<Matches> {
    switch (node.kind) {
      case "and":
        return this.all(node.children, scoring);
      case "or":
        return this.any(node.children, scoring);
      case "not":
        return this.negate(node.child);
      case "scope":
        return this.scope(node);
      case "leaf":
        return this.leaf(node, scoring);
    }
  }

  private async all(children: QueryNode[], scoring: boolean): Promise<Matches> {
    let result: Matches | null = null;
    for (const child of children) {
      const matches = await this.run(child, scoring);
      if (result === null) {
        result = matches;
        continue;
      }
      const joined: Matches = new Map();
      for (const [id, match] of result) {
        const other = matches.get(id);
        if (other) joined.set(id, { parts: [...match.parts, ...other.parts], marks: [...match.marks, ...other.marks] });
      }
      result = joined;
      if (result.size === 0) break;
    }
    return result ?? new Map();
  }

  private async any(children: QueryNode[], scoring: boolean): Promise<Matches> {
    const result: Matches = new Map();
    for (const child of children) {
      for (const [id, match] of await this.run(child, scoring)) {
        const have = result.get(id);
        result.set(id, have ? { parts: [...have.parts, ...match.parts], marks: [...have.marks, ...match.marks] } : match);
      }
    }
    return result;
  }

  private async negate(child: QueryNode): Promise<Matches> {
    const excluded = await this.run(child, false);
    const result: Matches = new Map();
    for (const event of this.input.events) if (!excluded.has(event.id)) result.set(event.id, EMPTY);
    return result;
  }

  private async leaf(leaf: Leaf, scoring: boolean): Promise<Matches> {
    const groups = new Map<FieldType, number[]>();
    for (const generation of this.input.types.keys()) {
      const type = typeIn(this.input, generation, leaf.field);
      if (type) groups.set(type, [...(groups.get(type) ?? []), generation]);
    }
    const result: Matches = new Map();
    for (const [type, generations] of groups) {
      const indexed = (type === "text" || type === "keyword") && !leaf.exists && leaf.op === ":" && leaf.field !== "_id";
      const found = indexed ? await this.indexed(leaf, type, generations, scoring) : await this.scan(leaf, type, generations);
      for (const [id, match] of found) result.set(id, match);
    }
    return result;
  }

  private async scan(leaf: Leaf, type: FieldType, generations: number[]): Promise<Matches> {
    const result: Matches = new Map();
    let visited = 0;
    for (const event of this.input.events) {
      if (++visited % YIELD_EVERY === 0) {
        this.input.meter.checkTime();
        await yieldToServer();
      }
      if (generations.includes(event.generation) && valuesMatchLeaf(eventValues(event, leaf.field), type, leaf, this.input.nowMs)) {
        result.set(event.id, EMPTY);
      }
    }
    return result;
  }

  private lengths(field: string): ReturnType<TermIndex["lengths"]> {
    let cached = this.lengthsCache.get(field);
    if (!cached) {
      cached = this.input.index.lengths(field);
      this.lengthsCache.set(field, cached);
    }
    return cached;
  }

  private async lookup(field: string, term: string, generations: number[]): Promise<PostingHit[]> {
    const hits = await this.input.index.postings(field, term, generations);
    this.input.meter.add(1 + hits.length);
    return hits;
  }

  private async matchingTerms(field: string, generations: number[], regex: RegExp): Promise<string[]> {
    const { meter } = this.input;
    const entries = await this.input.index.dictionary(field, generations, meter.remaining());
    meter.add(entries.length);
    return entries.filter((term) => regex.test(term));
  }

  private async indexed(leaf: Leaf, type: "text" | "keyword", generations: number[], scoring: boolean): Promise<Matches> {
    const { field } = leaf;
    const result: Matches = new Map();
    const mark = (id: string, positions: number[]): void => {
      const have = result.get(id);
      const marks = type === "text" ? [{ field, positions }] : [];
      result.set(id, have ? { parts: have.parts, marks: [...have.marks, ...marks] } : { parts: [], marks });
    };
    if (isWildcard(leaf)) {
      for (const term of await this.matchingTerms(field, generations, wildcardRegex(leaf.parts, type === "text"))) {
        for (const hit of await this.lookup(field, term, generations)) mark(hit.id, hit.positions);
      }
      return result;
    }
    if (type === "keyword") {
      for (const hit of await this.lookup(field, literal(leaf), generations)) mark(hit.id, []);
      return result;
    }
    const tokens = analyze("standard", literal(leaf));
    const first = tokens[0];
    if (!first) return result;
    const distinct = [...new Set(tokens.map((token) => token.token))];
    const byToken = new Map<string, Map<string, number[]>>();
    for (const token of distinct) {
      const perEvent = new Map<string, number[]>();
      for (const hit of await this.lookup(field, token, generations)) perEvent.set(hit.id, hit.positions);
      byToken.set(token, perEvent);
    }
    const occurrences = new Map<string, number[]>();
    for (const id of byToken.get(first.token)?.keys() ?? []) {
      const starts = phraseStarts(tokens, (token) => byToken.get(token)?.get(id));
      if (starts.length > 0) occurrences.set(id, starts);
    }
    const stats = scoring ? await this.lengths(field) : null;
    const label = leaf.quoted || tokens.length > 1 ? `"${literal(leaf)}"` : first.token;
    for (const [id, starts] of occurrences) {
      const positions = starts.flatMap((start) => tokens.map((token) => start + token.position - first.position));
      mark(id, positions);
      if (stats && stats.count > 0) {
        const part = scorePart(label, field, stats.count, occurrences.size, starts.length, stats.byEvent.get(id) ?? 0, stats.total / stats.count);
        (result.get(id) as Match).parts.push(part);
      }
    }
    return result;
  }

  private async scope(node: Extract<QueryNode, { kind: "scope" }>): Promise<Matches> {
    const result: Matches = new Map();
    const segments = node.path.split(".");
    let visited = 0;
    for (const event of this.input.events) {
      if (++visited % YIELD_EVERY === 0) {
        this.input.meter.checkTime();
        await yieldToServer();
      }
      if (objectsAt(event.doc, segments).some((object) => this.holds(node.child, node.path, object, event))) result.set(event.id, EMPTY);
    }
    return result;
  }

  /** Whether one object of an array satisfies a condition tree; its fields are relative to the scope path. */
  private holds(node: QueryNode, base: string, object: Doc, event: StoredEvent): boolean {
    switch (node.kind) {
      case "and":
        return node.children.every((child) => this.holds(child, base, object, event));
      case "or":
        return node.children.some((child) => this.holds(child, base, object, event));
      case "not":
        return !this.holds(node.child, base, object, event);
      case "scope": {
        const inner = node.path.slice(base.length + 1).split(".");
        return objectsAt(object, inner).some((nested) => this.holds(node.child, node.path, nested, event));
      }
      case "leaf": {
        const type = typeIn(this.input, event.generation, node.field);
        const relative = node.field.slice(base.length + 1);
        return type !== undefined && valuesMatchLeaf(flatten(object).get(relative) ?? [], type, node, this.input.nowMs);
      }
    }
  }
}
