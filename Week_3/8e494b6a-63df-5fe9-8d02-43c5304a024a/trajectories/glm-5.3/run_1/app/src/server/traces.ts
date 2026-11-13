/**
 * Traces (rule M): the span tree, clock skew, self time, critical path and percentiles.
 */
import { errors } from "./errors";

export interface SpanInput {
  span_id: string;
  parent_id: string | null;
  service: string;
  name: string;
  start_ms: number;
  duration_ms: number;
}

export interface SpanNode {
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

export interface TraceInfo {
  trace_id: string;
  roots: SpanNode[];
  missing_parent: SpanNode[];
  critical_path: string[];
  latency: { service: string; spans: number; p50: number; p95: number; p99: number }[];
}

export function validateTrace(spans: SpanInput[], maxSpans: number): void {
  if (spans.length > maxSpans) {
    throw errors.traceInvalid(`A trace can hold at most ${maxSpans} spans.`);
  }
  const seen = new Set<string>();
  for (const s of spans) {
    if (seen.has(s.span_id)) throw errors.traceInvalid(`Span ${s.span_id} appears twice.`);
    seen.add(s.span_id);
  }
  // parent loop check
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  for (const s of spans) {
    const chain = new Set<string>();
    let cur: SpanInput | undefined = s;
    while (cur && cur.parent_id !== null) {
      if (chain.has(cur.span_id)) break;
      chain.add(cur.span_id);
      const parent = byId.get(cur.parent_id);
      if (!parent) break;
      if (chain.has(parent.span_id)) {
        throw errors.traceInvalid(`Span ${parent.span_id} is part of a parent loop.`);
      }
      cur = parent;
    }
  }
  for (const s of spans) {
    if (!Number.isInteger(s.start_ms) || !Number.isInteger(s.duration_ms) || s.duration_ms < 0) {
      throw errors.traceInvalid(`Span ${s.span_id} appears twice.`);
    }
  }
}

interface Work extends SpanInput {
  shift: number;
  correctedStart: number;
  selfMs: number;
  children: Work[];
  onPath: boolean;
}

/** Build the trace tree, correcting clock skew and computing self time and the critical path. */
export function buildTrace(traceId: string, spans: SpanInput[]): TraceInfo {
  const works = new Map<string, Work>();
  for (const s of spans) {
    works.set(s.span_id, { ...s, shift: 0, correctedStart: s.start_ms, selfMs: 0, children: [], onPath: false });
  }
  const roots: Work[] = [];
  const orphans: Work[] = [];
  for (const w of works.values()) {
    if (w.parent_id === null) {
      roots.push(w);
    } else {
      const parent = works.get(w.parent_id);
      if (parent) parent.children.push(w);
      else orphans.push(w);
    }
  }
  const orderChildren = (list: Work[]): void => {
    list.sort((a, b) => (a.start_ms !== b.start_ms ? a.start_ms - b.start_ms : a.span_id < b.span_id ? -1 : 1));
    for (const c of list) orderChildren(c.children);
  };
  orderChildren(roots);
  orderChildren(orphans);

  // Clock skew, top down.
  const correct = (w: Work, parentStart: number | null): void => {
    if (parentStart !== null && w.start_ms < parentStart) {
      const d = parentStart - w.start_ms;
      w.shift = d;
      w.correctedStart = parentStart;
    }
    for (const c of w.children) correct(c, w.correctedStart);
  };
  for (const r of roots) correct(r, null);
  for (const o of orphans) correct(o, null);

  const endOf = (w: Work): number => w.correctedStart + w.duration_ms;

  // Self time: duration minus the union of children's intervals, clipped to the span.
  const selfTime = (w: Work): number => {
    const intervals: [number, number][] = w.children.map((c) => [
      Math.max(c.correctedStart, w.correctedStart),
      Math.min(endOf(c), endOf(w)),
    ]);
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let curStart = -1;
    let curEnd = -1;
    for (const [s, e] of intervals) {
      if (e <= s) continue;
      if (curStart === -1) {
        curStart = s;
        curEnd = e;
      } else if (s <= curEnd) {
        curEnd = Math.max(curEnd, e);
      } else {
        covered += curEnd - curStart;
        curStart = s;
        curEnd = e;
      }
    }
    if (curStart !== -1) covered += curEnd - curStart;
    return Math.max(0, w.duration_ms - covered);
  };
  for (const w of works.values()) w.selfMs = selfTime(w);

  // Critical path (rule M): start at the real root with the latest end; among the
  // children choose the one with the latest end at or before the cursor, walk into it
  // with the cursor at its end; then set the cursor to that child's start and repeat
  // among the remaining children.
  const path: string[] = [];
  const realRoot = roots.reduce<Work | null>((best, r) => {
    if (!best) return r;
    return endOf(r) > endOf(best) ? r : best;
  }, null);
  if (realRoot) {
    realRoot.onPath = true;
    path.push(realRoot.span_id);
    const pickChildren = (w: Work, initialCursor: number): void => {
      const remaining = new Set(w.children);
      let cursor = initialCursor;
      for (;;) {
        const eligible = [...remaining]
          .filter((c) => endOf(c) <= cursor)
          .sort((a, b) => (endOf(b) !== endOf(a) ? endOf(b) - endOf(a) : a.span_id < b.span_id ? -1 : 1));
        const chosen = eligible[0];
        if (!chosen) break;
        remaining.delete(chosen);
        chosen.onPath = true;
        path.push(chosen.span_id);
        pickChildren(chosen, endOf(chosen));
        cursor = chosen.correctedStart;
      }
    };
    pickChildren(realRoot, endOf(realRoot));
  }

  const toNode = (w: Work): SpanNode => ({
    span_id: w.span_id,
    name: w.name,
    service: w.service,
    start_ms: w.correctedStart,
    duration_ms: w.duration_ms,
    shift_ms: w.shift,
    self_ms: w.selfMs,
    on_critical_path: w.onPath,
    children: w.children.map(toNode),
  });

  const byService = new Map<string, number[]>();
  for (const w of works.values()) {
    const list = byService.get(w.service) ?? [];
    list.push(w.duration_ms);
    byService.set(w.service, list);
  }
  const latency = [...byService.entries()].map(([service, durations]) => {
    const sorted = [...durations].sort((a, b) => a - b);
    const rank = (p: number): number => sorted[Math.ceil((p / 100) * sorted.length) - 1] ?? 0;
    return { service, spans: sorted.length, p50: rank(50), p95: rank(95), p99: rank(99) };
  });
  latency.sort((a, b) => (a.service < b.service ? -1 : 1));

  return {
    trace_id: traceId,
    roots: roots.map(toNode),
    missing_parent: orphans.map(toNode),
    critical_path: path,
    latency,
  };
}
