import type { BoardOrder } from "./types.js";

/** Pure helpers over a board's order; the server writes it and the client reads it, with the same meaning. */

export const flatten = (order: BoardOrder): number[] => [...order.unsectioned, ...order.sections.flatMap((section) => section.pins)];

/** The container (the unsectioned area or one section) as a mutable array. */
export function containerOf(order: BoardOrder, sectionId: number | null): number[] | null {
  if (sectionId === null) return order.unsectioned;
  return order.sections.find((section) => section.id === sectionId)?.pins ?? null;
}

/** The container a pin currently sits in. */
export function containerHolding(order: BoardOrder, pinId: number): { sectionId: number | null; pins: number[] } | null {
  if (order.unsectioned.includes(pinId)) return { sectionId: null, pins: order.unsectioned };
  const section = order.sections.find((candidate) => candidate.pins.includes(pinId));
  return section ? { sectionId: section.id, pins: section.pins } : null;
}

/** A board's cover: the chosen pin while it is on the board, else the first pin by position, else nothing. */
export function coverOf(order: BoardOrder, chosen: number | null): number | null {
  if (chosen !== null && flatten(order).includes(chosen)) return chosen;
  return order.unsectioned[0] ?? order.sections.find((section) => section.pins.length > 0)?.pins[0] ?? null;
}

export function removeFromOrder(order: BoardOrder, ids: ReadonlySet<number>): void {
  order.unsectioned = order.unsectioned.filter((id) => !ids.has(id));
  for (const section of order.sections) section.pins = section.pins.filter((id) => !ids.has(id));
}
