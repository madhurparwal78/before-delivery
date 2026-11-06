import type { Cell, Hold, Loom, LoomCell, Station } from "../types";

// The loom's pure model: columns, the brush rectangle, what each cell shows, and the address form.

export const COLUMNS: string[] = Array.from({ length: 80 }, (_, i) => clock(4 * 60 + 15 * i));

export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export interface Pos {
  row: number;
  col: number;
}

export interface Brush {
  anchor: Pos;
  end: Pos;
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function rectOf(brush: Brush): Rect {
  return {
    top: Math.min(brush.anchor.row, brush.end.row),
    bottom: Math.max(brush.anchor.row, brush.end.row),
    left: Math.min(brush.anchor.col, brush.end.col),
    right: Math.max(brush.anchor.col, brush.end.col),
  };
}

export const keyOf = (stationId: string, start: string): string => `${stationId}@${start}`;

export type Kind = "free" | "selected" | "held" | "booked" | "taken" | "conflict" | "papers";

export interface CellView {
  kind: Kind;
  /** The accessible label: free, selected, held, booked, taken, taken conflicts with your brush, papers. */
  label: string;
  /** The visible run label, or a business name for operators. */
  run: string;
}

const RUN_WORDS: Record<Kind, string> = {
  free: "",
  selected: "Selected",
  held: "Held",
  booked: "Booked",
  taken: "Taken",
  conflict: "Conflict",
  papers: "Papers",
};

function view(kind: Kind, business?: string): CellView {
  if (business && (kind === "held" || kind === "booked")) return { kind, label: `${kind} by ${business}`, run: business };
  const label = kind === "conflict" ? "taken conflicts with your brush" : kind;
  return { kind, label, run: RUN_WORDS[kind] };
}

/**
 * What every visible cell shows. `lost` are cells the server just refused; the live hold made on
 * this screen stays paintable because placing a new brush releases it first.
 */
export function cellViews(
  stations: Station[],
  loom: Loom | null,
  operator: boolean,
  brush: Brush | null,
  hold: Hold | null,
  holdBusiness: string | undefined,
  lost: Set<string>,
): CellView[][] {
  const occupied = new Map<string, LoomCell>();
  for (const cell of loom?.cells ?? []) occupied.set(keyOf(cell.station_id, cell.start), cell);
  const ownHold = new Set((hold && hold.date === loom?.date ? hold.cells : []).map((c) => keyOf(c.station_id, c.start)));
  const rect = brush ? rectOf(brush) : null;
  return stations.map((station, row) =>
    COLUMNS.map((start, col) => {
      const key = keyOf(station.id, start);
      const occupant = occupied.get(key);
      const inBrush = rect !== null && row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
      const papers = loom?.papers === true;
      if (inBrush) {
        if (papers && (!occupant || ownHold.has(key))) return view("papers");
        if ((!occupant || ownHold.has(key)) && !lost.has(key)) return view("selected");
        return view("conflict");
      }
      if (ownHold.has(key)) return view("held", operator ? (occupant?.business ?? holdBusiness) : undefined);
      if (occupant) {
        if (occupant.state === "taken") return view("taken");
        return view(occupant.state, operator ? occupant.business : undefined);
      }
      if (lost.has(key)) return view("taken");
      return view(papers ? "papers" : "free");
    }),
  );
}

export function selectedCells(stations: Station[], views: CellView[][]): Cell[] {
  const cells: Cell[] = [];
  views.forEach((row, r) =>
    row.forEach((v, c) => {
      const station = stations[r];
      const start = COLUMNS[c];
      if (v.kind === "selected" && station && start) cells.push({ station_id: station.id, start });
    }),
  );
  return cells;
}

/** `sel=<top id>..<bottom id>@<HH:MM>-<HH:MM>` with an exclusive end. */
export function formatSel(stations: Station[], brush: Brush): string | null {
  const rect = rectOf(brush);
  const top = stations[rect.top];
  const bottom = stations[rect.bottom];
  const start = COLUMNS[rect.left];
  if (!top || !bottom || !start) return null;
  return `${top.id}..${bottom.id}@${start}-${clock(minutesOf(start) + 15 * (rect.right - rect.left + 1))}`;
}

export function parseSel(stations: Station[], value: string | null): Brush | null {
  const match = /^([\w-]+)\.\.([\w-]+)@(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [, topId, bottomId, start = "", end = ""] = match;
  const top = stations.findIndex((s) => s.id === topId);
  const bottom = stations.findIndex((s) => s.id === bottomId);
  const left = COLUMNS.indexOf(start);
  const endMinutes = minutesOf(end);
  const right = (endMinutes - 4 * 60) / 15 - 1;
  if (top < 0 || bottom < top || left < 0 || !Number.isInteger(right) || right < left || right > 79 || endMinutes % 15 !== 0) return null;
  return { anchor: { row: top, col: left }, end: { row: bottom, col: right } };
}

/** Runs of two or more equal cells in a row, keyed by their first column. */
export function runsOf(row: CellView[]): Map<number, number> {
  const runs = new Map<number, number>();
  let start = 0;
  for (let col = 1; col <= row.length; col += 1) {
    const a = row[start];
    const b = row[col];
    if (!b || !a || b.kind !== a.kind || b.run !== a.run) {
      if (a && a.kind !== "free" && col - start >= 2) runs.set(start, col - start);
      start = col;
    }
  }
  return runs;
}
