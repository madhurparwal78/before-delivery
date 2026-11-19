/** The page's single polite status region: emptied, then written, so a repeated message is announced afresh. */
import { ending } from "./session.js";

const REGION_SELECTOR = "[data-status]";
const TOAST_VISIBLE_MS = 6_000;

let pending = 0;
let fadeTimer = 0;

function statusRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>(REGION_SELECTOR);
  if (!region) throw new Error("page has no status region");
  return region;
}

/** Writes one message after emptying the region. Each call announces exactly once. */
export function announce(message: string): void {
  if (ending.ended) return;
  const region = statusRegion();
  const turn = ++pending;
  region.textContent = "";
  region.classList.remove("is-faded");
  window.clearTimeout(fadeTimer);
  queueMicrotask(() => {
    if (turn !== pending) return;
    region.textContent = message;
    fadeTimer = window.setTimeout(() => region.classList.add("is-faded"), TOAST_VISIBLE_MS);
  });
}
