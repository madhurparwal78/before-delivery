import { settings } from '../env.js';
import { percentile } from './numbers.js';

export type SpanInput = {
  span_id: string;
  parent_id: string | null;
  service: string;
  name: string;
  start_ms: number;
  duration_ms: number;
};

export type SpanNode = {
  span_id: string;
  name: string;
  service: string;
  start_ms: number;
  duration_ms: number;
  shift_ms: number;
  self_ms: number;
  on_critical_path: boolean;
  children: SpanNode[];
};

export type TraceView = {
  roots: SpanNode[];
  missing_parent: SpanNode[];
  critical_path: string[];
  latency: { service: string; spans: number; p50: number; p95: number; p99: number }[];
};

export function validateSpans(spans: SpanInput[]): string | null {
  if (spans.length > settings.traceMaxSpans) {
    return `A trace can hold at most ${settings.traceMaxSpans} spans.`;
  }
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.span_id)) return `Span ${span.span_id} appears twice.`;
    seen.add(span.span_id);
  }
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  for (const span of spans) {
    const visited = new Set<string>([span.span_id]);
    let current = span.parent_id;
    while (current !== null && byId.has(current)) {
      if (visited.has(current)) {
        const loop = [...visited].sort();
        return `Span ${loop[0]} is part of a parent loop.`;
      }
      visited.add(current);
      current = byId.get(current)!.parent_id;
    }
  }
  return null;
}

function orderSpans<T extends { start_ms: number; span_id: string }>(spans: T[]): T[] {
  return [...spans].sort((left, right) => {
    if (left.start_ms !== right.start_ms) return left.start_ms - right.start_ms;
    return left.span_id < right.span_id ? -1 : left.span_id > right.span_id ? 1 : 0;
  });
}

/** Self time: duration minus the union of children's intervals, clipped to the span. */
export function selfTime(span: { start_ms: number; duration_ms: number }, children: SpanNode[]): number {
  const spanStart = span.start_ms;
  const spanEnd = span.start_ms + span.duration_ms;
  const intervals = children
    .map((child) => [
      Math.max(spanStart, child.start_ms),
      Math.min(spanEnd, child.start_ms + child.duration_ms),
    ])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  let covered = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const [start, end] of intervals) {
    const from = Math.max(start, cursor);
    if (end > from) {
      covered += end - from;
      cursor = end;
    }
  }
  return span.duration_ms - covered;
}

export function buildTrace(spans: SpanInput[]): TraceView {
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const childrenOf = new Map<string, SpanInput[]>();
  const roots: SpanInput[] = [];
  const orphans: SpanInput[] = [];
  for (const span of spans) {
    if (span.parent_id === null) {
      roots.push(span);
      continue;
    }
    if (!byId.has(span.parent_id)) {
      orphans.push(span);
      continue;
    }
    const list = childrenOf.get(span.parent_id) ?? [];
    list.push(span);
    childrenOf.set(span.parent_id, list);
  }

  const shifts = new Map<string, number>();
  const corrected = new Map<string, number>();

  const assign = (span: SpanInput, parentStart: number | null): void => {
    const parentShift = span.parent_id ? (shifts.get(span.parent_id) ?? 0) : 0;
    let start = span.start_ms + parentShift;
    let shift = parentShift;
    if (parentStart !== null && start < parentStart) {
      const extra = parentStart - start;
      shift += extra;
      start += extra;
    }
    shifts.set(span.span_id, shift);
    corrected.set(span.span_id, start);
    for (const child of orderSpans(childrenOf.get(span.span_id) ?? [])) {
      assign(child, start);
    }
  };
  for (const root of orderSpans(roots)) assign(root, null);
  for (const orphan of orderSpans(orphans)) assign(orphan, null);

  const nodeOf = (span: SpanInput): SpanNode => {
    const children = orderSpans(childrenOf.get(span.span_id) ?? []).map(nodeOf);
    const start = corrected.get(span.span_id) ?? span.start_ms;
    const node: SpanNode = {
      span_id: span.span_id,
      name: span.name,
      service: span.service,
      start_ms: start,
      duration_ms: span.duration_ms,
      shift_ms: shifts.get(span.span_id) ?? 0,
      self_ms: 0,
      on_critical_path: false,
      children,
    };
    node.self_ms = selfTime({ start_ms: start, duration_ms: span.duration_ms }, children);
    return node;
  };

  const rootNodes = orderSpans(roots).map(nodeOf);
  const orphanNodes = orderSpans(orphans).map(nodeOf);

  const path = new Set<string>();
  const walk = (node: SpanNode): void => {
    path.add(node.span_id);
    node.on_critical_path = true;
    let cursor = node.start_ms + node.duration_ms;
    const remaining = [...node.children];
    for (;;) {
      const candidates = remaining.filter((child) => child.start_ms + child.duration_ms <= cursor);
      if (candidates.length === 0) break;
      let pick = candidates[0];
      for (const candidate of candidates) {
        const pickEnd = pick.start_ms + pick.duration_ms;
        const candidateEnd = candidate.start_ms + candidate.duration_ms;
        if (candidateEnd > pickEnd || (candidateEnd === pickEnd && candidate.span_id < pick.span_id)) {
          pick = candidate;
        }
      }
      walk(pick);
      cursor = pick.start_ms;
      remaining.splice(remaining.indexOf(pick), 1);
    }
  };
  let start: SpanNode | null = null;
  for (const root of rootNodes) {
    if (!start || root.start_ms + root.duration_ms > start.start_ms + start.duration_ms) start = root;
  }
  if (start) walk(start);

  const all: SpanNode[] = [];
  const flatten = (nodes: SpanNode[]): void => {
    for (const node of nodes) {
      all.push(node);
      flatten(node.children);
    }
  };
  flatten(rootNodes);
  flatten(orphanNodes);

  const byService = new Map<string, number[]>();
  for (const node of all) {
    const list = byService.get(node.service) ?? [];
    list.push(node.duration_ms);
    byService.set(node.service, list);
  }
  const latency = [...byService.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([service, durations]) => {
      const sorted = [...durations].sort((left, right) => left - right);
      return {
        service,
        spans: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      };
    });

  const critical = all.filter((node) => path.has(node.span_id)).map((node) => node.span_id);

  return { roots: rootNodes, missing_parent: orphanNodes, critical_path: critical, latency };
}
