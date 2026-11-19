import { formatPounds } from "../shared/money.js";
import { h, reducedMotion } from "./dom.js";

// What every page shares: the page signature, navigation, covers, the countdown and form field helpers.

/** Renders into `main`; `onLeave` registers cleanup (timers) for when the route changes. */
export type Page = (main: HTMLElement, param: string, onLeave: (done: () => void) => void) => void;

let go: (path: string, replace?: boolean) => void = () => undefined;

export function setNavigator(navigate: (path: string, replace?: boolean) => void): void {
  go = navigate;
}

export function navigate(path: string, replace = false): void {
  go(path, replace);
}

export function title(text: string): void {
  document.title = `${text} · Dotgain`;
}

export const money = formatPounds;

/** A cover in its circular mask, revealed through an iris once loaded. */
export function cover(src: string | null, alt: string, size: "small" | "lead" | "full"): HTMLElement {
  if (!src) return h("span", { class: `cover cover-${size} cover-empty`, "aria-hidden": "true" });
  const img = h("img", { class: `cover cover-${size}${reducedMotion() ? " open" : " iris"}`, src, alt, decoding: "async" });
  const open = () => img.classList.add("open");
  if (img.complete) open();
  else img.addEventListener("load", open, { once: true });
  return img;
}

/** `<D> days <HH>:<MM>:<SS>` from one day, else `<HH>:<MM>:<SS>` (brief: Server time decides). */
function countdownText(seconds: number): string {
  const left = Math.max(0, seconds);
  const days = Math.floor(left / 86_400);
  const two = (n: number) => String(n).padStart(2, "0");
  const clock = `${two(Math.floor((left % 86_400) / 3600))}:${two(Math.floor((left % 3600) / 60))}:${two(left % 60)}`;
  return days >= 1 ? `${days} ${days === 1 ? "day" : "days"} ${clock}` : clock;
}

/**
 * A countdown that starts from the server's seconds-left and ticks by elapsed time since that answer,
 * never from the device's date. Calls `atZero` once when it reaches zero.
 */
export function countdown(el: HTMLElement, onLeave: (done: () => void) => void, atZero: () => void) {
  let base = 0;
  let since = performance.now();
  let fired = false;
  const tick = () => {
    const left = base - Math.floor((performance.now() - since) / 1000);
    el.textContent = countdownText(left);
    if (left <= 0 && base > 0 && !fired) {
      fired = true;
      atZero();
    }
  };
  const timer = setInterval(tick, 250);
  onLeave(() => clearInterval(timer));
  return (seconds: number) => {
    base = seconds;
    since = performance.now();
    fired = false;
    tick();
  };
}

/** A labelled control with its error line underneath. */
export function field(id: string, label: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, hint?: string) {
  input.id = id;
  const error = h("p", { class: "field-error", id: `${id}-error` });
  const hintEl = hint ? h("p", { class: "hint", id: `${id}-hint` }, hint) : null;
  input.setAttribute("aria-describedby", [hintEl ? `${id}-hint` : "", `${id}-error`].filter(Boolean).join(" "));
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), hintEl, input, error);
  return {
    wrap, input, error,
    set: (message: string | null) => {
      error.textContent = message ?? "";
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    },
  };
}

export type Field = ReturnType<typeof field>;

export function moneyInput(value = ""): HTMLInputElement {
  return h("input", { type: "text", inputmode: "decimal", autocomplete: "off", value });
}
