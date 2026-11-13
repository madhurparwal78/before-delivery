import { h } from "./dom.js";

let region: HTMLElement | null = null;

export function statusRegion(): HTMLElement {
  region = h("div", { class: "visually-hidden", role: "status", "aria-live": "polite", "aria-label": "Story updates" });
  return region;
}

/** Each announcement replaces the previous text. */
export function announce(text: string): void {
  if (region) region.textContent = text;
}
