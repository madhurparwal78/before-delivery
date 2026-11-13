import type { Grant, Tranche } from "../../shared/types.js";
import { formatDate } from "../../shared/format.js";
import { el } from "../dom.js";

export interface RibbonCell {
  /** The month marks this cell stands for, in order. */
  marks: number[];
  label: string;
  tranche: Tranche;
}

/** The published cell rule: one cliff cell for marks 1 to 12, then one cell per mark. */
export function ribbonCells(grant: Grant): RibbonCell[] {
  const cells: RibbonCell[] = [];
  const at = (mark: number): Tranche | undefined => grant.schedule[mark];
  if (grant.vesting_type === "standard") {
    const cliff = at(12);
    if (cliff === undefined) return cells;
    cells.push({ marks: Array.from({ length: 12 }, (_, index) => index + 1), label: formatDate(cliff.date), tranche: cliff });
    for (let mark = 13; mark <= 48; mark += 1) {
      const tranche = at(mark);
      if (tranche === undefined) continue;
      cells.push({ marks: [mark], label: formatDate(tranche.date), tranche });
    }
    return cells;
  }
  for (let mark = 1; mark <= 48; mark += 1) {
    const tranche = at(mark);
    if (tranche === undefined) continue;
    cells.push({ marks: [mark], label: formatDate(tranche.date), tranche });
  }
  return cells;
}

export function cellIndexForMark(cells: readonly RibbonCell[], mark: number): number {
  if (mark <= 0) return 0;
  const index = cells.findIndex((cell) => cell.marks.includes(mark));
  return index === -1 ? 0 : index;
}

export interface RibbonView {
  track: HTMLElement;
  list: HTMLElement;
  cells: RibbonCell[];
  nodes: HTMLElement[];
  paint(markerMark: number): void;
  /** Repaints the same cells from a newer grant, so a live change fills in place. */
  update(grant: Grant, markerMark: number): void;
}

function cellState(cell: RibbonCell, grant: Grant, markerIndex: number, index: number): string {
  if (cell.tranche.state === "cancelled") return "cancelled";
  if (cell.tranche.state === "vested") return "vested";
  const todayIndex = cellIndexForMark(ribbonCellsOf(grant), serverMark(grant));
  if (index > todayIndex && index <= markerIndex) return "projected";
  return "unvested";
}

const cellCache = new WeakMap<Grant, RibbonCell[]>();

function ribbonCellsOf(grant: Grant): RibbonCell[] {
  const cached = cellCache.get(grant);
  if (cached !== undefined) return cached;
  const cells = ribbonCells(grant);
  cellCache.set(grant, cells);
  return cells;
}

/** The month index of the latest tranche date on or before the server date. */
export function serverMark(grant: Grant): number {
  let latest = 0;
  for (const tranche of grant.schedule) {
    if (tranche.month === 0) continue;
    if (tranche.date <= grant.server_date) latest = tranche.month;
  }
  return latest;
}

export function buildRibbon(grant: Grant): RibbonView {
  let current = grant;
  const view: RibbonView = {
    track: el("div", { class: "ribbon-track" }),
    list: el("ul", { class: "ribbon-list", role: "list", "aria-label": "Tranches" }),
    cells: ribbonCellsOf(grant),
    nodes: [],
    paint(markerMark: number): void {
      const markerIndex = cellIndexForMark(view.cells, markerMark);
      view.cells.forEach((cell, index) => {
        const node = view.nodes[index];
        if (node === undefined) return;
        const state = cellState(cell, current, markerIndex, index);
        node.classList.toggle("is-vested", state === "vested");
        node.classList.toggle("is-projected", state === "projected");
        node.classList.toggle("is-cancelled", state === "cancelled");
        node.classList.toggle("is-unvested", state === "unvested");
        node.setAttribute("aria-label", `${cell.label}, ${cell.tranche.cumulative} options, ${state}`);
      });
    },
    update(next: Grant, markerMark: number): void {
      current = next;
      view.cells = ribbonCellsOf(next);
      view.paint(markerMark);
    },
  };
  for (const cell of view.cells) {
    const node = el("li", { class: "ribbon-cell", role: "listitem" }, [
      el("span", { class: "ribbon-cell-date" }, [cell.label]),
    ]);
    view.nodes.push(node);
    view.list.append(node);
  }
  view.track.append(view.list);
  return view;
}
