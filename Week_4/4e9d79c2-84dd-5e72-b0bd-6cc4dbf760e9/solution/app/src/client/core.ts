// What every screen shares: the one live region, busy buttons, the API call and the motion preference.
export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null => root.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];
export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const EASE = "cubic-bezier(0.05, 0.7, 0.1, 1)";

let flip = false;
/** Writes to the polite region; one message made twice is announced twice because the region's content changes. */
export const announce = (message: string, showLine = true): void => {
  flip = !flip;
  const said = document.getElementById("said");
  if (said) said.textContent = message + (flip ? "" : "​");
  if (showLine) for (const line of $$("[data-status]")) { line.textContent = message; line.hidden = false; }
};
export const announceRefreshFailure = (message: string): void => {
  const said = document.getElementById("refresh-said");
  if (said && said.textContent !== message) said.textContent = message;
};

/** An API reply: read field by field where it is used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReplyBody = any;
export interface Reply { ok: boolean; status: number; json: ReplyBody }
export const call = async (method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<Reply> => {
  const response = await fetch(path, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
    ...init,
  });
  const text = await response.text();
  let json: ReplyBody = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json };
};
const networkFailure: Reply = { ok: false, status: 0, json: { error: { code: "network", message: "Couldn't refresh. Trying again." } } };
export const safely = async (work: () => Promise<Reply>): Promise<Reply> => {
  try {
    return await work();
  } catch {
    return networkFailure;
  }
};

const labels = new WeakMap<HTMLElement, string>();
export const setBusy = (button: HTMLElement): void => {
  labels.set(button, button.innerHTML);
  button.textContent = "Working…";
  button.setAttribute("aria-disabled", "true");
  button.dataset.pending = "1";
};
export const clearBusy = (button: HTMLElement): void => {
  const label = labels.get(button);
  if (label !== undefined) button.innerHTML = label;
  button.removeAttribute("aria-disabled");
  delete button.dataset.pending;
};
export const isBusy = (button: HTMLElement): boolean => button.dataset.pending === "1";

/** Focus a control and make sure no fixed bar covers it. */
const FIXED_PARTS = ".phone-bar,.desk-top,.slim-bar.is-showing,.main-actions,.quote-actions,.message-us,.back-top,.waiting-count";
export const keepInView = (element: Element): void => {
  if (element.closest(".dialog") || element.closest(FIXED_PARTS)) return;
  const own = element.getBoundingClientRect();
  const label = (element as HTMLInputElement).labels?.[0];
  const rect = (own.width <= 2 || own.height <= 2) && label ? label.getBoundingClientRect() : own;
  let top = 0;
  let bottom = innerHeight;
  for (const bar of $$(FIXED_PARTS)) {
    const style = getComputedStyle(bar);
    if (style.display === "none" || style.visibility === "hidden" || bar.hidden || !["fixed", "sticky"].includes(style.position)) continue;
    const box = bar.getBoundingClientRect();
    if (box.bottom <= innerHeight / 2 && box.top <= 0 + 2) top = Math.max(top, box.bottom);
    else if (box.top >= innerHeight / 2 && box.left < rect.right && box.right > rect.left) bottom = Math.min(bottom, box.top);
  }
  if (rect.bottom > bottom) scrollBy({ top: rect.bottom - bottom + 8, behavior: "instant" });
  else if (rect.top < top) scrollBy({ top: rect.top - top - 8, behavior: "instant" });
};

export const focusHeading = (): void => {
  const heading = $<HTMLElement>("h1:not([hidden])");
  heading?.focus({ preventScroll: false });
};
export const liveScreen = (): boolean => document.documentElement.dataset.live === "1";
