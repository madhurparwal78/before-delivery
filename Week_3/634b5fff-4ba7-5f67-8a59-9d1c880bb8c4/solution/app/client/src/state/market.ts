import { EDITION, type CellState, type PublicBoxState } from "../../../shared/domain.js";
import { get } from "../api.js";
import { Store } from "./store.js";

/** The shelf and the edition as the server last said: one fetch, then the server's pushed changes. */

interface ShelfState {
  loaded: boolean;
  salesPaused: boolean;
  states: readonly PublicBoxState[];
}

interface EditionInfo {
  priceOre: number;
  totalOre: number;
  charityOre: number;
  salesOpen: boolean;
}

interface ShelfBody {
  salesPaused: boolean;
  boxes: { number: number; state: PublicBoxState }[];
}

const RETRY_MS = 2000;
const STREAM_SETTLE_MS = 1000;

export const shelf = new Store<ShelfState>({ loaded: false, salesPaused: false, states: [] });
export const edition = new Store<EditionInfo | null>(null);

const STATES: readonly string[] = ["available", "held", "taken"];
const isState = (value: unknown): value is PublicBoxState => typeof value === "string" && STATES.includes(value);

const loadShelf = async (): Promise<void> => {
  try {
    const { body } = await get<ShelfBody>("/api/shelf");
    const states: PublicBoxState[] = Array.from({ length: EDITION }, () => "available");
    for (const box of body.boxes) states[box.number - 1] = box.state;
    shelf.set({ loaded: true, salesPaused: body.salesPaused, states });
  } catch {
    setTimeout(() => void loadShelf(), RETRY_MS);
  }
};

const loadEdition = async (): Promise<void> => {
  try {
    edition.set((await get<EditionInfo>("/api/edition")).body);
  } catch {
    setTimeout(() => void loadEdition(), RETRY_MS);
  }
};

const record = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {};
};

const onBox = (text: string): void => {
  const { number, state } = record(text);
  if (typeof number !== "number" || !isState(state)) return;
  shelf.update((current) => {
    const states = [...current.states];
    states[number - 1] = state;
    return { ...current, states };
  });
};

const onSales = (text: string): void => {
  const { salesPaused, salesOpen } = record(text);
  if (typeof salesPaused === "boolean") shelf.update((current) => ({ ...current, salesPaused }));
  if (typeof salesOpen === "boolean") edition.update((current) => (current ? { ...current, salesOpen } : current));
};

let started = false;

/** Opens the server's event stream; each connection re-reads the shelf and edition, so nothing sent before it is missed. */
const openStream = (): void => {
  const source = new EventSource("/api/shelf/events");
  source.addEventListener("box", (event) => onBox(event.data));
  source.addEventListener("sales", (event) => onSales(event.data));
  source.onopen = () => {
    void loadShelf();
    void loadEdition();
  };
};

const pageLoaded = (): Promise<void> =>
  new Promise((resolve) => {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", () => resolve(), { once: true });
  });

/**
 * Loads the shelf and the edition once and keeps them current from the server's event stream, which stays open for
 * good and so waits until the page's first load has settled. A native timer: it runs even while page timers are paused.
 */
export const startMarket = (): void => {
  if (started) return;
  started = true;
  void Promise.all([loadShelf(), loadEdition(), pageLoaded()]).then(() => {
    AbortSignal.timeout(STREAM_SETTLE_MS).addEventListener("abort", openStream, { once: true });
  });
};

/** The state of every cell, with the reader's own held box as `yours`. */
export const cellStates = (states: readonly PublicBoxState[], own: number | null): CellState[] =>
  states.map((state, index) => (own === index + 1 ? "yours" : state));
