import type { Layout, LayoutNode, LayoutSegment } from "../../shared/layout.ts";

export type PathStep =
  | { kind: "segment"; segment: string; from: string; to: string }
  | { kind: "cross"; from: string; to: string };

export interface Threshold {
  id: string;
  runway: string;
  node: string;
  heading: number;
}

export interface Graph {
  layout: Layout;
  nodes: Map<string, LayoutNode>;
  segments: Map<string, LayoutSegment>;
  thresholds: Map<string, Threshold>;
  /** Holding nodes in layout order. */
  holdingNodes: LayoutNode[];
  /** Each crossing holding point mapped to the one on the far side of the runway. */
  crossings: Map<string, string>;
}

const graphs = new WeakMap<Layout, Graph>();

export function graphOf(layout: Layout): Graph {
  const cached = graphs.get(layout);
  if (cached) return cached;
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const thresholds = new Map<string, Threshold>();
  for (const runway of layout.runways) {
    for (const t of runway.thresholds) thresholds.set(t.id, { id: t.id, runway: runway.id, node: t.node, heading: t.heading });
  }
  const built: Graph = {
    layout,
    nodes,
    segments: new Map(layout.segments.map((segment) => [segment.id, segment])),
    thresholds,
    holdingNodes: layout.nodes.filter((node) => node.kind === "holding"),
    crossings: pairCrossings(layout, nodes),
  };
  graphs.set(layout, built);
  return built;
}

/** Pairs crossing holding points that face each other across the runway line. */
function pairCrossings(layout: Layout, nodes: Map<string, LayoutNode>): Map<string, string> {
  const pairs = new Map<string, string>();
  const runway = layout.runways[0];
  const ends = runway?.thresholds.map((t) => nodes.get(t.node));
  const [a, b] = ends ?? [];
  if (!a || !b) return pairs;
  const side = (node: LayoutNode): number => Math.sign((b.x - a.x) * (node.y - a.y) - (b.y - a.y) * (node.x - a.x));
  const crossNodes = layout.nodes.filter((node) => node.kind === "holding" && node.serves === "cross");
  const nearest = (from: LayoutNode): LayoutNode | undefined =>
    crossNodes
      .filter((other) => side(other) !== side(from))
      .sort((p, q) => Math.hypot(p.x - from.x, p.y - from.y) - Math.hypot(q.x - from.x, q.y - from.y))[0];
  for (const node of crossNodes) {
    const partner = nearest(node);
    if (partner && nearest(partner)?.id === node.id) pairs.set(node.id, partner.id);
  }
  return pairs;
}

export const segmentLength = (graph: Graph, segment: string): number => graph.segments.get(segment)?.lengthM ?? 0;
export const segmentSpeed = (graph: Graph, segment: string): number => graph.segments.get(segment)?.speedMps ?? 0;

const MAX_EXPANSIONS = 50000;

interface Candidate {
  steps: PathStep[];
  crossings: string[];
  length: number;
}

/** Whether `via` appears, in order, among the taxiways of the route's segments. */
function fitsVia(graph: Graph, steps: PathStep[], via: string[]): boolean {
  let next = 0;
  for (const step of steps) {
    if (step.kind === "segment" && next < via.length && graph.segments.get(step.segment)?.taxiway === via[next]) next++;
  }
  return next === via.length;
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.crossings.length !== b.crossings.length) return a.crossings.length < b.crossings.length;
  const left = a.crossings.join(" ");
  const right = b.crossings.join(" ");
  if (left !== right) return left < right;
  return a.length < b.length;
}

/**
 * The route between two nodes whose taxiways contain `via` in order: the one with the fewest crossings, then the
 * one through the alphabetically first crossing point. Null when no route fits.
 */
export function findRoute(graph: Graph, from: string, to: string, via: string[], head: PathStep[] = []): PathStep[] | null {
  const adjacent = new Map<string, PathStep[]>();
  const add = (node: string, step: PathStep): void => {
    adjacent.set(node, [...(adjacent.get(node) ?? []), step]);
  };
  for (const segment of graph.segments.values()) {
    add(segment.from, { kind: "segment", segment: segment.id, from: segment.from, to: segment.to });
    add(segment.to, { kind: "segment", segment: segment.id, from: segment.to, to: segment.from });
  }
  for (const [point, partner] of graph.crossings) add(point, { kind: "cross", from: point, to: partner });

  let best: Candidate | null = null;
  let expansions = 0;
  const visit = (node: string, seen: Set<string>, steps: PathStep[]): void => {
    if (++expansions > MAX_EXPANSIONS) return;
    if (node === to) {
      if (!fitsVia(graph, steps, via)) return;
      const candidate: Candidate = {
        steps: [...steps],
        crossings: steps.filter((s) => s.kind === "cross").map((s) => s.from),
        length: steps.reduce((sum, s) => sum + (s.kind === "segment" ? segmentLength(graph, s.segment) : 0), 0),
      };
      if (!best || better(candidate, best)) best = candidate;
      return;
    }
    for (const step of adjacent.get(node) ?? []) {
      if (seen.has(step.to)) continue;
      seen.add(step.to);
      steps.push(step);
      visit(step.to, seen, steps);
      steps.pop();
      seen.delete(step.to);
    }
  };
  visit(from, new Set([from, ...head.map((step) => step.from)]), [...head]);
  const found = best as Candidate | null;
  return found ? found.steps : null;
}

/**
 * The route of an aircraft seeded part-way along a segment: the segment in the direction that leads on to the target,
 * then the rest of the way. Null when the target cannot be reached.
 */
export function routeFromSegment(graph: Graph, segmentId: string, target: string): PathStep[] | null {
  const segment = graph.segments.get(segmentId);
  if (!segment) return null;
  const heads: PathStep[] = [
    { kind: "segment", segment: segment.id, from: segment.from, to: segment.to },
    { kind: "segment", segment: segment.id, from: segment.to, to: segment.from },
  ];
  const candidates = heads.flatMap((head) => {
    const rest = head.to === target ? [] : findRoute(graph, head.to, target, []);
    return rest && !rest.some((step) => step.kind === "segment" && step.segment === segment.id) ? [[head, ...rest]] : [];
  });
  const measure = (steps: PathStep[]): Candidate => ({
    steps,
    crossings: steps.filter((s) => s.kind === "cross").map((s) => s.from),
    length: steps.reduce((sum, s) => sum + (s.kind === "segment" ? segmentLength(graph, s.segment) : 0), 0),
  });
  const ranked = candidates.map(measure).sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  return ranked[0]?.steps ?? null;
}

/** The threshold at the other end of the runway. */
export function reciprocal(graph: Graph, threshold: string): string {
  const runway = graph.thresholds.get(threshold)?.runway;
  const other = [...graph.thresholds.values()].find((t) => t.runway === runway && t.id !== threshold);
  return other ? other.id : threshold;
}

/** The next holding point that serves a threshold in layout order, wrapping round. */
export function nextRunwayHoldingPoint(graph: Graph, point: string): string {
  const serving = graph.holdingNodes.filter((node) => node.serves !== undefined && node.serves !== "cross");
  const index = serving.findIndex((node) => node.id === point);
  const next = serving[(index + 1) % serving.length];
  return next ? next.id : point;
}

export const isRunwayHolding = (graph: Graph, point: string): boolean => {
  const node = graph.nodes.get(point);
  return node?.kind === "holding" && node.serves !== undefined && node.serves !== "cross";
};
