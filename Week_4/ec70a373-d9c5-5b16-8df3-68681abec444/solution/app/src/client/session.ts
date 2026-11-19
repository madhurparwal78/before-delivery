// The handling of a 401 on a signed-in screen: the sign-in form at the same address, or Sign in again over a dialog.
import { useSyncExternalStore } from "react";

type SessionView = "signed_out" | "signed_in" | "ended" | "interrupted";

let view: SessionView = "signed_out";
let dialogsOpen = 0;
let waiting: { promise: Promise<void>; resolve: () => void } | null = null;
const listeners = new Set<() => void>();

function publish(next: SessionView): void {
  view = next;
  for (const listener of listeners) listener();
}

export function useSessionView(): SessionView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
  );
}

export function sessionSignedIn(): void {
  publish("signed_in");
}

export function sessionSignedOut(): void {
  waiting = null;
  publish("signed_out");
}

export function sessionEndedNow(): void {
  waiting = null;
  publish("ended");
}

/** A Cancel booking, Check out or Buy dialog registers while it is open: a 401 then interrupts it instead. */
export function interruptibleDialogOpened(): () => void {
  dialogsOpen += 1;
  return () => {
    dialogsOpen -= 1;
  };
}

/** Every periodic reload on a screen pauses while its Sign in again dialog is open. */
export function reloadsPaused(): boolean {
  return view === "interrupted";
}

/** Decides what a 401 does. Returns the wait for Sign in again when this request is to be resent after it. */
export function sessionAnswered401(resumable: boolean): Promise<void> | null {
  if (view !== "signed_in" && view !== "interrupted") return null;
  if (dialogsOpen === 0 && view === "signed_in") {
    publish("ended");
    return null;
  }
  if (view !== "interrupted") publish("interrupted");
  if (!resumable) return null;
  if (!waiting) {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    waiting = { promise, resolve };
  }
  return waiting.promise;
}

/** Sign in and continue succeeded: the reloads resume and the waiting action is resent. */
export function sessionResumed(): void {
  const resumed = waiting;
  waiting = null;
  publish("signed_in");
  resumed?.resolve();
}
