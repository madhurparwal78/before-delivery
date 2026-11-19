import { useSyncExternalStore } from "react";

/** Whether an exhibit is lit over the grid, and which card it came from. The grid dims while one is open. */
interface ExhibitState {
  open: boolean;
  cardId: number | null;
  /** The card's own image stays hidden from the moment the print is carried out until it is carried back. */
  hideCard: boolean;
}

let state: ExhibitState = { open: false, cardId: null, hideCard: false };
const listeners = new Set<() => void>();

export function setExhibit(next: ExhibitState): void {
  if (next.open === state.open && next.cardId === state.cardId && next.hideCard === state.hideCard) return;
  state = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useExhibit = (): ExhibitState => useSyncExternalStore(subscribe, () => state);
