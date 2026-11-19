// What the seat map draws: each section's canvas in cell units, its row arcs, and each seat's state from this
// viewer's point of view.
import { HALL_SEATS, LIP_HALF_WIDTH, SECTION, STAGE_DEPTH, rowRadius, seatAngle, type HallSeat, type SectionCode } from "../../shared/hall.js";
import { formatMoney } from "../../shared/rules.js";
import type { Seat, Tier } from "../../shared/types.js";

interface Canvas {
  minX: number;
  minY: number;
  width: number;
  height: number;
  rows: { letter: string; radius: number; arc: string; left: { x: number; y: number }; right: { x: number; y: number } }[];
  seats: HallSeat[];
}

const MARGIN = 0.6;

function point(rowIndex: number, number: number): { x: number; y: number } {
  const radius = rowRadius(rowIndex);
  const theta = seatAngle(rowIndex, number);
  return { x: radius * Math.sin(theta), y: radius * Math.cos(theta) };
}

function buildCanvas(code: SectionCode): Canvas {
  const rows = SECTION[code].rows.map((letter, index) => {
    const radius = rowRadius(index);
    const from = point(index, 0.5);
    const to = point(index, 30.5);
    return {
      letter, radius,
      arc: `M ${from.x.toFixed(3)} ${from.y.toFixed(3)} A ${radius} ${radius} 0 0 0 ${to.x.toFixed(3)} ${to.y.toFixed(3)}`,
      left: { x: point(index, 1).x - 0.95, y: point(index, 1).y },
      right: { x: point(index, 30).x + 0.95, y: point(index, 30).y },
    };
  });
  const xs = rows.flatMap((r) => [r.left.x, r.right.x]);
  const ys = rows.flatMap((r) => [r.left.y, r.right.y, r.radius]);
  const minX = Math.min(...xs, -LIP_HALF_WIDTH) - MARGIN;
  const maxX = Math.max(...xs, LIP_HALF_WIDTH) + MARGIN;
  const minY = -STAGE_DEPTH - MARGIN;
  const maxY = Math.max(...ys) + 0.5 + MARGIN;
  return { minX, minY, width: maxX - minX, height: maxY - minY, rows, seats: HALL_SEATS.filter((s) => s.section === code) };
}

export const CANVASES: Record<SectionCode, Canvas> = { ST: buildCanvas("ST"), CI: buildCanvas("CI"), BA: buildCanvas("BA") };

/** The seat's state for this viewer, also the wedge's `data-state`. */
export type Look = "on_sale" | "selected" | "held_by_you" | "yours" | "offered_to_you" | "taken" | "not_on_sale";

const WORDS: Record<Look, string> = {
  on_sale: "On sale",
  selected: "Selected",
  held_by_you: "Held by you",
  yours: "Your ticket",
  offered_to_you: "Offered to you",
  taken: "Taken",
  not_on_sale: "Not on sale",
};

export function lookOf(seat: Seat | undefined, selected: boolean): Look {
  if (!seat || seat.state === "not_on_sale") return "not_on_sale";
  if (seat.state === "on_sale") return selected ? "selected" : "on_sale";
  if (!seat.mine) return "taken";
  return seat.state === "held" ? "held_by_you" : seat.state === "sold" ? "yours" : "offered_to_you";
}

/** The readout's third line: shown for every state except on sale and selected. */
export const readoutLine = (look: Look): string | null => (look === "on_sale" || look === "selected" ? null : WORDS[look]);

export function cellName(label: string, look: Look, tier: Tier | undefined): string {
  if (look === "not_on_sale" || !tier) return `${label}, Not on sale`;
  return `${label}, ${tier.name}, ${formatMoney(tier.faceCents)}, ${WORDS[look]}`;
}

/** A seat can be selected when it is on sale and in the chosen tier (`all` takes every tier). */
export const selectable = (seat: Seat | undefined, tierChoice: string): boolean =>
  !!seat && seat.state === "on_sale" && (tierChoice === "all" || seat.tierId === tierChoice);

export function seatIdAt(code: SectionCode, rowIndex: number, number: number): string {
  return `${code}-${SECTION[code].rows[rowIndex]}-${number}`;
}
