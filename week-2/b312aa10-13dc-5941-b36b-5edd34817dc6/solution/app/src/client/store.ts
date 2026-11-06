// Small observable stores shared across screens: live-region copy, the hour bank figure and the
// signed-in context.

import { useEffect, useState } from "preact/hooks";
import type { KitchenInfo, SessionInfo } from "./types.js";
import { endSession } from "./api.js";

class Store<T> {
  private listeners = new Set<(value: T) => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(value: T): void {
    this.value = value;
    for (const l of this.listeners) l(value);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function useStore<T>(store: Store<T>): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => {
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store]);
  return value;
}

export const context = new Store<{ session: SessionInfo; kitchen: KitchenInfo } | null>(null);

/** Polite announcements: each one is a fresh node so a repeat is read again. */
export const announcement = new Store<{ text: string; n: number }>({ text: "", n: 0 });
export const alertText = new Store<{ text: string; n: number }>({ text: "", n: 0 });

export function announce(text: string): void {
  announcement.set({ text, n: announcement.get().n + 1 });
}

/**
 * True while the alert shows a refused claim's copy (block_taken in New booking, a 422 on Confirm,
 * hold_expired). Only the person's next press or a later refusal changes it; refreshes, banner polls
 * and earlier drops' results never do (Interactions › Claim outcomes).
 */
let claimShown = false;

export function showError(text: string): void {
  claimShown = false;
  alertText.set({ text, n: alertText.get().n + 1 });
}

/** A refused claim's copy: it replaces whatever the alert shows, including an earlier refusal. */
export function showClaimError(text: string): void {
  showError(text);
  claimShown = true;
}

/** An error from a refresh or poll: it never replaces a refused claim's alert. */
export function showRefreshError(text: string): void {
  if (!claimShown) showError(text);
}

export function clearError(): void {
  claimShown = false;
  if (alertText.get().text) alertText.set({ text: "", n: alertText.get().n + 1 });
}

/**
 * Ends everything the browser holds for the signed-in session (sign-out or a 401): requests still
 * on their way are abandoned and the shared stores start empty for whoever signs in next. Screen
 * state goes with the screens, which unmount when the context is cleared.
 */
export function endBrowserSession(): void {
  endSession();
  if (rollTimer) clearTimeout(rollTimer);
  rollTimer = null;
  rollTarget = null;
  bank.set({ month: null, quarters: null, rolls: 0 });
  announcement.set({ text: "", n: announcement.get().n + 1 });
  claimShown = false;
  alertText.set({ text: "", n: alertText.get().n + 1 });
  context.set(null);
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------- hour bank figure

const ROLL_MS = 180;
const MAX_ROLLS = 8;

/** The member's hour bank as shown in the header, in quarter hours; `month` is the month on screen. */
export const bank = new Store<{ month: string | null; quarters: number | null; rolls: number }>({ month: null, quarters: null, rolls: 0 });
let rollTimer: ReturnType<typeof setTimeout> | null = null;
let rollTarget: number | null = null;

export function setBank(month: string, quarters: number): void {
  if (rollTimer) clearTimeout(rollTimer);
  rollTimer = null;
  bank.set({ month, quarters, rolls: bank.get().rolls });
}

/**
 * Rolls the figure toward `target` one quarter hour per 180ms step; past eight quarters, the
 * first seven steps are quarters and the eighth lands on the target. Reduced motion: one step.
 */
export function rollBank(target: number): void {
  const current = bank.get();
  if (current.quarters === null || current.month === null || (rollTimer && rollTarget === target)) return;
  if (rollTimer) clearTimeout(rollTimer);
  rollTarget = target;
  if (reducedMotion()) {
    setBank(current.month, target);
    return;
  }
  let step = 0;
  const tick = (): void => {
    const now = bank.get();
    if (now.quarters === null || now.quarters === target) {
      rollTimer = null;
      return;
    }
    step += 1;
    const next = step >= MAX_ROLLS ? target : now.quarters + Math.sign(target - now.quarters);
    bank.set({ month: now.month, quarters: next, rolls: now.rolls + 1 });
    rollTimer = next === target ? null : setTimeout(tick, ROLL_MS);
  };
  rollTimer = setTimeout(tick, 0);
}
