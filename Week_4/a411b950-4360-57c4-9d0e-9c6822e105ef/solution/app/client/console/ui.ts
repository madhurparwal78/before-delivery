// Small DOM helpers shared by the console views.

import { byId } from "../lib/api.js";
import { icon } from "../lib/icons.js";

const status = (): HTMLElement => byId("console-status");

export function say(text: string): void {
  status().textContent = text;
}

export const STORAGE_DOWN = "Storage is unreachable. Uploads and publishing are paused until it returns.";
export const BILLING_DOWN = "Billing is unreachable. Nothing was invoiced.";
export const STALE = "This enquiry changed in another window. The latest version is shown; save again to apply your edit.";

/** The console's time zone, kept current after Settings saves. */
export const zone = { value: "UTC" };

/** Live views re-read this often, so a change made anywhere shows within three seconds. */
const LIVE_MS = 2_000;

/**
 * Runs `work` now and every LIVE_MS until the returned stop is called. A tick that comes while the previous run is
 * still pending is skipped, so runs never overlap.
 */
export function poll(work: () => Promise<void>): () => void {
  let busy = false;
  const run = (): void => {
    if (busy) return;
    busy = true;
    void work().finally(() => {
      busy = false;
    });
  };
  run();
  const timer = window.setInterval(run, LIVE_MS);
  return () => window.clearInterval(timer);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attrs?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [key, value] of Object.entries(options.attrs ?? {})) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

export function button(label: string, onClick: (event: MouseEvent) => void, primary = false): HTMLButtonElement {
  const node = el("button", { className: primary ? "button primary" : "button", text: label, attrs: { type: "button" } });
  node.addEventListener("click", onClick);
  return node;
}

export interface Field {
  wrapper: HTMLDivElement;
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  error: HTMLParagraphElement;
}

let fieldCount = 0;

/** A labelled control with an error line under it. */
export function field(
  label: string,
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  className = "",
): Field {
  fieldCount += 1;
  const id = `field-${fieldCount}`;
  control.id = id;
  const error = el("p", { className: "field-error", attrs: { id: `${id}-error` } });
  control.setAttribute("aria-describedby", error.id);
  const wrapper = el("div", { className: `field ${className}`.trim() }, el("label", { text: label, attrs: { for: id } }), control, error);
  return { wrapper, input: control, error };
}

export function input(type: string, value = ""): HTMLInputElement {
  const node = el("input", { attrs: { type } });
  node.value = value;
  return node;
}

export function textarea(value = "", rows = 4): HTMLTextAreaElement {
  const node = el("textarea", { attrs: { rows: String(rows) } });
  node.value = value;
  return node;
}

export function select(options: [string, string][], value: string): HTMLSelectElement {
  const node = el("select");
  for (const [optionValue, label] of options) node.append(new Option(label, optionValue));
  node.value = value;
  return node;
}

/** Shows each 422 message under its field; returns the first invalid control. */
export function showErrors(fields: Record<string, Field>, errors: Record<string, string>): HTMLElement | null {
  let first: HTMLElement | null = null;
  for (const [key, entry] of Object.entries(fields)) {
    const message = errors[key];
    entry.error.textContent = message ?? "";
    if (message) {
      entry.input.setAttribute("aria-invalid", "true");
      first ??= entry.input;
    } else {
      entry.input.removeAttribute("aria-invalid");
    }
  }
  return first;
}

export function emptyState(text: string): HTMLElement {
  return el("li", { className: "empty" }, icon("inbox"), el("span", { text }));
}

export function skeletonRows(): HTMLElement[] {
  return [0, 1, 2].map(() => el("li", { className: "skeleton", attrs: { "aria-hidden": "true" } }));
}

/** The 375 layout shows one pane at a time. */
export function backToList(view: HTMLElement, focusTarget: () => HTMLElement | null): HTMLButtonElement {
  const back = button("Back to list", () => {
    view.classList.remove("show-detail");
    focusTarget()?.focus();
  });
  back.classList.add("back-to-list");
  back.prepend(icon("arrow-left"));
  return back;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
