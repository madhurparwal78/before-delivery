import { createElement, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import type { SnapshotCircuit } from "../../shared/types";
import { DOT_RADIUS, partNodes, terminalMark, wireColour, type SvgNode } from "./drawing";
import { boardGeometry, roundedPath, slotCenter, terminalPoint, wireRoute, type Point } from "./layout";
import { parseEnd, terminalEnd, type TerminalSign } from "./model";
import type { PartView } from "./readouts";
import type { DragState } from "./useTerminalDrag";

const RAIL_HOLES = 28;

/** SVG attribute names are written hyphenated in the shared drawings; React wants them in camel case. */
function reactName(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function renderNode(node: SvgNode, key: number): ReactNode {
  const props: Record<string, string | number> = { key };
  for (const [name, value] of Object.entries(node.attrs)) props[reactName(name)] = value;
  return createElement(node.tag, props, node.text ?? node.children?.map(renderNode));
}

function Rails({ width, height }: { width: number; height: number }) {
  const pitch = (width - 80) / (RAIL_HOLES - 1);
  const rows = [
    { y: 10, colour: "#e0475b" },
    { y: 22, colour: "#1e90ff" },
    { y: height - 22, colour: "#e0475b" },
    { y: height - 10, colour: "#1e90ff" },
  ];
  return (
    <g>
      {rows.map(({ y, colour }) => (
        <g key={y}>
          <line x1={28} x2={width - 28} y1={y} y2={y} stroke={colour} strokeWidth={1.5} strokeOpacity={0.5} />
          {Array.from({ length: RAIL_HOLES }, (_, i) => <circle key={i} cx={40 + i * pitch} cy={y} r={2.2} className="board-hole" />)}
        </g>
      ))}
    </g>
  );
}

function EmptyDoodle({ width, height }: { width: number; height: number }) {
  const cx = width / 2;
  const cy = height / 2;
  return (
    <g className="board-doodle">
      <path d={`M${cx - 120} ${cy + 24} V${cy - 14} Q${cx - 120} ${cy - 40} ${cx - 94} ${cy - 40} H${cx + 94} Q${cx + 120} ${cy - 40} ${cx + 120} ${cy - 14} V${cy + 24}`} />
      <text x={cx} y={cy + 8} textAnchor="middle">Add a battery and an LED to begin</text>
    </g>
  );
}

interface BreadboardProps {
  circuit: SnapshotCircuit;
  views: ReadonlyMap<string, PartView>;
  columns: number;
  pending: string | null;
  boardRef: RefObject<SVGSVGElement | null>;
  drag: DragState | null;
  onTerminal: (end: string) => void;
  onTerminalPointer: (end: string, event: ReactPointerEvent) => void;
  onPart: (label: string) => void;
}

/** Terminal dots forward to the same wiring logic as the terminal buttons in the Components list. */
export function Breadboard({ circuit, views, columns, pending, boardRef, drag, onTerminal, onTerminalPointer, onPart }: BreadboardProps) {
  const geometry = boardGeometry(circuit.components.length, columns);
  const indexOf = new Map(circuit.components.map((c, i) => [c.label, i]));

  const anchorOf = (end: string): { point: Point; index: number; sign: TerminalSign } | null => {
    const ref = parseEnd(end);
    const index = ref ? indexOf.get(ref.label) : undefined;
    return ref && index !== undefined ? { point: terminalPoint(index, columns, ref.sign), index, sign: ref.sign } : null;
  };

  const routes = circuit.wires.flatMap((wire, lane) => {
    const from = anchorOf(wire.from);
    const to = anchorOf(wire.to);
    return from && to ? [{ lane, d: roundedPath(wireRoute(from, to, columns, lane)) }] : [];
  });

  const dragFrom = drag ? anchorOf(drag.from) : null;
  const dragTo = drag?.over ? anchorOf(drag.over) : null;
  const pointer = dragTo ? dragTo.point : drag ? { x: drag.x, y: drag.y } : null;

  return (
    <svg
      ref={boardRef}
      className="board"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      width={geometry.width}
      height={geometry.height}
      role="img"
      aria-label="Breadboard"
    >
      <defs>
        <pattern id="board-holes" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="1.6" className="board-hole" />
        </pattern>
      </defs>
      <rect className="board-body" x={4} y={4} width={geometry.width - 8} height={geometry.height - 8} rx={16} />
      <rect x={4} y={4} width={geometry.width - 8} height={geometry.height - 8} rx={16} fill="url(#board-holes)" />
      <Rails width={geometry.width} height={geometry.height} />
      {circuit.components.length === 0 ? <EmptyDoodle width={geometry.width} height={geometry.height} /> : null}
      {circuit.components.map((part, index) => {
        const view = views.get(part.label);
        if (!view) return null;
        const centre = slotCenter(index, columns);
        const nodes = partNodes(part, { status: view.status, glow: view.glow, detail: view.words });
        return (
          <g
            key={part.label}
            className="board-part"
            transform={`translate(${centre.x} ${centre.y})`}
            data-part={part.label}
            data-brightness={view.brightness ?? undefined}
            onClick={() => onPart(part.label)}
          >
            <rect x={-78} y={-34} width={156} height={104} fill="transparent" />
            {nodes.map(renderNode)}
          </g>
        );
      })}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {routes.map(({ lane, d }) => (
          <g key={lane}>
            <path d={d} stroke="#ffffff" strokeWidth={9} strokeOpacity={0.9} />
            <path d={d} stroke={wireColour(lane)} strokeWidth={5} />
          </g>
        ))}
      </g>
      {dragFrom && pointer ? (
        <line className="board-drag" x1={dragFrom.point.x} y1={dragFrom.point.y} x2={pointer.x} y2={pointer.y} />
      ) : null}
      {circuit.components.flatMap((part, index) =>
        (["+", "-"] as const).map((sign) => {
          const end = terminalEnd({ label: part.label, sign });
          const point = terminalPoint(index, columns, sign);
          const state = pending === end || drag?.from === end ? "pending" : drag?.over === end ? "target" : "idle";
          return (
            <g key={end} className="board-terminal" data-state={state}>
              {renderNode(terminalMark(point.x, point.y, sign), 0)}
              <circle className="board-dot" cx={point.x} cy={point.y} r={DOT_RADIUS} />
              <circle
                className="board-hit"
                data-terminal={end}
                cx={point.x}
                cy={point.y}
                r={DOT_RADIUS + 9}
                onPointerDown={(event) => onTerminalPointer(end, event)}
                onClick={() => onTerminal(end)}
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}
