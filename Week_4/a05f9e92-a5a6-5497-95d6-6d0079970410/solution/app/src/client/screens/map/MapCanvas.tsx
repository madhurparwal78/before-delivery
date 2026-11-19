import type { KeyboardEvent } from "react";
import { NODE_HEIGHT, NODE_WIDTH, STATUS_LABELS, type MapData, type MapEdge, type MapNode } from "./mapData.js";
import { firstNode, nextNode } from "./mapNav.js";

const MARGIN = 40;
const NAVIGATION_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];

type Line = { key: string; type: string; path: string; touches: string[] };

/** Where a relationship line leaves one node and enters the other: bottom and top edges across rows, side edges within a row. */
function lineBetween(source: MapNode, target: MapNode, type: string): Line {
  const key = `${source.name}|${type}|${target.name}`;
  const touches = [source.name, target.name];
  if (source.y === target.y) {
    const rightward = source.x < target.x;
    const y = source.y + NODE_HEIGHT / 2;
    return { key, type, touches, path: `M${source.x + (rightward ? NODE_WIDTH : 0)} ${y}L${target.x + (rightward ? 0 : NODE_WIDTH)} ${y}` };
  }
  const down = source.y < target.y;
  const x1 = source.x + NODE_WIDTH / 2;
  const y1 = source.y + (down ? NODE_HEIGHT : 0);
  const x2 = target.x + NODE_WIDTH / 2;
  const y2 = target.y + (down ? 0 : NODE_HEIGHT);
  const bend = (y2 - y1) / 2;
  return { key, type, touches, path: `M${x1} ${y1}C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}` };
}

const lineClass = (type: string): string => (type === "member of" ? "line-member" : type === "connects to" || type === "backs up" ? "line-soft" : "line-dependency");

export function MapCanvas({
  data,
  current,
  expanded,
  onCurrent,
  onToggle,
}: {
  data: MapData;
  current: string | null;
  expanded: string | null;
  onCurrent: (name: string) => void;
  onToggle: (name: string) => void;
}): JSX.Element {
  const byName = new Map(data.nodes.map((node) => [node.name, node]));
  const classOf = new Map(data.cis.map((ci) => [ci.name, ci]));
  const width = Math.max(0, ...data.nodes.map((node) => node.x)) + NODE_WIDTH + MARGIN;
  const height = Math.max(0, ...data.nodes.map((node) => node.y)) + NODE_HEIGHT + MARGIN;
  const tabStop = current && byName.has(current) ? current : firstNode(data.nodes);
  const lines = data.edges.flatMap((edge: MapEdge) => {
    const source = byName.get(edge.source);
    const target = byName.get(edge.target);
    return source && target ? [lineBetween(source, target, edge.type)] : [];
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset.node;
    if (!from || event.altKey || event.ctrlKey || event.metaKey || !NAVIGATION_KEYS.includes(event.key)) return;
    event.preventDefault();
    const to = nextNode(data.nodes, from, event.key);
    if (!to) return;
    onCurrent(to);
    event.currentTarget.querySelector<HTMLElement>(`[data-node="${CSS.escape(to)}"] button`)?.focus();
  };

  return (
    <div role="group" aria-label="Service map" className="map-canvas" onKeyDown={onKeyDown}>
      <div className="map-plane" style={{ width, height }}>
        <svg className="map-edges" width={width} height={height} aria-hidden="true" focusable="false">
          <defs>
            <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {lines.map((line) => (
            <path
              key={line.key}
              className={`map-line ${lineClass(line.type)} ${current && line.touches.includes(current) ? "line-active" : ""}`}
              d={line.path}
              markerEnd="url(#map-arrow)"
            />
          ))}
        </svg>
        {data.nodes.map((node) => {
          const ci = classOf.get(node.name);
          const status = ci?.effective_status ?? node.status;
          const classLabel = ci?.class ?? node.class;
          return (
            <div key={node.name} className="map-node-wrap" data-node={node.name} data-x={node.x} data-y={node.y} style={{ left: node.x, top: node.y }}>
              <button
                type="button"
                className={`map-node node-${status} ${expanded === node.name ? "is-expanded" : ""}`}
                aria-label={`${node.name}, ${classLabel}, ${STATUS_LABELS[status]}`}
                aria-expanded={expanded === node.name}
                tabIndex={node.name === tabStop ? 0 : -1}
                onFocus={() => onCurrent(node.name)}
                onClick={() => onToggle(node.name)}
              >
                {/* Source order follows the accessible name (name, class, status); CSS puts the status chip on top. */}
                <span className="node-name" aria-hidden="true">
                  {node.name}
                </span>{" "}
                <span className="node-class" aria-hidden="true">
                  {classLabel}
                </span>{" "}
                <span className="node-status" aria-hidden="true">
                  {STATUS_LABELS[status]}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
