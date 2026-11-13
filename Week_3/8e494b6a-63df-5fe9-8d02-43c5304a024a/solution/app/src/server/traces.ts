// Traces (Business rules M): tree order, orphans, clock skew, self time, critical path and percentiles, each decided once.
import { config } from "./config";

export interface SpanInput {
  span_id: string;
  parent_id: string | null;
  service: string;
  name: string;
  start_ms: number;
  duration_ms: number;
}

interface SpanNode {
  span_id: string;
  name: string;
  service: string;
  start_ms: number;
  duration_ms: number;
  shift_ms: number;
  self_ms: number;
  on_critical_path: boolean;
  children: SpanNode[];
}

const byStartThenId = (a: SpanInput, b: SpanInput): number => a.start_ms - b.start_ms || (a.span_id < b.span_id ? -1 : a.span_id > b.span_id ? 1 : 0);

/** The first published trace problem as its sentence, or null. */
export function traceProblem(spans: SpanInput[]): string | null {
  const max = config.settings.traceMaxSpans;
  if (spans.length > max) return `A trace can hold at most ${max} spans.`;
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.span_id)) return `Span ${span.span_id} appears twice.`;
    seen.add(span.span_id);
  }
  const parents = new Map(spans.map((span) => [span.span_id, span.parent_id]));
  const inLoop = new Set<string>();
  for (const span of spans) {
    const path: string[] = [];
    let current: string | null | undefined = span.span_id;
    while (current !== null && current !== undefined && !path.includes(current)) {
      path.push(current);
      current = parents.get(current);
    }
    if (current !== null && current !== undefined) for (const id of path.slice(path.indexOf(current))) inLoop.add(id);
  }
  const lowest = [...inLoop].sort()[0];
  return lowest === undefined ? null : `Span ${lowest} is part of a parent loop.`;
}

const unionLength = (intervals: Array<[number, number]>): number => {
  let total = 0;
  let end = -Infinity;
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(from, end);
    if (to > start) total += to - start;
    end = Math.max(end, to);
  }
  return total;
};

/** Nearest rank: the value at rank ceil(p / 100 * n) of the sorted list. */
const percentile = (sorted: number[], p: number): number => sorted[Math.ceil((p / 100) * sorted.length) - 1] as number;

export function buildTrace(traceId: string, spans: SpanInput[]) {
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const children = new Map<string, SpanInput[]>();
  const roots: SpanInput[] = [];
  const orphans: SpanInput[] = [];
  for (const span of spans) {
    if (span.parent_id === null) roots.push(span);
    else if (!byId.has(span.parent_id)) orphans.push(span);
    else children.set(span.parent_id, [...(children.get(span.parent_id) ?? []), span]);
  }
  const shifts = new Map<string, number>();
  const path = new Set<string>();

  const place = (span: SpanInput, shift: number): void => {
    shifts.set(span.span_id, shift);
    for (const child of children.get(span.span_id) ?? []) place(child, shift + Math.max(0, span.start_ms - child.start_ms));
  };
  const startOf = (span: SpanInput): number => span.start_ms + (shifts.get(span.span_id) ?? 0);
  const endOf = (span: SpanInput): number => startOf(span) + span.duration_ms;
  for (const root of [...roots, ...orphans]) place(root, 0);

  const walk = (span: SpanInput, cursor: number): void => {
    path.add(span.span_id);
    let remaining = (children.get(span.span_id) ?? []).filter((child) => !path.has(child.span_id));
    let limit = cursor;
    for (;;) {
      const eligible = remaining.filter((child) => endOf(child) <= limit);
      const chosen = eligible.sort((a, b) => endOf(b) - endOf(a) || (a.span_id < b.span_id ? -1 : 1))[0];
      if (!chosen) return;
      walk(chosen, endOf(chosen));
      limit = startOf(chosen);
      remaining = remaining.filter((child) => child !== chosen);
    }
  };
  const critical = [...roots].sort((a, b) => endOf(b) - endOf(a) || (a.span_id < b.span_id ? -1 : 1))[0];
  if (critical) walk(critical, endOf(critical));

  const node = (span: SpanInput): SpanNode => {
    const kids = [...(children.get(span.span_id) ?? [])].sort(byStartThenId);
    const from = startOf(span);
    const to = endOf(span);
    const covered = unionLength(kids.map((kid): [number, number] => [Math.max(from, startOf(kid)), Math.min(to, endOf(kid))]).filter(([a, b]) => b > a));
    return {
      span_id: span.span_id, name: span.name, service: span.service, start_ms: span.start_ms, duration_ms: span.duration_ms,
      shift_ms: shifts.get(span.span_id) ?? 0, self_ms: span.duration_ms - covered, on_critical_path: path.has(span.span_id), children: kids.map(node),
    };
  };

  const durations = new Map<string, number[]>();
  for (const span of spans) durations.set(span.service, [...(durations.get(span.service) ?? []), span.duration_ms]);
  return {
    trace_id: traceId,
    roots: [...roots].sort(byStartThenId).map(node),
    missing_parent: [...orphans].sort(byStartThenId).map(node),
    critical_path: spans.filter((span) => path.has(span.span_id)).sort((a, b) => startOf(a) - startOf(b)).map((span) => span.span_id),
    latency: [...durations].sort(([a], [b]) => (a < b ? -1 : 1)).map(([service, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      return { service, spans: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99) };
    }),
  };
}
