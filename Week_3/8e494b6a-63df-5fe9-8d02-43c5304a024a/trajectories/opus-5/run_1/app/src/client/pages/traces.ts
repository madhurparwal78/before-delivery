import { el } from '../dom.js';
import { ApiFailure, get } from '../state.js';
import { buildTree, emptyBand, loadFailed, type TreeNode } from '../widgets.js';

type SpanNode = {
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

type TraceDetail = {
  trace_id: string;
  roots: SpanNode[];
  missing_parent: SpanNode[];
  critical_path: string[];
  latency: { service: string; spans: number; p50: number; p95: number; p99: number }[];
};

export async function renderTraces(main: HTMLElement): Promise<void> {
  let data: { traces: { trace_id: string; spans: number }[] };
  try {
    data = await get<{ traces: { trace_id: string; spans: number }[] }>('/api/traces');
  } catch {
    main.append(loadFailed(() => void renderTraces(main)));
    return;
  }
  main.append(el('h1', { class: 'view-title', text: 'Traces' }));
  if (data.traces.length === 0) {
    main.append(
      emptyBand(
        'No traces yet.',
        el('a', { href: '/rules', text: 'Published rules', 'aria-label': 'Published rules' }),
      ),
    );
    return;
  }
  main.append(
    el('table', { 'aria-label': 'Traces', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Trace' }),
          el('th', { scope: 'col', text: 'Spans' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.traces.map((trace) =>
          el('tr', {}, [
            el('td', {}, [
              el('a', {
                href: `/traces/${trace.trace_id}`,
                text: `Trace ${trace.trace_id}`,
                'aria-label': `Trace ${trace.trace_id}`,
              }),
            ]),
            el('td', { class: 'mono', text: String(trace.spans) }),
          ]),
        ),
      ),
    ]),
  );
}

function spanLabel(span: SpanNode): string {
  let label = `Span ${span.name}, ${span.duration_ms} ms, self time ${span.self_ms} ms`;
  if (span.on_critical_path) label += ', on critical path';
  if (span.shift_ms > 0) label += `, shifted +${span.shift_ms} ms`;
  return label;
}

function spanTree(span: SpanNode, scale: number, offset: number): TreeNode {
  const bar = el('span', { class: 'span-bar' });
  bar.style.marginLeft = `${((span.start_ms - offset) / scale) * 100}%`;
  bar.style.width = `${Math.max(1, (span.duration_ms / scale) * 100)}%`;
  return {
    label: spanLabel(span),
    text: spanLabel(span),
    children: span.children.map((child) => spanTree(child, scale, offset)),
    extra: [bar],
  };
}

export async function renderTrace(main: HTMLElement, params: Record<string, string>): Promise<void> {
  let detail: TraceDetail;
  try {
    detail = await get<TraceDetail>(`/api/traces/${encodeURIComponent(params.id)}`);
  } catch (cause) {
    if (cause instanceof ApiFailure && cause.status === 404) {
      main.append(el('h1', { class: 'view-title', text: 'Page not found.' }));
      return;
    }
    main.append(loadFailed(() => void renderTrace(main, params)));
    return;
  }
  const all: SpanNode[] = [];
  const flatten = (nodes: SpanNode[]): void => {
    for (const node of nodes) {
      all.push(node);
      flatten(node.children);
    }
  };
  flatten([...detail.roots, ...detail.missing_parent]);
  const offset = Math.min(...all.map((span) => span.start_ms), 0);
  const span = Math.max(1, ...all.map((node) => node.start_ms + node.duration_ms - offset));
  const nodes: TreeNode[] = detail.roots.map((root) => spanTree(root, span, offset));
  if (detail.missing_parent.length > 0) {
    nodes.push({
      label: 'Missing parent',
      text: 'Missing parent',
      children: detail.missing_parent.map((orphan) => spanTree(orphan, span, offset)),
    });
  }
  main.append(
    el('h1', { class: 'view-title', text: `Trace ${detail.trace_id}` }),
    buildTree('Spans', nodes),
    el('table', { 'aria-label': 'Latency', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Service' }),
          el('th', { scope: 'col', text: 'Spans' }),
          el('th', { scope: 'col', text: 'p50 ms' }),
          el('th', { scope: 'col', text: 'p95 ms' }),
          el('th', { scope: 'col', text: 'p99 ms' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        detail.latency.map((row) =>
          el('tr', {}, [
            el('td', { class: 'mono', text: row.service }),
            el('td', { class: 'mono', text: String(row.spans) }),
            el('td', { class: 'mono', text: String(row.p50) }),
            el('td', { class: 'mono', text: String(row.p95) }),
            el('td', { class: 'mono', text: String(row.p99) }),
          ]),
        ),
      ),
    ]),
  );
}
