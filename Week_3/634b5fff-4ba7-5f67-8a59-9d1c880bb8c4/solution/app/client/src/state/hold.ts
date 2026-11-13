import { ERRORS, STORY_COPY } from "../../../shared/copy.js";
import { ApiFailure, get, post, request } from "../api.js";
import { Store } from "./store.js";
import { story } from "./story.js";

/**
 * The reader's one hold. The token, number and length live in sessionStorage; the time left is only ever the
 * server's answer, asked for once per second. The device clock is never read.
 */

type FocusRequest = { id: number; target: "checkout" } | { id: number; target: "cell"; number: number };

interface HoldState {
  number: number | null;
  token: string | null;
  holdMs: number;
  remainingMs: number;
  /** The server has confirmed the hold and its time left. */
  live: boolean;
  message: string;
  failed: boolean;
  focus: FocusRequest | null;
}

interface HoldBody {
  number: number;
  holdMs: number;
  remainingMs: number;
  holdToken?: string;
}

const KEY = "press.hold";
const POLL_MS = 1000;

const EMPTY: HoldState = { number: null, token: null, holdMs: 0, remainingMs: 0, live: false, message: "", failed: false, focus: null };

export const holds = new Store<HoldState>(EMPTY);

let timer: number | undefined;
let asking = false;
let reaching = false;
let focusCount = 0;

const messageOf = (failure: unknown): string =>
  failure instanceof ApiFailure && failure.message ? failure.message : ERRORS.internal_error.message();

const remember = (state: HoldState): void => {
  if (state.number === null || state.token === null) sessionStorage.removeItem(KEY);
  else sessionStorage.setItem(KEY, JSON.stringify({ number: state.number, token: state.token, holdMs: state.holdMs }));
};

const stopAsking = (): void => {
  window.clearInterval(timer);
  timer = undefined;
};

const clear = (message: string, failed: boolean, focus: FocusRequest | null = null): void => {
  stopAsking();
  story().setHold(null);
  const next: HoldState = { ...EMPTY, message, failed, focus };
  remember(next);
  holds.set(next);
};

const ask = async (): Promise<void> => {
  const current = holds.get();
  if (current.number === null || current.token === null || asking) return;
  asking = true;
  try {
    const { body } = await get<HoldBody>(`/api/holds/${current.number}`, { "X-Hold-Token": current.token });
    if (holds.get().token !== current.token) return;
    holds.update((state) => ({ ...state, live: true, holdMs: body.holdMs, remainingMs: body.remainingMs }));
    story().setHold({ number: current.number, remainingMs: body.remainingMs, holdMs: body.holdMs });
  } catch (failure) {
    if (holds.get().token !== current.token) return;
    if (failure instanceof ApiFailure && (failure.status === 410 || failure.status === 403)) clear(messageOf(failure), true);
  } finally {
    asking = false;
  }
};

/** The bar claims a hold only after the server has answered for it twice: its length, then its time left. */
const confirmWithServer = async (token: string | null): Promise<void> => {
  await ask();
  if (holds.get().token === token) await ask();
};

const startAsking = (): void => {
  stopAsking();
  timer = window.setInterval(() => void ask(), POLL_MS);
};

const nextFocus = (target: "checkout" | { cell: number }): FocusRequest => {
  focusCount += 1;
  return target === "checkout" ? { id: focusCount, target } : { id: focusCount, target: "cell", number: target.cell };
};

/** Picks the hold up again after a reload, and asks the server how long it has left. */
export const restoreHold = (): void => {
  if (holds.get().number !== null) return;
  const text = sessionStorage.getItem(KEY);
  if (!text) return;
  const stored: unknown = JSON.parse(text);
  if (!stored || typeof stored !== "object") return;
  const { number, token, holdMs } = Object.fromEntries(Object.entries(stored));
  if (typeof number !== "number" || typeof token !== "string" || typeof holdMs !== "number") return;
  holds.set({ ...EMPTY, number, token, holdMs, remainingMs: holdMs });
  startAsking();
  void ask();
};

/** Reaches for a box. A hold on another number is put back first. */
export const chooseBox = async (number: number): Promise<void> => {
  if (reaching) return;
  reaching = true;
  try {
    const before = holds.get();
    if (before.number !== null && before.token !== null && before.number !== number) {
      await request("DELETE", `/api/holds/${before.number}`, { headers: { "X-Hold-Token": before.token } }).catch(() => undefined);
      clear(STORY_COPY.holdPending(number), false);
    } else {
      holds.update((state) => ({ ...state, message: STORY_COPY.holdPending(number), failed: false }));
    }
    const token = holds.get().token;
    try {
      const { body } = await post<HoldBody>("/api/holds", { number }, token === null ? undefined : { "X-Hold-Token": token });
      const next: HoldState = {
        number, token: body.holdToken ?? token, holdMs: body.holdMs, remainingMs: body.remainingMs, live: true,
        message: STORY_COPY.holdPending(number), failed: false, focus: null,
      };
      remember(next);
      holds.set(next);
      story().setHold({ number, remainingMs: body.remainingMs, holdMs: body.holdMs });
      await confirmWithServer(next.token);
      if (holds.get().token === next.token && holds.get().live) {
        holds.update((state) => ({ ...state, message: STORY_COPY.holdGranted(number), focus: nextFocus("checkout") }));
        startAsking();
      }
    } catch (failure) {
      holds.update((state) => ({ ...state, message: messageOf(failure), failed: true }));
    }
  } finally {
    reaching = false;
  }
};

/** Puts the box back on the shelf. */
export const releaseHold = async (): Promise<void> => {
  const { number, token } = holds.get();
  if (number === null || token === null) return;
  try {
    await request("DELETE", `/api/holds/${number}`, { headers: { "X-Hold-Token": token } });
    clear(STORY_COPY.holdReleased(number), false, nextFocus({ cell: number }));
  } catch (failure) {
    clear(messageOf(failure), true, nextFocus({ cell: number }));
  }
};

/** A focus request has been acted on; a later visit to the page must not repeat it. */
export const consumeFocus = (): void => holds.update((state) => (state.focus ? { ...state, focus: null } : state));

/** The hold became an order: it is no longer this browser's to count. */
export const finishHold = (): void => clear("", false);
