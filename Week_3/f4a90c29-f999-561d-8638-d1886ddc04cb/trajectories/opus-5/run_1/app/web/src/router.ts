// The address holds the view, date, chosen calendars and open event, so a
// reload, Back, Forward or a second tab all show the same screen.

import type { Address, View } from "./state";

const VIEWS: View[] = ["day", "week", "month", "custom", "schedule"];

export function readAddress(): Address {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const view = params.get("view");
  const date = params.get("date");
  const calendars = params.get("calendars");
  return {
    path: url.pathname,
    view: view && VIEWS.includes(view as View) ? (view as View) : null,
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    calendars: calendars === null ? null : calendars.split(",").filter((id) => id !== ""),
    event: params.get("event"),
    focus: params.get("focus"),
    q: params.get("q") ?? "",
    occurrence: params.get("occurrence"),
    token: url.pathname.startsWith("/share/") ? url.pathname.slice("/share/".length) : "",
  };
}

type Change = Partial<Record<"view" | "date" | "calendars" | "event" | "focus" | "q" | "occurrence", string | null>>;

/** go moves to a path, adding a history entry. */
export function go(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, "", path);
  else window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** setParams changes address values and adds a history entry. */
export function setParams(change: Change, replace = false): void {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(change)) {
    if (value === null || value === undefined) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  const next = `${url.pathname}${url.search}`;
  if (next === `${window.location.pathname}${window.location.search}`) return;
  go(next, replace);
}

export function onRoute(handler: () => void): void {
  window.addEventListener("popstate", handler);
}
