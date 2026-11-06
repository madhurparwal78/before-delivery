import type { EdgeKind, Tag } from '../../shared/domain.ts';
import type { LineageBody } from './api.ts';

export interface CanvasNode {
  column: string;
  asset: string;
  hop: number;
  lit: boolean;
  tags: Tag[];
  sealedTags: Tag[];
  sources: Partial<Record<Tag, string[]>>;
  deprecated: boolean;
  deprecatedUpstream: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  drawn: boolean;
  state: 'current' | 'new';
}

export interface CanvasModel {
  focus: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const SWEEP_HOP_FILL_MS = 220;
const SWEEP_MAX_STEP_MS = 140;
const SWEEP_BUDGET_MS = 1580;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

export function edgeId(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function nodeFromReached(
  body: LineageBody,
  entry: LineageBody['reached'][number],
  hopSign: 1 | -1,
): CanvasNode {
  const assetEntry = body.assets[entry.asset];
  return {
    column: entry.column,
    asset: entry.asset,
    hop: entry.hop * hopSign,
    lit: false,
    tags: hopSign === -1 ? entry.carried_tags : [],
    sealedTags: entry.sealed_tags,
    sources: hopSign === -1 ? entry.tag_sources : {},
    deprecated: assetEntry?.state === 'deprecated',
    deprecatedUpstream: assetEntry?.deprecated_upstream ?? '',
  };
}

/** The canvas at rest: the focus node, upstream nodes lit by their carried tags, downstream unlit. */
export function buildCanvasModel(
  focus: string,
  upstream: LineageBody | null,
  downstream: LineageBody | null,
): CanvasModel {
  const nodes: CanvasNode[] = [];
  const source = upstream ?? downstream;
  if (source !== null) {
    const focusAsset = Object.entries(source.assets).find(([assetId]) =>
      focus.startsWith(`${assetId}.`),
    );
    nodes.push({
      column: focus,
      asset: focusAsset?.[0] ?? '',
      hop: 0,
      lit: true,
      tags: source.focus_tags,
      sealedTags: [],
      sources: source.focus_tag_sources,
      deprecated: focusAsset?.[1].state === 'deprecated',
      deprecatedUpstream: focusAsset?.[1].deprecated_upstream ?? '',
    });
  }
  if (upstream !== null) {
    for (const entry of upstream.reached) nodes.push(nodeFromReached(upstream, entry, -1));
  }
  if (downstream !== null) {
    for (const entry of downstream.reached) nodes.push(nodeFromReached(downstream, entry, 1));
  }

  const edges: CanvasEdge[] = [];
  const seen = new Set<string>();
  const add = (
    edge: LineageBody['edges'][number],
    drawn: boolean,
  ): void => {
    const id = edgeId(edge.from, edge.to);
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, from: edge.from, to: edge.to, kind: edge.kind, drawn, state: 'current' });
  };
  if (upstream !== null) for (const edge of upstream.edges) add(edge, true);
  if (downstream !== null) for (const edge of downstream.edges) add(edge, false);
  return { focus, nodes, edges };
}

export function sweepStepMs(deepestHop: number): number {
  if (deepestHop <= 0) return SWEEP_MAX_STEP_MS;
  return Math.min(SWEEP_MAX_STEP_MS, SWEEP_BUDGET_MS / deepestHop);
}

export interface SweepProgress {
  litThroughHop: number;
  counter: number;
  done: boolean;
}

/** Sweep progress depends only on the time since time zero. */
export function sweepProgress(response: LineageBody, elapsedMs: number): SweepProgress {
  const deepest = response.totals.hops;
  if (deepest === 0) return { litThroughHop: 0, counter: response.totals.columns, done: true };
  const step = sweepStepMs(deepest);
  const litThroughHop = Math.min(deepest, Math.floor(elapsedMs / step));
  let settledThrough = 0;
  for (let hop = 1; hop <= deepest; hop += 1) {
    if (elapsedMs >= hop * step + SWEEP_HOP_FILL_MS) settledThrough = hop;
  }
  const counter = response.reached.filter((entry) => entry.hop <= settledThrough).length;
  return { litThroughHop, counter, done: settledThrough >= deepest };
}

export function finishedSweep(response: LineageBody): SweepProgress {
  return { litThroughHop: response.totals.hops, counter: response.totals.columns, done: true };
}

/** Applies a sweep response's lit state and tags to the downstream side of the drawing. */
export function applySweep(
  model: CanvasModel,
  response: LineageBody,
  progress: SweepProgress,
): CanvasModel {
  const reachedByColumn = new Map(response.reached.map((entry) => [entry.column, entry]));
  const nodes = model.nodes.map((node) => {
    if (node.hop <= 0) return node;
    const entry = reachedByColumn.get(node.column);
    if (entry === undefined) return node;
    const lit = entry.hop <= progress.litThroughHop;
    return {
      ...node,
      lit,
      tags: lit ? entry.carried_tags : [],
      sealedTags: entry.sealed_tags,
      sources: lit ? entry.tag_sources : {},
    };
  });
  const hopOf = new Map(nodes.map((node) => [node.column, node.hop]));
  const edges = model.edges.map((edge) => {
    if (edge.state === 'new') return edge;
    const targetHop = hopOf.get(edge.to) ?? 0;
    const sourceHop = hopOf.get(edge.from) ?? 0;
    if (edge.kind === 'cycle') {
      return sourceHop > 0 ? { ...edge, drawn: sourceHop <= progress.litThroughHop } : edge;
    }
    if (targetHop > 0) return { ...edge, drawn: targetHop <= progress.litThroughHop };
    return edge;
  });
  return { ...model, nodes, edges };
}

/** Resets the downstream side: unlit, untagged, with no downstream edge drawn. */
export function resetDownstream(model: CanvasModel): CanvasModel {
  return {
    ...model,
    nodes: model.nodes.map((node) =>
      node.hop > 0 ? { ...node, lit: false, tags: [], sealedTags: [], sources: {} } : node,
    ),
    edges: model.edges.filter((edge) => {
      const target = model.nodes.find((node) => node.column === edge.to);
      return !(target !== undefined && target.hop > 0);
    }),
  };
}

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Keeps the content point under `m` fixed: pan' = m - (m - pan) * (z'/z). */
export function zoomAbout(
  view: ViewTransform,
  nextZoom: number,
  midX: number,
  midY: number,
): ViewTransform {
  const zoom = clampZoom(nextZoom);
  const ratio = zoom / view.zoom;
  return {
    zoom,
    panX: midX - (midX - view.panX) * ratio,
    panY: midY - (midY - view.panY) * ratio,
  };
}

export function roundPan(value: number): number {
  return Math.floor(value + 0.5);
}

export function formatZoom(zoom: number): string {
  return zoom.toFixed(2);
}

export function bandsOf(nodes: readonly CanvasNode[]): number[] {
  return [...new Set(nodes.map((node) => node.hop))].sort((a, b) => a - b);
}

export function bandNodes(nodes: readonly CanvasNode[], hop: number): CanvasNode[] {
  return nodes
    .filter((node) => node.hop === hop)
    .sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0));
}
