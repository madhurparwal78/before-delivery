import type { FlavourSlug } from '../../../shared/catalogue.js';

export interface FlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Flight {
  id: number;
  flavour: FlavourSlug;
  from: FlightRect;
  to: FlightRect;
  /** `drop` flies a can token into its slot; `return` flies a refused one back. */
  mode: 'drop' | 'return';
}

const slotTargets = new Map<number, HTMLElement>();
const cardSources = new Map<string, HTMLElement>();
const listeners = new Set<(flight: Flight) => void>();
let nextId = 1;

export function registerSlot(index: number, element: HTMLElement | null): void {
  if (element === null) slotTargets.delete(index);
  else slotTargets.set(index, element);
}

export function registerCardToken(flavour: FlavourSlug, element: HTMLElement | null): void {
  if (element === null) cardSources.delete(flavour);
  else cardSources.set(flavour, element);
}

function rectOf(element: HTMLElement | undefined): FlightRect | null {
  if (element === undefined) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

export function subscribeFlights(listener: (flight: Flight) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Starts a can token's flight from a flavour card to a crate slot, or back. */
export function launchFlight(
  flavour: FlavourSlug,
  slotIndex: number,
  mode: 'drop' | 'return',
): void {
  const card = rectOf(cardSources.get(flavour));
  const slot = rectOf(slotTargets.get(slotIndex));
  if (card === null || slot === null) return;
  const flight: Flight = {
    id: nextId++,
    flavour,
    from: mode === 'drop' ? card : slot,
    to: mode === 'drop' ? slot : card,
    mode,
  };
  for (const listener of listeners) listener(flight);
}
