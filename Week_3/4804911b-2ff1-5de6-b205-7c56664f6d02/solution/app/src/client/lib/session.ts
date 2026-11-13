import { useLayoutEffect, useState } from "preact/hooks";
import type { Session } from "../../shared/types";
import { ApiFailure, get } from "./net";
import { navigate } from "./router";

type Auth = { status: "loading" } | { status: "out" } | { status: "in"; session: Session };

let auth: Auth = { status: "loading" };
const listeners = new Set<() => void>();
const publish = (next: Auth) => {
  auth = next;
  listeners.forEach((l) => l());
};

export const homeFor = (s: Session): string => (s.role === "editor" ? "/editor" : "/stockist");

export function useAuth(): Auth {
  const [, tick] = useState(0);
  useLayoutEffect(() => {
    const on = () => tick((n) => n + 1);
    listeners.add(on);
    if (auth.status === "loading") void refreshSession();
    return () => void listeners.delete(on);
  }, []);
  return auth;
}

export async function refreshSession(): Promise<Session | null> {
  try {
    const s = await get<Session>("/api/session", { quiet: true });
    publish({ status: "in", session: s });
    return s;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) publish({ status: "out" });
    return null;
  }
}

export const setSession = (s: Session | null): void => publish(s ? { status: "in", session: s } : { status: "out" });

// ---- the ended session and the work typed before it ---------------------------------------------------------------

export interface HeldDraft {
  title?: string;
  effectiveDate?: string;
  runOutUntil?: string;
  rows: Record<string, string>;
  revision: number;
}
export interface HeldCorrection {
  number: string;
  effectiveDate: string;
  runOutUntil: string;
  reason: string;
  rows: Record<string, string>;
  baseVersion: number;
}
export interface Held {
  accountId: string;
  drafts: Record<string, HeldDraft>;
  correction: HeldCorrection | null;
  endpoint: string | null;
}

let ended = false;
let held: Held | null = null;
export const endedSession = (): boolean => ended;
export const clearEnded = (): void => void (ended = false);

/** A request answered 401: remember what was typed (if anything differs) and go to sign-in. */
export function endSession(capture: (() => Held | null) | null): void {
  held = capture?.() ?? null;
  ended = true;
  publish({ status: "out" });
  navigate("/sign-in", { replace: true });
}

export function discardHeld(): void {
  held = null;
}

/** A different account signing in drops the old account's held values for good. */
export function reconcileHeld(accountId: string): void {
  if (held && held.accountId !== accountId) held = null;
}

/** On the screen of the same account, the held values come back once. */
export function takeHeld(accountId: string): Held | null {
  const mine = held && held.accountId === accountId ? held : null;
  held = null;
  return mine;
}
