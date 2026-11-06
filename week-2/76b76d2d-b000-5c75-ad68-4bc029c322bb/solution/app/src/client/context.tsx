import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Account, ServiceStatus } from "../shared/api.ts";
import type { Locale } from "../shared/domain.ts";
import type { Strings } from "./i18n.ts";

export type AppContext = {
  locale: Locale;
  t: Strings;
  /** undefined while loading, null when signed out. */
  me: Account | null | undefined;
  refreshMe: () => void;
  status: ServiceStatus | null;
  /** Server time minus browser time, learned from the latest status poll, in milliseconds. */
  serverOffset: number;
  /** Moves to another app page in place (history push), so no document reload interrupts the patron. */
  navigate: (path: string) => void;
};

export const App = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const value = useContext(App);
  if (!value) throw new Error("App context missing");
  return value;
}

export function billingDown(ctx: AppContext): boolean {
  return ctx.status?.billing === "down";
}

export function mailDown(ctx: AppContext): boolean {
  return ctx.status?.mail === "down";
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Interface motion (brief: Motion and effects): fade and rise a few pixels in 280 ms, instant under reduced motion. */
export const RISE_MS = 280;
const RISE_FRAMES: Keyframe[] = [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }];
const RISE_EASING = "cubic-bezier(0.45, 0, 0.55, 1)";

export function riseIn(element: Element | null): void {
  if (!element || reducedMotion()) return;
  element.animate(RISE_FRAMES, { duration: RISE_MS, easing: RISE_EASING });
}

/** The reverse of `riseIn` for a leaving element; it holds the faded state until the caller cancels it. */
export function riseOut(element: Element): Animation {
  return element.animate(RISE_FRAMES, { duration: RISE_MS, easing: RISE_EASING, direction: "reverse", fill: "forwards" });
}

/**
 * Leave motion for dialogs and menus: focus must return to the opener at once, so the real control
 * closes immediately and an inert, aria-hidden copy at the same place plays `riseOut`, then is removed.
 */
export function leaveGhost(element: Element | null): void {
  if (!element || reducedMotion()) return;
  const rect = element.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = `${element.className} leave-ghost`;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.innerHTML = element.innerHTML;
  for (const node of ghost.querySelectorAll("[id]")) node.removeAttribute("id");
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(ghost);
  riseOut(ghost).finished.then(() => ghost.remove(), () => ghost.remove());
}

export function focusHeading(): void {
  document.querySelector<HTMLElement>("main h1")?.focus();
}
