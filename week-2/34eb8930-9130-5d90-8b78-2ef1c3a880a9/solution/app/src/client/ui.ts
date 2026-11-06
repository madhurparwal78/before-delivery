import { h } from "./dom.js";

/** The page-wide polite status region "Announcements"; each event is announced once. */
let region: HTMLElement | null = null;

export function mountAnnouncements(): void {
  region = h("div", { role: "status", "aria-label": "Announcements", "aria-live": "polite", class: "visually-hidden" });
  document.body.append(region);
}

export function announce(message: string): void {
  if (!region) return;
  region.textContent = "";
  region.textContent = message;
}

/** Calls `fire` once, `ms` after the last `poke` (search and find counts). */
export function debounce(ms: number, fire: () => void): { poke: () => void; cancel: () => void } {
  let timer = 0;
  return {
    poke: () => { window.clearTimeout(timer); timer = window.setTimeout(fire, ms); },
    cancel: () => window.clearTimeout(timer),
  };
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
}

/**
 * Dialogs in general (Interactions): Tab and Shift+Tab stay inside, Escape closes, focus returns to
 * the opener. Built on the native <dialog> with showModal; returns the function that closes it.
 */
export function openDialog(el: HTMLDialogElement, opts: { opener?: HTMLElement | null; focus?: HTMLElement | null; onClose?: () => void; restore?: () => void }): () => void {
  if (!el.isConnected) document.body.append(el);
  const opener = opts.opener ?? (document.activeElement as HTMLElement | null);
  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("cancel", onCancel);
    const active = document.activeElement;
    const focusElsewhere = Boolean(active && active !== document.body && !el.contains(active));
    if (el.open) el.close();
    opts.onClose?.();
    if (focusElsewhere) return;
    if (opts.restore) opts.restore();
    else opener?.focus({ preventScroll: true });
  };
  const onCancel = (e: Event): void => { e.preventDefault(); close(); };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const list = focusables(el);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener("keydown", onKey);
  el.addEventListener("cancel", onCancel);
  el.showModal();
  (opts.focus ?? focusables(el)[0])?.focus();
  return close;
}

/** Field messages under fields; focus moves to the first field in error (Feedback states). */
export function showFieldErrors(form: HTMLElement, fields: Record<string, string>, map: Record<string, HTMLElement>): void {
  form.querySelectorAll(".field-error").forEach((e) => e.remove());
  for (const input of Object.values(map)) input.removeAttribute("aria-invalid");
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = map[name];
    if (!input) continue;
    const id = `${input.id}-error`;
    const msg = h("p", { class: "field-error", id }, message);
    (input.closest(".field") ?? input.parentElement)?.append(msg);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", id);
    first ??= input;
  }
  first?.focus();
}

export function field(label: string, input: HTMLElement, extra?: HTMLElement): HTMLElement {
  return h("div", { class: "field" }, h("label", { for: input.id }, label), input, extra ?? null);
}
