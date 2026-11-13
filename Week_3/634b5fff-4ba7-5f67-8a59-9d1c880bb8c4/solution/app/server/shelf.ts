import { CLOSES_AT, EDITION, type PublicBoxState } from "../shared/domain.js";
import { businessNow } from "./clock.js";
import { pool } from "./db.js";
import { heldNumbers, isUp } from "./valkey.js";

/** The live public shelf: Postgres box states overlaid with Valkey holds, pushed to every open shelf. */

interface ShelfEvent {
  name: "box" | "sales";
  data: Record<string, unknown>;
}

type Listener = (event: ShelfEvent) => void;

const CLOSE_MS = Date.parse(CLOSES_AT);
const listeners = new Set<Listener>();
let states: PublicBoxState[] = Array.from({ length: EDITION }, () => "available");
let paused = !isUp();
let open = businessNow().getTime() < CLOSE_MS;
let ticking = false;

export const salesOpen = (): boolean => open;

export const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const emit = (event: ShelfEvent): void => {
  for (const listener of listeners) listener(event);
};

export const salesEvent = (): ShelfEvent => ({ name: "sales", data: { salesPaused: paused, salesOpen: open } });

/** The shelf as it is right now: Postgres box states overlaid with the holds Valkey still has. */
export const readShelf = async (): Promise<{ states: PublicBoxState[]; salesPaused: boolean }> => {
  const rows = await pool.query("SELECT number, state FROM boxes ORDER BY number");
  let held = new Set<number>();
  let unreachable = false;
  try {
    held = await heldNumbers(EDITION);
  } catch {
    unreachable = true;
  }
  const states = (rows.rows as { number: number; state: string }[]).map((row): PublicBoxState =>
    row.state !== "available" ? "taken" : held.has(row.number) ? "held" : "available");
  return { states, salesPaused: unreachable };
};

const tick = async (): Promise<void> => {
  if (ticking) return;
  ticking = true;
  try {
    const { states: next, salesPaused: nowPaused } = await readShelf();
    const nowOpen = businessNow().getTime() < CLOSE_MS;
    next.forEach((state, index) => {
      if (states[index] !== state) emit({ name: "box", data: { number: index + 1, state } });
    });
    states = next;
    if (nowPaused !== paused || nowOpen !== open) {
      paused = nowPaused;
      open = nowOpen;
      emit(salesEvent());
    }
  } catch {
    return;
  } finally {
    ticking = false;
  }
};

/** Pushes a change made by this process right away instead of at the next scan. */
export const nudge = (): void => {
  void tick();
};

export const startShelf = (): void => {
  void tick();
  setInterval(() => void tick(), 400).unref();
};
