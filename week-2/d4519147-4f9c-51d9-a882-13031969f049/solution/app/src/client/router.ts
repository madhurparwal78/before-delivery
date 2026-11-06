import { useSyncExternalStore } from "react";
import { Emitter } from "./emitter.ts";

const changes = new Emitter();

interface LeaveGuard {
  /** True while leaving must first settle a save. */
  pending(): boolean;
  /** Settles the save; resolves true when the address may change. */
  settle(): Promise<boolean>;
  /** The address the guard protects. */
  path: string;
}

let guard: LeaveGuard | null = null;

export function setLeaveGuard(next: LeaveGuard | null): void {
  guard = next;
}

/** Navigation state passed with an in-app move (focus hints for the landing screen). */
export let landingHint: "focus-canvas" | "focus-tab" | null = null;

export async function navigate(to: string, options: { replace?: boolean; force?: boolean; hint?: typeof landingHint } = {}): Promise<boolean> {
  if (!options.force && guard && guard.path !== to && guard.pending() && !(await guard.settle())) return false;
  landingHint = options.hint ?? null;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  changes.emit();
  return true;
}

window.addEventListener("popstate", () => {
  const active = guard;
  if (active && active.pending()) {
    // Keep the editor's address until its pending save succeeds, then go back again.
    history.pushState(null, "", active.path);
    void active.settle().then((ok) => {
      if (ok) history.back();
    });
    return;
  }
  landingHint = null;
  changes.emit();
});

export function useLocation(): { path: string; search: URLSearchParams } {
  useSyncExternalStore(changes.subscribe, changes.snapshot);
  return { path: location.pathname, search: new URLSearchParams(location.search) };
}
