import { useSyncExternalStore } from "react";

/**
 * The one rule for an ended session: a user action answered `unauthenticated` waits here until the person signs in
 * again, and is then resent once. `null` means no Sign in to continue dialog is open.
 */
interface Waiting {
  settle: (resumed: boolean) => void;
  done: Promise<boolean>;
}

let waiting: Waiting | null = null;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((listener) => listener());

/** Opens Sign in to continue (once, however many actions are waiting) and answers whether the person signed in again. */
export function awaitSignIn(): Promise<boolean> {
  if (waiting === null) {
    let settle: (resumed: boolean) => void = () => undefined;
    const done = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    waiting = { settle, done };
    notify();
  }
  return waiting.done;
}

/** True when the person signed in again (the waiting actions are resent) or false when they signed out (they are dropped). */
export function finishSignIn(resumed: boolean): void {
  const current = waiting;
  waiting = null;
  current?.settle(resumed);
  notify();
}

export function useSessionEnded(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => waiting !== null,
  );
}
