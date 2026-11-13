import { settings } from '../env.js';
import { fail } from '../errors.js';
import {
  dictionaryTokens,
  docLengthsFor,
  generationsOf,
  loadRange,
  mappingsOf,
  postingsFor,
  resolveFieldsOf,
  buildPostings,
  type GenerationRow,
  type LoadedEvent,
  type PostingEntry,
  type StreamRow,
} from '../store.js';
import { round, upTo } from './numbers.js';
import {
  compareValues,
  isIsoDateString,
  numericOf,
  valuesOf,
  type EventFields,
  type FieldType,
  type ResolvedField,
} from './mapping.js';
import {
  checkQueryLimits,
  hasScoringLeaf,
  parseQuery,
  wildcardToRegExp,
  type FieldLookup,
  type QueryNode,
} from './query.js';
import { analyze } from './analyze.js';

export type FilterOp = 'eq' | 'ne' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';

export type Filter = { field: string; op: FilterOp; value?: unknown };

const K1 = 1.2;
const B = 0.75;

export class Budget {
  private work = 0;
  private readonly deadline: number;

  constructor() {
    this.deadline = Date.now() + settings.queryBudgetMs;
  }

  spend(units: number): void {
    this.work += units;
    if (this.work > settings.queryWorkMax) throw fail.queryWorkLimit();
    if (Date.now() > this.deadline) throw fail.queryTimeBudget();
  }
}

type LeafHit = { tf: number; offsets: [number, number][] };

type TextLeaf = {
  field: string;
  kind: 'term' | 'phrase' | 'wildcard';
  display: string;
  scoring: boolean;
  hits: Map<string, LeafHit>;
};

export type MatchContext = {
  stream: StreamRow;
  fromMs: number;
  toMs: number;
  nowMs: number;
  fields: ResolvedField[];
  typeOf: (field: string) => FieldType | undefined;
  lookup: FieldLookup;
  conflictOf: (field: string) => string | undefined;
  generations: GenerationRow[];
};

export type Explanation = {
  value: number;
  text: string;
  children: {
    value: number;
    leaf: string;
    field: string;
    idf: number;
    tf_norm: number;
    boost: number;
    text: string;
  }[];
};

export type Hit = {
  event: LoadedEvent;
  score: number | null;
  highlights: Record<string, [number, number][]>;
  explanation?: Explanation;
};

export type MatchOutcome = {
  hits: Hit[];
  total: number;
  partial: boolean;
  skippedGenerations: number;
  context: MatchContext;
  scored: boolean;
};

export type MatchRequest = {
  stream: StreamRow;
  q: string;
  fromMs: number;
  toMs: number;
  filters: Filter[];
  sort?: string | null;
  nowMs: number;
  explain?: boolean;
  budget?: Budget;
};

export async function streamContext(
  stream: StreamRow,
  fromMs: number,
  toMs: number,
): Promise<{ context: MatchContext; generations: GenerationRow[] }> {
  const generations = (await generationsOf(stream.id)).filter(
    (generation) => generation.phase !== 'deleted',
  );
  const mappings = await mappingsOf(stream.id);
  const covered = generations
    .filter((generation) => {
      if (generation.eventCount === 0) return true;
      const minTs = generation.minTsMs ?? Number.NEGATIVE_INFINITY;
      const maxTs = generation.maxTsMs ?? Number.POSITIVE_INFINITY;
      return maxTs >= fromMs && minTs < toMs;
    })
    .map((generation) => generation.number);
  const fields = resolveFieldsOf(mappings, covered);
  const byField = new Map(fields.map((field) => [field.field, field]));
  const context: MatchContext = {
    stream,
    fromMs,
    toMs,
    nowMs: 0,
    fields,
    typeOf: (field) => byField.get(field)?.type,
    lookup: {
      typeOf: (field) => byField.get(field)?.type,
      hasObject: (field) => fields.some((entry) => entry.field.startsWith(`${field}.`)),
    },
    conflictOf: (field) => byField.get(field)?.conflict,
    generations,
  };
  return { context, generations };
}

function matchesFilter(fields: EventFields, filter: Filter, typeOf: (field: string) => FieldType | undefined): boolean {
  const values = valuesOf(fields[filter.field]);
  if (filter.op === 'exists') return values.length > 0;
  if (filter.op === 'eq') return values.some((value) => sameValue(value, filter.value));
  if (filter.op === 'ne') return !values.some((value) => sameValue(value, filter.value));
  const type = typeOf(filter.field) ?? 'number';
  const bound = toNumeric(filter.value, type);
  if (bound === null) return false;
  return values.some((value) => {
    const numeric = numericOf(value, type);
    if (numeric === null) return false;
    switch (filter.op) {
      case 'gt':
        return numeric > bound;
      case 'gte':
        return numeric >= bound;
      case 'lt':
        return numeric < bound;
      case 'lte':
        return numeric <= bound;
      default:
        return false;
    }
  });
}

function toNumeric(value: unknown, type: FieldType): number | null {
  if (type === 'date') {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && isIsoDateString(value)) return Date.parse(value);
    return null;
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function sameValue(left: string | number | boolean, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'string') return left === Number(right);
  if (typeof left === 'boolean' && typeof right === 'string') return String(left) === right;
  if (typeof left === 'string' && typeof right === 'number') return Number(left) === right;
  if (isIsoDateString(left) && typeof right === 'string' && isIsoDateString(right)) {
    return Date.parse(left) === Date.parse(right);
  }
  return left === (right as string | number | boolean);
}

/** Evaluates a leaf straight against field values; used for non-text leaves and object scopes. */
function leafMatchesFields(node: QueryNode, fields: EventFields, nowMs: number): boolean {
  switch (node.kind) {
    case 'exists':
      return valuesOf(fields[node.field]).length > 0;
    case 'term': {
      const values = valuesOf(fields[node.field]);
      if (node.type === 'text') {
        return values.some((value) =>
          typeof value === 'string' &&
          analyze('standard', value).some((token) => token.token === node.value),
        );
      }
      return values.some((value) => sameValue(value, node.value));
    }
    case 'phrase': {
      const values = valuesOf(fields[node.field]);
      return values.some(
        (value) =>
          typeof value === 'string' &&
          phraseOccurrences(analyze('standard', value), node.tokens, node.slots).length > 0,
      );
    }
    case 'range': {
      const values = valuesOf(fields[node.field]);
      return values.some((value) => {
        const numeric = numericOf(value, node.type);
        if (numeric === null) return false;
        switch (node.op) {
          case 'gt':
            return numeric > node.value;
          case 'gte':
            return numeric >= node.value;
          case 'lt':
            return numeric < node.value;
          case 'lte':
            return numeric <= node.value;
          default:
            return false;
        }
      });
    }
    case 'wildcard': {
      const pattern = wildcardToRegExp(node.pattern.toLowerCase());
      const values = valuesOf(fields[node.field]);
      if (node.type === 'keyword') {
        return values.some((value) => pattern.test(String(value).toLowerCase()));
      }
      return values.some(
        (value) =>
          typeof value === 'string' &&
          analyze('standard', value).some((token) => pattern.test(token.token)),
      );
    }
    case 'and':
      return node.children.every((child) => leafMatchesFields(child, fields, nowMs));
    case 'or':
      return node.children.some((child) => leafMatchesFields(child, fields, nowMs));
    case 'not':
      return !leafMatchesFields(node.child, fields, nowMs);
    case 'scope':
      return scopeMatches(node, fields, nowMs);
    default:
      return false;
  }
}

function scopeMatches(node: QueryNode & { kind: 'scope' }, fields: EventFields, nowMs: number): boolean {
  const objects = objectsOfScope(node.field, fields);
  return objects.some((object) => leafMatchesFields(node.child, object, nowMs));
}

/** One object of an array field at a time, so a scope needs one object to meet all of it. */
function objectsOfScope(field: string, fields: EventFields): EventFields[] {
  const prefix = `${field}.`;
  const entries = Object.entries(fields).filter(([name]) => name.startsWith(prefix));
  if (entries.length === 0) return [];
  const width = Math.max(...entries.map(([, value]) => valuesOf(value).length));
  const objects: EventFields[] = [];
  for (let index = 0; index < width; index += 1) {
    const object: EventFields = {};
    for (const [name, value] of entries) {
      const values = valuesOf(value);
      if (index < values.length) object[name] = values[index];
    }
    objects.push(object);
  }
  return objects;
}

/** A phrase matches where its tokens sit at their relative slots, stopwords included. */
export function phraseOccurrences(
  tokens: { token: string; position: number; start: number; end: number }[],
  phrase: string[],
  slots: number[],
): { start: number; end: number }[][] {
  const byPosition = new Map<number, { token: string; start: number; end: number }[]>();
  for (const token of tokens) {
    const list = byPosition.get(token.position) ?? [];
    list.push({ token: token.token, start: token.start, end: token.end });
    byPosition.set(token.position, list);
  }
  const occurrences: { start: number; end: number }[][] = [];
  const positions = [...byPosition.keys()].sort((left, right) => left - right);
  for (const start of positions) {
    const spans: { start: number; end: number }[] = [];
    let ok = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      const candidates = byPosition.get(start + slots[offset] - slots[0]) ?? [];
      const found = candidates.find((candidate) => candidate.token === phrase[offset]);
      if (!found) {
        ok = false;
        break;
      }
      spans.push({ start: found.start, end: found.end });
    }
    if (ok) occurrences.push(spans);
  }
  return occurrences;
}

type Resolver = {
  leaves: Map<QueryNode, TextLeaf>;
  dlByField: Map<string, Map<string, number>>;
};

function collectTextLeaves(
  node: QueryNode | null,
  negated: boolean,
  out: { node: QueryNode; scoring: boolean }[],
  inScope: boolean,
): void {
  if (!node) return;
  switch (node.kind) {
    case 'and':
    case 'or':
      for (const child of node.children) collectTextLeaves(child, negated, out, inScope);
      return;
    case 'not':
      collectTextLeaves(node.child, true, out, inScope);
      return;
    case 'scope':
      collectTextLeaves(node.child, negated, out, true);
      return;
    case 'term':
      if (node.type === 'text' && !inScope) out.push({ node, scoring: !negated });
      return;
    case 'phrase':
      if (!inScope) out.push({ node, scoring: !negated });
      return;
    case 'wildcard':
      if (node.type === 'text' && !inScope) out.push({ node, scoring: false });
      return;
    default:
      return;
  }
}

async function resolveTextLeaves(
  node: QueryNode | null,
  stream: StreamRow,
  candidates: LoadedEvent[],
  archiveRows: Map<string, LoadedEvent>,
  budget: Budget,
): Promise<Resolver> {
  const collected: { node: QueryNode; scoring: boolean }[] = [];
  collectTextLeaves(node, false, collected, false);
  const leaves = new Map<QueryNode, TextLeaf>();
  const dlByField = new Map<string, Map<string, number>>();
  if (collected.length === 0) return { leaves, dlByField };
  const candidateRows = new Set(candidates.map((event) => event.row));

  const archivePostings = new Map<string, Map<string, PostingEntry>>();
  const archiveDl = new Map<string, number>();
  const archiveIndex = (field: string): Map<string, Map<string, PostingEntry>> => {
    for (const event of archiveRows.values()) {
      const key = `${event.row}|${field}`;
      if (archivePostings.has(key)) continue;
      const value = event.fields[field];
      if (value === undefined) continue;
      const built = buildPostings(value);
      const map = new Map<string, PostingEntry>();
      for (const posting of built.tokens) {
        map.set(posting.token, {
          tf: posting.positions.length,
          positions: posting.positions,
          starts: posting.starts,
          ends: posting.ends,
        });
      }
      archivePostings.set(key, map);
      archiveDl.set(key, built.dl);
    }
    return archivePostings;
  };

  const tokenCache = new Map<string, Map<string, PostingEntry>>();
  const lookup = async (field: string, token: string): Promise<Map<string, PostingEntry>> => {
    const cacheKey = `${field}\u0000${token}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) return cached;
    budget.spend(1);
    const stored = await postingsFor(stream.id, field, token);
    const out = new Map<string, PostingEntry>();
    for (const [row, entry] of stored) {
      budget.spend(1);
      if (candidateRows.has(row)) out.set(row, entry);
    }
    archiveIndex(field);
    for (const event of archiveRows.values()) {
      if (!candidateRows.has(event.row)) continue;
      const entry = archivePostings.get(`${event.row}|${field}`)?.get(token);
      if (entry) {
        budget.spend(1);
        out.set(event.row, entry);
      }
    }
    tokenCache.set(cacheKey, out);
    return out;
  };

  const dictionaryOf = async (field: string): Promise<string[]> => {
    const stored = await dictionaryTokens(stream.id, field);
    budget.spend(stored.length);
    archiveIndex(field);
    const tokens = new Set(stored);
    for (const event of archiveRows.values()) {
      for (const token of archivePostings.get(`${event.row}|${field}`)?.keys() ?? []) {
        budget.spend(1);
        tokens.add(token);
      }
    }
    return [...tokens];
  };

  const loadDl = async (field: string): Promise<Map<string, number>> => {
    const existing = dlByField.get(field);
    if (existing) return existing;
    const stored = await docLengthsFor(stream.id, field);
    archiveIndex(field);
    for (const [key, dl] of archiveDl) {
      const [row, keyField] = key.split('|');
      if (keyField === field) stored.set(row, dl);
    }
    dlByField.set(field, stored);
    return stored;
  };

  for (const entry of collected) {
    const leafNode = entry.node;
    const hits = new Map<string, LeafHit>();
    if (leafNode.kind === 'term') {
      const postings = await lookup(leafNode.field, String(leafNode.value));
      for (const [row, posting] of postings) {
        hits.set(row, {
          tf: posting.tf,
          offsets: posting.starts.map((start, index) => [start, posting.ends[index]] as [number, number]),
        });
      }
      leaves.set(leafNode, {
        field: leafNode.field,
        kind: 'term',
        display: String(leafNode.value),
        scoring: entry.scoring,
        hits,
      });
      await loadDl(leafNode.field);
      continue;
    }
    if (leafNode.kind === 'phrase') {
      const perToken: Map<string, PostingEntry>[] = [];
      for (const token of leafNode.tokens) {
        perToken.push(await lookup(leafNode.field, token));
      }
      if (perToken.length > 0) {
        const firstRows = [...perToken[0].keys()];
        for (const row of firstRows) {
          const entries = perToken.map((map) => map.get(row));
          if (entries.some((item) => item === undefined)) continue;
          const offsets: [number, number][] = [];
          let tf = 0;
          const firstEntry = entries[0]!;
          for (let index = 0; index < firstEntry.positions.length; index += 1) {
            const base = firstEntry.positions[index];
            const spans: [number, number][] = [[firstEntry.starts[index], firstEntry.ends[index]]];
            let ok = true;
            for (let step = 1; step < entries.length; step += 1) {
              const entry2 = entries[step]!;
              const at = entry2.positions.indexOf(base + leafNode.slots[step] - leafNode.slots[0]);
              if (at < 0) {
                ok = false;
                break;
              }
              spans.push([entry2.starts[at], entry2.ends[at]]);
            }
            if (ok) {
              tf += 1;
              offsets.push(...spans);
            }
          }
          if (tf > 0) hits.set(row, { tf, offsets });
        }
      }
      leaves.set(leafNode, {
        field: leafNode.field,
        kind: 'phrase',
        display: leafNode.text,
        scoring: entry.scoring,
        hits,
      });
      await loadDl(leafNode.field);
      continue;
    }
    if (leafNode.kind === 'wildcard') {
      const pattern = wildcardToRegExp(leafNode.pattern.toLowerCase());
      const tokens = (await dictionaryOf(leafNode.field)).filter((token) => pattern.test(token));
      for (const token of tokens) {
        const postings = await lookup(leafNode.field, token);
        for (const [row, posting] of postings) {
          const hit = hits.get(row) ?? { tf: 0, offsets: [] };
          hit.tf += posting.tf;
          for (let index = 0; index < posting.starts.length; index += 1) {
            hit.offsets.push([posting.starts[index], posting.ends[index]]);
          }
          hits.set(row, hit);
        }
      }
      leaves.set(leafNode, {
        field: leafNode.field,
        kind: 'wildcard',
        display: leafNode.pattern,
        scoring: false,
        hits,
      });
    }
  }
  return { leaves, dlByField };
}

function evaluate(node: QueryNode, event: LoadedEvent, resolver: Resolver, nowMs: number): boolean {
  switch (node.kind) {
    case 'and':
      return node.children.every((child) => evaluate(child, event, resolver, nowMs));
    case 'or':
      return node.children.some((child) => evaluate(child, event, resolver, nowMs));
    case 'not':
      return !evaluate(node.child, event, resolver, nowMs);
    case 'scope':
      return scopeMatches(node, event.fields, nowMs);
    default: {
      const leaf = resolver.leaves.get(node);
      if (leaf) return leaf.hits.has(event.row);
      return leafMatchesFields(node, event.fields, nowMs);
    }
  }
}

function boostOf(field: string): number {
  return field === 'message' ? 2.0 : 1.0;
}

export function sortKey(sort: string | null | undefined): { field: string; direction: 1 | -1 } | null {
  if (!sort) return null;
  const [field, direction] = sort.split(':');
  if (!field) return null;
  return { field, direction: direction === 'asc' ? 1 : -1 };
}

/** The one matcher behind search, histogram, statistics, snapshots and pipes. */
export async function runMatch(request: MatchRequest): Promise<MatchOutcome> {
  const budget = request.budget ?? new Budget();
  checkQueryLimits(request.q ?? '');
  const { context, generations } = await streamContext(request.stream, request.fromMs, request.toMs);
  context.nowMs = request.nowMs;
  const node = parseQuery(request.q ?? '', context.lookup, request.nowMs);
  const load = await loadRange(request.stream, request.fromMs, request.toMs, generations);
  const candidates = load.events;
  const resolver = await resolveTextLeaves(node, request.stream, candidates, load.archiveRows, budget);

  const filters = request.filters ?? [];
  const matched: LoadedEvent[] = [];
  for (const event of candidates) {
    budget.spend(1);
    if (node && !evaluate(node, event, resolver, request.nowMs)) continue;
    if (!filters.every((filter) => matchesFilter(event.fields, filter, context.typeOf))) continue;
    matched.push(event);
  }

  const scored = hasScoringLeaf(node);
  const scoringLeaves = [...resolver.leaves.values()].filter(
    (leaf) => leaf.scoring && (leaf.kind === 'term' || leaf.kind === 'phrase'),
  );
  const statsByField = new Map<string, { n: number; avgdl: number }>();
  for (const leaf of scoringLeaves) {
    if (statsByField.has(leaf.field)) continue;
    const dls = resolver.dlByField.get(leaf.field) ?? new Map<string, number>();
    const withField = candidates.filter((event) => event.fields[leaf.field] !== undefined);
    const total = withField.reduce((sum, event) => sum + (dls.get(event.row) ?? 0), 0);
    statsByField.set(leaf.field, {
      n: withField.length,
      avgdl: withField.length === 0 ? 0 : total / withField.length,
    });
  }
  const candidateRows = new Set(candidates.map((event) => event.row));
  const idfByLeaf = new Map<TextLeaf, number>();
  for (const leaf of scoringLeaves) {
    const stats = statsByField.get(leaf.field)!;
    const df = [...leaf.hits.keys()].filter((row) => candidateRows.has(row)).length;
    const idf = Math.log(1 + (stats.n - df + 0.5) / (df + 0.5));
    idfByLeaf.set(leaf, idf);
  }

  const hits: Hit[] = matched.map((event) => {
    const highlights: Record<string, [number, number][]> = {};
    for (const leaf of resolver.leaves.values()) {
      const hit = leaf.hits.get(event.row);
      if (!hit) continue;
      const isHighlighting = leaf.scoring || leaf.kind === 'wildcard';
      if (!isHighlighting) continue;
      const list = highlights[leaf.field] ?? [];
      for (const offset of hit.offsets) list.push(offset);
      highlights[leaf.field] = list;
    }
    for (const [field, list] of Object.entries(highlights)) {
      const seen = new Set<string>();
      highlights[field] = list
        .filter((offset) => {
          const key = `${offset[0]}:${offset[1]}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((left, right) => left[0] - right[0]);
    }
    if (!scored) {
      return { event, score: null, highlights };
    }
    const children: Explanation['children'] = [];
    let total = 0;
    for (const leaf of scoringLeaves) {
      const hit = leaf.hits.get(event.row);
      if (!hit) continue;
      const stats = statsByField.get(leaf.field)!;
      const dls = resolver.dlByField.get(leaf.field) ?? new Map<string, number>();
      const dl = dls.get(event.row) ?? 0;
      const idf = idfByLeaf.get(leaf) ?? 0;
      const boost = boostOf(leaf.field);
      const tfNorm =
        (hit.tf * (K1 + 1)) / (hit.tf + K1 * (1 - B + B * (stats.avgdl === 0 ? 0 : dl / stats.avgdl)));
      const value = round(idf * tfNorm * boost, 4);
      total += value;
      const label = leaf.kind === 'phrase' ? `"${leaf.display}"` : leaf.display;
      children.push({
        value,
        leaf: label,
        field: leaf.field,
        idf: round(idf, 4),
        tf_norm: round(tfNorm, 4),
        boost,
        text: `${label} in ${leaf.field}: ${upTo(value, 4)} = idf ${upTo(idf, 4)} x tf_norm ${upTo(tfNorm, 4)} x boost ${upTo(boost, 4)}`,
      });
    }
    const score = round(total, 4);
    const hit: Hit = { event, score, highlights };
    if (request.explain) {
      hit.explanation = { value: score, text: `Score ${upTo(score, 4)}`, children };
    }
    return hit;
  });

  const explicitSort = sortKey(request.sort);
  if (explicitSort) {
    const conflict = context.conflictOf(explicitSort.field);
    if (conflict) throw fail.fieldConflict(conflict);
  }
  hits.sort((left, right) => {
    if (explicitSort) {
      const leftValue = valuesOf(left.event.fields[explicitSort.field])[0];
      const rightValue = valuesOf(right.event.fields[explicitSort.field])[0];
      const leftMissing = leftValue === undefined;
      const rightMissing = rightValue === undefined;
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (!leftMissing && !rightMissing) {
        const compared = compareValues(leftValue, rightValue) * explicitSort.direction;
        if (compared !== 0) return compared;
      }
    } else if (scored) {
      const compared = (right.score ?? 0) - (left.score ?? 0);
      if (compared !== 0) return compared;
    }
    if (right.event.tsMs !== left.event.tsMs) return right.event.tsMs - left.event.tsMs;
    return left.event.eventId < right.event.eventId ? -1 : left.event.eventId > right.event.eventId ? 1 : 0;
  });

  return {
    hits,
    total: hits.length,
    partial: load.partial,
    skippedGenerations: load.skippedGenerations,
    context,
    scored,
  };
}

export function serializeEvent(hit: Hit, explain: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    _id: hit.event.eventId,
    '@timestamp': new Date(hit.event.tsMs).toISOString(),
    _generation: hit.event.generation,
    _phase: hit.event.phase,
    _pipeline: hit.event.pipeline,
    _score: hit.score,
    fields: hit.event.fields,
    highlights: hit.highlights,
  };
  if (explain && hit.explanation) out.explanation = hit.explanation;
  return out;
}

export type FieldStats = {
  field: string;
  present: number;
  total: number;
  top: { value: string; count: number; share: string }[];
};

export function fieldStatistics(hits: Hit[], field: string): FieldStats {
  const counts = new Map<string, number>();
  let present = 0;
  for (const hit of hits) {
    const values = valuesOf(hit.event.fields[field]);
    if (values.length === 0) continue;
    present += 1;
    const distinct = new Set(values.map((value) => String(value)));
    for (const value of distinct) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .slice(0, 5)
    .map(([value, count]) => ({
      value,
      count,
      share: present === 0 ? '0.0' : round((count / present) * 100, 1).toFixed(1),
    }));
  return { field, present, total: hits.length, top };
}
