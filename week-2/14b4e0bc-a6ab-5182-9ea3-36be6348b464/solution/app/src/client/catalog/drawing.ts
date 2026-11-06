import type { LineageBody, LineageEdge } from "./types.ts";

type Side = "up" | "focus" | "down";

export interface DrawnNode {
  column: string;
  asset: string;
  hop: number;
  side: Side;
  carried: string[];
  sealed: string[];
  sources: Record<string, string[]>;
  /** Part of the current trace response (downstream nodes only). */
  traced: boolean;
}

export interface DrawnEdge {
  key: string;
  from: string;
  to: string;
  transform: string;
  kind: LineageEdge["kind"];
  side: "up" | "down";
  state: "current" | "new";
}

export interface Drawing {
  focus: string;
  nodes: Map<string, DrawnNode>;
  edges: Map<string, DrawnEdge>;
  assets: LineageBody["assets"];
  /** The lineage-changed copy is announced once per drawing. */
  changeAnnounced: boolean;
}

const edgeKey = (from: string, to: string) => `${from}→${to}`;

function upstreamNodes(up: LineageBody): DrawnNode[] {
  return up.reached.map((r) => ({
    column: r.column, asset: r.asset, hop: -r.hop, side: "up" as const, carried: r.carried_tags, sealed: r.sealed_tags, sources: r.tag_sources, traced: false,
  }));
}

function downstreamNodes(down: LineageBody, traced: boolean): DrawnNode[] {
  return down.reached.map((r) => ({
    column: r.column, asset: r.asset, hop: r.hop, side: "down" as const, carried: r.carried_tags, sealed: r.sealed_tags, sources: r.tag_sources, traced,
  }));
}

/** The canvas at rest for a focus column (Motion and effects: Canvas at rest). */
export function drawingAtRest(up: LineageBody, down: LineageBody): Drawing {
  const nodes = new Map<string, DrawnNode>();
  const focusAsset = Object.keys(down.assets).find((a) => down.focus.startsWith(`${a}.`)) ?? down.focus.slice(0, down.focus.lastIndexOf("."));
  nodes.set(down.focus, {
    column: down.focus, asset: focusAsset, hop: 0, side: "focus", carried: down.focus_tags, sealed: [], sources: down.focus_tag_sources, traced: false,
  });
  for (const n of upstreamNodes(up)) if (!nodes.has(n.column)) nodes.set(n.column, n);
  for (const n of downstreamNodes(down, false)) if (!nodes.has(n.column) || nodes.get(n.column)!.side === "up") nodes.set(n.column, n);
  const edges = new Map<string, DrawnEdge>();
  for (const e of up.edges) edges.set(edgeKey(e.from, e.to), { key: edgeKey(e.from, e.to), ...e, side: "up", state: "current" });
  for (const e of down.edges) edges.set(edgeKey(e.from, e.to), { key: edgeKey(e.from, e.to), ...e, side: "down", state: "current" });
  return { focus: down.focus, nodes, edges, assets: { ...up.assets, ...down.assets }, changeAnnounced: false };
}

/** Trace reset: downstream nodes unlit, downstream edge elements removed (Downstream sweep, step 1). */
export function resetDownstream(d: Drawing): Drawing {
  const edges = new Map([...d.edges].filter(([, e]) => e.side === "up"));
  const nodes = new Map([...d.nodes].map(([k, n]) => [k, n.side === "down" ? { ...n, traced: false } : n]));
  return { ...d, nodes, edges };
}

/** Time zero: the downstream side rebuilt to match the trace response; focus and upstream left as they are. */
export function applyTrace(d: Drawing, down: LineageBody): Drawing {
  const nodes = new Map([...d.nodes].filter(([, n]) => n.side !== "down"));
  for (const n of downstreamNodes(down, true)) if (!nodes.has(n.column) || nodes.get(n.column)!.side === "up") nodes.set(n.column, n);
  const edges = new Map([...d.edges].filter(([, e]) => e.side === "up"));
  for (const e of down.edges) edges.set(edgeKey(e.from, e.to), { key: edgeKey(e.from, e.to), ...e, side: "down", state: "current" });
  return { ...d, nodes, edges, assets: { ...d.assets, ...down.assets } };
}

/** Another person's tag or certification change: values only, matched by column id (DP-97, DP-99). */
export function applyTagUpdate(d: Drawing, up: LineageBody, down: LineageBody): Drawing {
  const fresh = new Map<string, { carried: string[]; sealed: string[]; sources: Record<string, string[]> }>();
  for (const r of up.reached) fresh.set(r.column, { carried: r.carried_tags, sealed: r.sealed_tags, sources: r.tag_sources });
  for (const r of down.reached) fresh.set(r.column, { carried: r.carried_tags, sealed: r.sealed_tags, sources: r.tag_sources });
  fresh.set(down.focus, { carried: down.focus_tags, sealed: [], sources: down.focus_tag_sources });
  const nodes = new Map(
    [...d.nodes].map(([k, n]) => {
      const f = fresh.get(k);
      return [k, f ? { ...n, carried: f.carried, sealed: f.sealed, sources: f.sources } : n];
    }),
  );
  return { ...d, nodes, assets: { ...d.assets, ...up.assets, ...down.assets } };
}

/** Another person's lineage write: new edges and nodes in place, removed edges dropped (DP-04). */
export function applyLineageUpdate(d: Drawing, up: LineageBody, down: LineageBody): { drawing: Drawing; changed: boolean } {
  const listed = new Map<string, { e: LineageEdge; side: "up" | "down" }>();
  for (const e of up.edges) listed.set(edgeKey(e.from, e.to), { e, side: "up" });
  for (const e of down.edges) listed.set(edgeKey(e.from, e.to), { e, side: "down" });
  const hops = new Map<string, { hop: number; side: "up" | "down"; r: LineageBody["reached"][number] }>();
  for (const r of up.reached) hops.set(r.column, { hop: -r.hop, side: "up", r });
  for (const r of down.reached) hops.set(r.column, { hop: r.hop, side: "down", r });
  let changed = false;
  const edges = new Map<string, DrawnEdge>();
  for (const [k, e] of d.edges) {
    if (listed.has(k)) edges.set(k, e);
    else changed = true;
  }
  const nodes = new Map(d.nodes);
  for (const [k, { e, side }] of listed) {
    if (edges.has(k)) continue;
    changed = true;
    edges.set(k, { key: k, ...e, side, state: "new" });
    for (const end of [e.from, e.to]) {
      if (nodes.has(end)) continue;
      const h = hops.get(end);
      if (!h) continue;
      nodes.set(end, {
        column: end, asset: h.r.asset, hop: h.hop, side: h.side, carried: h.r.carried_tags,
        sealed: h.r.sealed_tags, sources: h.r.tag_sources, traced: false,
      });
    }
  }
  return { drawing: { ...d, nodes, edges, assets: { ...d.assets, ...up.assets, ...down.assets } }, changed };
}

export interface Trace {
  gen: number;
  phase: "pending" | "running" | "done";
  t0: number;
  step: number;
  maxHop: number;
  body: LineageBody | null;
}

const SETTLE_MS = 220;

/** Sweep progress depends only on the time since time zero (DP-44). */
export function sweepProgress(trace: Trace | null, now: number) {
  if (!trace || trace.phase === "pending" || !trace.body) return { litBand: -1, counted: 0, done: false };
  if (trace.phase === "done") return { litBand: Infinity, counted: trace.body.totals.columns, done: true };
  const elapsed = now - trace.t0;
  const litBand = Math.floor(elapsed / trace.step + 1e-9);
  const settled = Math.floor((elapsed - SETTLE_MS) / trace.step + 1e-9);
  const counted = trace.body.reached.filter((r) => r.hop <= settled).length;
  const done = elapsed >= trace.maxHop * trace.step + SETTLE_MS;
  return { litBand, counted: done ? trace.body.totals.columns : counted, done };
}

/** Milliseconds until the next band starts lighting or settles. */
export function nextBoundary(trace: Trace, now: number): number {
  const elapsed = now - trace.t0;
  const times: number[] = [];
  for (let k = 1; k <= trace.maxHop; k++) times.push(k * trace.step, k * trace.step + SETTLE_MS);
  times.push(trace.maxHop * trace.step + SETTLE_MS);
  const next = times.filter((t) => t > elapsed + 1e-6).sort((a, b) => a - b)[0];
  return next === undefined ? 0 : Math.max(0, next - elapsed);
}

export function stepFor(maxHop: number): number {
  return maxHop ? Math.min(140, 1580 / maxHop) : 140;
}

export interface NodeView {
  node: DrawnNode;
  lit: boolean;
  tags: string[];
  sealMark: boolean;
  badge: boolean;
  deprecated: boolean;
  deprecatedUpstream: string;
}

export function nodeViews(d: Drawing, trace: Trace | null, now: number, reducedMotion: boolean): NodeView[] {
  const { litBand } = sweepProgress(trace, now);
  return [...d.nodes.values()].map((n) => {
    const lit = n.side === "focus" || (n.side === "down" && n.traced && n.hop <= litBand);
    const tags = n.side === "down" && !lit ? [] : n.carried;
    const asset = d.assets[n.asset];
    return {
      node: n,
      lit,
      tags,
      sealMark: n.sealed.length > 0 && (n.side === "up" || (n.side === "down" && lit)),
      badge: reducedMotion && n.side === "down" && lit,
      deprecated: asset?.state === "deprecated",
      deprecatedUpstream: asset?.deprecated_upstream ?? "",
    };
  });
}

export function edgeDrawn(e: DrawnEdge, d: Drawing, trace: Trace | null, now: number): boolean {
  if (e.side === "up" || e.state === "new") return true;
  const { litBand } = sweepProgress(trace, now);
  const anchor = d.nodes.get(e.kind === "cycle" ? e.from : e.to);
  return litBand >= 1 && !!anchor?.traced && anchor.hop <= litBand;
}

/** Bands keyed by signed hop, each sorted by column id. */
export function bands(d: Drawing): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const n of d.nodes.values()) (out.get(n.hop) ?? out.set(n.hop, []).get(n.hop)!).push(n.column);
  for (const list of out.values()) list.sort();
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/** Canvas and hop-list keys (DP-45): returns the column focus moves to, or null to stay. */
export function navigate(d: Drawing, current: string, key: string): string | null {
  const b = bands(d);
  const node = d.nodes.get(current);
  if (!node) return d.focus;
  const band = b.get(node.hop) ?? [];
  const row = band.indexOf(current);
  const linked = [...d.edges.values()].filter((e) => e.kind !== "cycle");
  switch (key) {
    case "ArrowUp":
      return row > 0 ? band[row - 1] : null;
    case "ArrowDown":
      return row < band.length - 1 ? band[row + 1] : null;
    case "Home":
      return d.focus;
    case "End": {
      const deepest = Math.max(0, ...[...b.keys()].filter((h) => h > 0));
      const last = b.get(deepest);
      return deepest > 0 && last ? last[last.length - 1] : d.focus;
    }
    case "ArrowRight":
    case "ArrowLeft": {
      const target = node.hop + (key === "ArrowRight" ? 1 : -1);
      const next = b.get(target);
      if (!next?.length) return null;
      const linkedInBand = next.filter((c) =>
        linked.some((e) => (key === "ArrowRight" ? e.from === current && e.to === c : e.from === c && e.to === current)),
      );
      if (linkedInBand.length) return linkedInBand[0];
      return next[Math.min(row, next.length - 1)];
    }
    default:
      return null;
  }
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const REST_VIEW: View = { zoom: 1, panX: 0, panY: 0 };

/** The zoom formula (DP-46, DP-47): the content point under m stays fixed. */
export function zoomAround(view: View, nextZoom: number, mx: number, my: number): View {
  const z = Math.min(2, Math.max(0.5, nextZoom));
  const ratio = z / view.zoom;
  return { zoom: z, panX: mx - (mx - view.panX) * ratio, panY: my - (my - view.panY) * ratio };
}

/** Recorded pan: nearest whole pixel, halves toward positive infinity. */
export const recordPan = (value: number) => String(Math.floor(value + 0.5));
