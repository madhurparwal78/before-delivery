import type { ReactElement } from "react";
import type { CircuitComponent, SnapshotCircuit } from "../../shared/types";
import { TOY_COLORS } from "./palette";

const COLUMNS = 3;
const CELL_W = 56;
const CELL_H = 64;
const PAD = 14;
const INK = "#282727";

interface Terminals {
  plus: [number, number];
  minus: [number, number];
}

/** The battery's plus side faces right; every other part has it on the left, where current enters. */
function terminalsOf(component: CircuitComponent, cx: number, cy: number): Terminals {
  const left: [number, number] = [cx - 17, cy];
  const right: [number, number] = [cx + 17, cy];
  return component.type === "battery" ? { plus: right, minus: left } : { plus: left, minus: right };
}

function glyph(component: CircuitComponent, cx: number, cy: number, key: string): ReactElement {
  const [green, purple, orange, azure] = TOY_COLORS;
  switch (component.type) {
    case "battery":
      return (
        <g key={key}>
          <rect x={cx - 12} y={cy - 10} width="24" height="20" rx="4" fill={green} />
          <path d={`M${cx + 3} ${cy - 6}v12M${cx - 5} ${cy - 3}v6`} stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      );
    case "resistor":
      return <path key={key} d={`M${cx - 15} ${cy}h4l3-7 6 14 6-14 6 14 3-7h4`} fill="none" stroke={orange} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
    case "led":
      return (
        <g key={key}>
          <path d={`M${cx - 8} ${cy - 9}L${cx + 8} ${cy}L${cx - 8} ${cy + 9}Z`} fill={azure} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          <path d={`M${cx + 9} ${cy - 9}v18M${cx + 3} ${cy - 13}l5-5M${cx + 9} ${cy - 13}l5-5`} stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
        </g>
      );
    case "switch":
      return (
        <g key={key}>
          <path d={component.closed ? `M${cx - 12} ${cy}H${cx + 12}` : `M${cx - 12} ${cy}L${cx + 10} ${cy - 11}`} stroke={purple} strokeWidth="3" strokeLinecap="round" />
          <circle cx={cx - 12} cy={cy} r="3" fill={purple} /><circle cx={cx + 12} cy={cy} r="3" fill={purple} />
        </g>
      );
  }
}

/** A small wiring picture: each part drawn in a grid cell and every wire routed above its row. */
export function CircuitStill({ snapshot, className }: { snapshot: SnapshotCircuit; className?: string }) {
  const count = Math.max(snapshot.components.length, 1);
  const columns = Math.min(count, COLUMNS);
  const rows = Math.ceil(count / columns);
  const width = columns * CELL_W + 2 * PAD;
  const height = rows * CELL_H + 2 * PAD;
  const centre = (index: number): [number, number] => [PAD + CELL_W / 2 + (index % columns) * CELL_W, PAD + CELL_H / 2 + 8 + Math.floor(index / columns) * CELL_H];
  const placed = snapshot.components.map((component, i) => {
    const [cx, cy] = centre(i);
    return { component, cx, cy, ...terminalsOf(component, cx, cy) };
  });
  const terminals = new Map(placed.flatMap(({ component, plus, minus }): [string, [number, number]][] => [[`${component.label}+`, plus], [`${component.label}-`, minus]]));
  const wires = snapshot.wires.flatMap((wire, i) => {
    const from = terminals.get(wire.from), to = terminals.get(wire.to);
    if (!from || !to) return [];
    const lane = Math.min(from[1], to[1]) - 14 - (i % 3) * 4;
    return [<path key={`w${i}`} d={`M${from[0]} ${from[1]}V${lane}H${to[0]}V${to[1]}`} fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />];
  });
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" aria-hidden="true" focusable="false">
      {snapshot.components.length === 0 && (
        <rect x={PAD} y={PAD} width={width - 2 * PAD} height={height - 2 * PAD} rx="8" fill="none" stroke="var(--slate)" strokeWidth="1.5" strokeDasharray="5 4" />
      )}
      {wires}
      {placed.map(({ component, cx, cy, plus, minus }, i) => (
        <g key={component.label}>
          {glyph(component, cx, cy, `g${i}`)}
          {[plus, minus].map(([x, y], t) => <circle key={t} cx={x} cy={y} r="2.4" fill="#fff" stroke={INK} strokeWidth="1.2" />)}
        </g>
      ))}
    </svg>
  );
}
