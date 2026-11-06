// The hop-ring drawing shared by the Exposure Ring (boundary mode) and the Graph tab: the root at
// the centre, notes on four concentric rings by hop, unresolved targets as stubs past hop 4.
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Lock, Scissors } from "lucide-react";
import { hops, MAX_HOP, nameIndex, nameKey, wikilinks, type BoundaryNote } from "../../shared/boundary.ts";

export const VIEW = 540;
const CENTER = VIEW / 2;
export const SPACING = 52;
/** Turns the tree off the axes so single-child chains don't lie along a horizontal or vertical. */
const ROTATION = 0.42;

interface RingNode {
  id: string;
  title: string;
  hop: number;
  private: boolean;
  x: number;
  y: number;
}

interface RingLink {
  key: string;
  sourceId: string;
  targetId: string | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function shortTitle(title: string): string {
  return title.length > 16 ? `${title.slice(0, 15)}…` : title;
}

/**
 * Positions every note within hop 4 (private notes included, drawn but never travelled through)
 * as a radial tree: each note sits on its hop ring inside its parent's angular sector, sized by
 * how many notes hang below it.
 */
function ringLayout(notes: readonly BoundaryNote[], rootId: string): { nodes: RingNode[]; links: RingLink[]; bearing: number } {
  const reached = hops(notes, rootId);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const index = nameIndex(notes);
  const children = new Map<string, string[]>();
  const placedIds = [...reached].filter(([, h]) => h <= MAX_HOP).sort((a, b) => a[1] - b[1]).map(([id]) => id);
  for (const id of placedIds) {
    const note = byId.get(id) as BoundaryNote;
    if (note.private || (reached.get(id) as number) >= MAX_HOP) continue;
    for (const link of wikilinks(note.body)) {
      const target = index.get(nameKey(link.target));
      if (target && reached.get(target.id) === (reached.get(id) as number) + 1 && ![...children.values()].some((c) => c.includes(target.id))) {
        children.set(id, [...(children.get(id) ?? []), target.id]);
      }
    }
  }
  const weight = (id: string): number => Math.max(1, (children.get(id) ?? []).reduce((sum, c) => sum + weight(c), 0));
  const nodes: RingNode[] = [];
  const place = (id: string, from: number, to: number) => {
    const note = byId.get(id) as BoundaryNote;
    const hop = reached.get(id) as number;
    const a = hop === 0 ? -Math.PI / 2 : (from + to) / 2;
    nodes.push({ id, title: note.title, hop, private: note.private, x: CENTER + hop * SPACING * Math.cos(a), y: CENTER + hop * SPACING * Math.sin(a) });
    let start = from;
    const kids = (children.get(id) ?? []).sort((x, y) => (byId.get(x) as BoundaryNote).title.localeCompare((byId.get(y) as BoundaryNote).title));
    const total = kids.reduce((sum, k) => sum + weight(k), 0);
    for (const kid of kids) {
      const span = ((to - from) * weight(kid)) / total;
      place(kid, start, start + span);
      start += span;
    }
  };
  if (reached.has(rootId)) place(rootId, -Math.PI / 2 - Math.PI + ROTATION, -Math.PI / 2 + Math.PI + ROTATION);
  const angle = new Map(nodes.map((n) => [n.id, Math.atan2(n.y - CENTER, n.x - CENTER)]));
  const placed = new Map(nodes.map((n) => [n.id, n]));
  const links: RingLink[] = [];
  for (const node of nodes) {
    if (node.private) continue;
    const seen = new Set<string>();
    let stub = 0;
    for (const link of wikilinks((byId.get(node.id) as BoundaryNote).body)) {
      const key = nameKey(link.target);
      if (seen.has(key)) continue;
      seen.add(key);
      const target = placed.get(index.get(key)?.id ?? "");
      if (target) {
        links.push({ key: `${node.id}:${key}`, sourceId: node.id, targetId: target.id, from: node, to: target });
      } else {
        const a = (angle.get(node.id) as number) + (stub - 0.5) * 0.12;
        stub += 1;
        const r = (MAX_HOP + 0.72) * SPACING;
        links.push({ key: `${node.id}:${key}`, sourceId: node.id, targetId: null, from: node, to: { x: CENTER + r * Math.cos(a), y: CENTER + r * Math.sin(a) } });
      }
    }
  }
  return { nodes, links, bearing: openBearing(nodes, links) };
}

/** The middle of the widest angular gap between nodes, link midpoints and stubs: where the handle and hop labels cover nothing. */
function openBearing(nodes: readonly RingNode[], links: readonly RingLink[]): number {
  const points = [
    ...nodes.filter((n) => n.hop > 0),
    ...links.map((l) => ({ x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2 })),
    ...links.filter((l) => l.targetId === null).map((l) => l.to),
  ];
  const angles = points.map((p) => Math.atan2(p.y - CENTER, p.x - CENTER)).sort((a, b) => a - b);
  if (angles.length === 0) return -Math.PI / 4;
  let best = { gap: angles[0] + 2 * Math.PI - angles[angles.length - 1], from: angles[angles.length - 1] };
  for (let i = 1; i < angles.length; i += 1) {
    if (angles[i] - angles[i - 1] > best.gap) best = { gap: angles[i] - angles[i - 1], from: angles[i - 1] };
  }
  return best.from + best.gap / 2;
}

type NodeState = "public" | "outside" | "private";

interface RingProps {
  notes: readonly BoundaryNote[];
  rootId: string;
  /** Boundary mode: the inside set for the drawn fill and cut states; graph mode leaves these out. */
  fillInside?: Set<string>;
  cutInside?: Set<string>;
  /** Boundary circle scale in spacing units (hop + 0.5), and whether it is being dragged. */
  boundaryScale?: number;
  dragging?: boolean;
  label: string;
  /** Overlays drawn above the canvas (the boundary handle), given the open bearing to sit on. */
  children?: (bearing: number) => ReactNode;
}

export function Ring({ notes, rootId, fillInside, cutInside, boundaryScale, dragging, label, children }: RingProps) {
  const { nodes, links, bearing } = useMemo(() => ringLayout(notes, rootId), [notes, rootId]);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current as HTMLDivElement;
    const observer = new ResizeObserver(() => element.style.setProperty("--ring-scale", String(VIEW / Math.max(element.clientWidth, 1))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const boundary = fillInside !== undefined;
  const stateOf = (node: RingNode): NodeState => (node.private ? "private" : fillInside?.has(node.id) ? "public" : "outside");
  let cutNumber = 0;
  return (
    <div ref={box} className={`ring${boundary ? " ring-boundary" : " ring-graph"}`} role="group" aria-label={label}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="ring-canvas">
        <defs>
          <pattern id={`grid-${label.replace(/\W/g, "")}`} width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M28 0H0V28" className="ring-grid" />
          </pattern>
        </defs>
        <rect width={VIEW} height={VIEW} fill={`url(#grid-${label.replace(/\W/g, "")})`} aria-hidden="true" />
        <g aria-hidden="true">
          {[1, 2, 3, 4].map((h) => (
            <g key={h}>
              <circle cx={CENTER} cy={CENTER} r={h * SPACING} className="hop-ring" />
              <text x={CENTER + h * SPACING * Math.cos(bearing) - 24 * Math.sin(bearing)} y={CENTER + h * SPACING * Math.sin(bearing) + 24 * Math.cos(bearing)}
                className="hop-label">{h}</text>
            </g>
          ))}
          {boundaryScale !== undefined && (
            <circle cx={CENTER} cy={CENTER} r={SPACING} className={`boundary${dragging ? " dragging" : ""}`}
              style={{ transform: `scale(${boundaryScale})` }} vectorEffect="non-scaling-stroke" />
          )}
        </g>
        {links.map((link) => {
          const sourceIn = cutInside?.has(link.sourceId) ?? false;
          const targetIn = link.targetId !== null && (cutInside?.has(link.targetId) ?? false);
          const state = !boundary ? "graph" : sourceIn && targetIn ? "joined" : sourceIn ? "cut" : "dormant";
          const mid = { x: (link.from.x + link.to.x) / 2, y: (link.from.y + link.to.y) / 2 };
          const named = state === "cut" ? { role: "img", "aria-label": `Cut link ${(cutNumber += 1)}` } : { "aria-hidden": true };
          return (
            <g key={link.key} className={`link link-${state}`} {...named}>
              <line x1={link.from.x} y1={link.from.y} x2={mid.x} y2={mid.y} style={{ transformOrigin: `${link.from.x}px ${link.from.y}px` }} />
              <line x1={link.to.x} y1={link.to.y} x2={mid.x} y2={mid.y} style={{ transformOrigin: `${link.to.x}px ${link.to.y}px` }} />
              {link.targetId === null && <circle cx={link.to.x} cy={link.to.y} r={3.5} className="stub" />}
              {boundary && <Scissors className="scissors" x={mid.x - 9} y={mid.y - 9} width={18} height={18} strokeWidth={2.2} aria-hidden />}
            </g>
          );
        })}
        {nodes.map((node) => {
          const state = stateOf(node);
          const name = boundary ? `${node.title}, hop ${node.hop}, ${state}` : `${node.title}, hop ${node.hop}${node.private ? ", private" : ""}`;
          const radius = node.hop === 0 ? 15 : 12;
          return (
            <g key={node.id} className={`node node-${boundary ? state : node.private ? "private" : "graph"}${node.hop === 0 ? " node-root" : ""}`}
              transform={`translate(${node.x} ${node.y})`} role="img" aria-label={name}>
              <title>{name}</title>
              <circle r={radius} className="node-disc" />
              {boundary && !node.private && <path d="M-5 0.5 L-1.5 4 L5 -3.5" className="node-check" />}
              {node.private && <Lock className="node-lock" x={-7} y={-7} width={14} height={14} strokeWidth={2} aria-hidden />}
              <text y={radius + 15} className="node-label">{shortTitle(node.title)}</text>
            </g>
          );
        })}
      </svg>
      {children?.(bearing)}
    </div>
  );
}
