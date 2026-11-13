import { call } from './api.js';
import type { EditionResponse, PublicBoxState, ShelfResponse } from '../shared/types.js';

export type SoundChoice = 'on' | 'off';

export interface HeldBox {
  number: number;
  plate: string;
  holdToken: string;
  holdMs: number;
  remainingMs: number;
}

export interface StoredOrder {
  reference: string;
  orderToken: string;
}

const SOUND_KEY = 'press.sound';
const HOLD_KEY = 'press.hold';
const ORDER_KEY = 'press.order';

/** The hold token belongs to this browser session, so a reload keeps it. */
export const store = {
  soundChoice(): SoundChoice | null {
    const raw = localStorage.getItem(SOUND_KEY);
    return raw === 'on' || raw === 'off' ? raw : null;
  },
  chooseSound(choice: SoundChoice): void {
    localStorage.setItem(SOUND_KEY, choice);
  },
  hold(): HeldBox | null {
    const raw = sessionStorage.getItem(HOLD_KEY);
    return raw === null ? null : (JSON.parse(raw) as HeldBox);
  },
  keepHold(hold: HeldBox): void {
    sessionStorage.setItem(HOLD_KEY, JSON.stringify(hold));
  },
  dropHold(): void {
    sessionStorage.removeItem(HOLD_KEY);
  },
  order(): StoredOrder | null {
    const raw = sessionStorage.getItem(ORDER_KEY);
    return raw === null ? null : (JSON.parse(raw) as StoredOrder);
  },
  keepOrder(order: StoredOrder): void {
    sessionStorage.setItem(ORDER_KEY, JSON.stringify(order));
  },
  dropOrder(): void {
    sessionStorage.removeItem(ORDER_KEY);
  },
};

export interface ShelfModel {
  salesPaused: boolean;
  salesOpen: boolean;
  remaining: number;
  states: Map<number, PublicBoxState>;
  plates: Map<number, string>;
}

export const shelfModel: ShelfModel = {
  salesPaused: false,
  salesOpen: true,
  remaining: 240,
  states: new Map(),
  plates: new Map(),
};

export let edition: EditionResponse | null = null;

export async function loadEdition(): Promise<EditionResponse> {
  if (edition === null) edition = await call<EditionResponse>('/api/edition');
  return edition;
}

export async function loadShelf(): Promise<void> {
  const shelf = await call<ShelfResponse>('/api/shelf');
  shelfModel.salesPaused = shelf.salesPaused;
  shelfModel.remaining = shelf.remaining;
  for (const box of shelf.boxes) {
    shelfModel.states.set(box.number, box.state);
    shelfModel.plates.set(box.number, box.plate);
  }
}

type ShelfListener = () => void;
const listeners = new Set<ShelfListener>();

export function onShelfChange(listener: ShelfListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

/** Every change is pushed to this page from the server's stream. */
export function openShelfStream(): void {
  const source = new EventSource('/api/shelf/events');
  source.addEventListener('box', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as {
      number: number;
      state: PublicBoxState;
    };
    shelfModel.states.set(payload.number, payload.state);
    announce();
  });
  source.addEventListener('sales', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as {
      salesPaused: boolean;
      salesOpen: boolean;
    };
    shelfModel.salesPaused = payload.salesPaused;
    shelfModel.salesOpen = payload.salesOpen;
    announce();
  });
}

export function notifyShelf(): void {
  announce();
}
