import { subscribeable } from "./subscribeable.ts";

type Location = { path: string; query: URLSearchParams };

const current = (): Location => ({ path: window.location.pathname, query: new URLSearchParams(window.location.search) });

export const location = subscribeable(current());

/** A focus target for the screen being opened, read once by that screen. */
type ArrivalFocus = "title" | "table-name";

let arrivalFocus: ArrivalFocus | null = null;

export function navigate(to: string, focus: ArrivalFocus | null = null): void {
  arrivalFocus = focus;
  window.history.pushState(null, "", to);
  location.set(current());
}

export function takeArrivalFocus(): ArrivalFocus | null {
  const focus = arrivalFocus;
  arrivalFocus = null;
  return focus;
}

export function replaceAddress(to: string): void {
  window.history.replaceState(null, "", to);
  location.set(current());
}

window.addEventListener("popstate", () => location.set(current()));
