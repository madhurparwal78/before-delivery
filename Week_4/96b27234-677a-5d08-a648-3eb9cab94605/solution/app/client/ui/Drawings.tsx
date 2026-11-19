import type { ReactElement } from "react";

/** A paper lantern, drawn in code: the front door, empty lists and (unlit, tilted) the denied pages. */
export function Lantern({ lit = true, size = 96 }: { lit?: boolean; size?: number }) {
  return (
    <svg className={lit ? "lantern" : "lantern unlit"} width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <path d="M48 8v10" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <rect x="34" y="16" width="28" height="9" rx="4" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M30 28h36c6 10 6 30 0 42H30c-6-12-6-32 0-42z" fill={lit ? "var(--accent)" : "var(--tile-b)"} stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 28c-4 12-4 30 0 42M56 28c4 12 4 30 0 42M48 28v42" stroke="var(--ink)" strokeWidth="2" fill="none" opacity="0.55" />
      <rect x="32" y="70" width="32" height="9" rx="4" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M42 82v6M54 82v6" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const centreOf = (column: number, row: number): { x: number; y: number } => ({ x: 130 + (column - row) * 34, y: 58 + (column + row) * 18 });

/** A raised paper block standing on a tile: top and two sides, with a hard offset shadow on the floor. */
function Block({ column, row, height, fill }: { column: number; row: number; height: number; fill: string }) {
  const { x, y } = centreOf(column, row);
  const top = y - height;
  return (
    <g strokeLinejoin="round" stroke="var(--ink)" strokeWidth="2">
      <path d={`M${x + 8} ${y + 24}l34 18l-34 18l-34 -18z`} fill="var(--ink)" opacity="0.22" stroke="none" />
      <path d={`M${x - 34} ${top} l34 18 v${height} l-34 -18z`} fill={fill} filter="brightness(0.9)" />
      <path d={`M${x + 34} ${top} l-34 18 v${height} l34 -18z`} fill={fill} />
      <path d={`M${x} ${top - 18} l34 18 l-34 18 l-34 -18z`} fill={fill} />
    </g>
  );
}

function Figure({ column, row, body }: { column: number; row: number; body: string }) {
  const { x, y } = centreOf(column, row);
  return (
    <g strokeLinejoin="round" stroke="var(--ink)" strokeWidth="2">
      <ellipse cx={x + 8} cy={y + 8} rx="17" ry="8" fill="var(--ink)" opacity="0.22" stroke="none" />
      <ellipse cx={x} cy={y + 2} rx="17" ry="8" fill={body === "own" ? "var(--accent)" : "var(--tile-b)"} />
      <path d={`M${x} ${y - 34}c9 0 12 16 8 32h-16c-4 -16 -1 -32 8 -32z`} fill={body === "own" ? "#6F879B" : "#C98B84"} />
      <circle cx={x} cy={y - 40} r="7" fill={body === "own" ? "#6F879B" : "#C98B84"} />
    </g>
  );
}

/** A small paper-cut room: two shades of floor tile, raised walls, a stool, a lantern-yellow exit and two figures on bases. */
export function MiniRoom() {
  const tiles: ReactElement[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const { x, y } = centreOf(column, row);
      const exit = column === 0 && row === 4;
      tiles.push(
        <path
          key={`${row}-${column}`}
          d={`M${x} ${y - 18}l34 18l-34 18l-34 -18z`}
          fill={exit ? "var(--accent)" : (row + column) % 2 ? "var(--tile-b)" : "var(--tile-a)"}
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinejoin="round"
        />,
      );
    }
  }
  return (
    <svg className="mini-room" viewBox="-14 -20 288 226" role="presentation" aria-hidden="true" focusable="false">
      {tiles}
      <Block column={1} row={0} height={30} fill="var(--wall)" />
      <Block column={0} row={1} height={30} fill="var(--wall)" />
      <Block column={4} row={1} height={14} fill="#D9B98C" />
      <Figure column={2} row={2} body="own" />
      <Figure column={3} row={3} body="other" />
    </svg>
  );
}
