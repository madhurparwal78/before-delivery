// Shared screen helpers: the app shell, common labels and small builders.

import { h, clear, dollars as dollarsFmt, screenDate as screenDateFmt, monthName as monthNameFmt, shortDateTime as shortDateTimeFmt, liveRegion, announce, reducedMotion, animate, debounce, showModal, closeModal, dialogKeyHandler } from "./ui";
import { shell as buildShell, me, setRefresh } from "./main";

export { h, clear, dollarsFmt as dollars, screenDateFmt as screenDate, monthNameFmt as monthName, shortDateTimeFmt as shortDateTime, liveRegion, announce, reducedMotion, animate, debounce, showModal, closeModal, dialogKeyHandler };

// Every signed-in screen: the top bar plus the screen's own grid content.
export function screen(...children: (HTMLElement | null)[]): HTMLElement {
  const built = buildShell(...children);
  return built.root;
}

export function timeZone(): string {
  return me()?.timeZone ?? "UTC";
}

export function heading(level: number, text: string): HTMLElement {
  return h(`h${level}`, { class: level === 1 ? "heading" : "subheading", text });
}

export function caption(text: string): HTMLElement {
  return h("div", { class: "caption", text });
}

export function fig(text: string): HTMLElement {
  return h("span", { class: "fig", text });
}

export function table(headers: string[], label?: string): { table: HTMLElement; thead: HTMLElement; tbody: HTMLElement } {
  const thead = h("thead", null, h("tr", null, ...headers.map((header) => h("th", { class: "cell", text: header }))));
  const tbody = h("tbody");
  const tableEl = h("table", { class: "table", ...(label ? { "aria-label": label } : {}) }, thead, tbody);
  return { table: tableEl, thead, tbody };
}

export function statusLabel(text: string): HTMLElement {
  return h("span", { class: "status-tag", text });
}

export function registerRefresh(fn: () => void): void {
  setRefresh(fn);
}
