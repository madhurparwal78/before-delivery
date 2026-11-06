// Tiny DOM builder. No member-typed text is ever inserted as raw HTML; everything
// goes through createElement/textContent.

export type Child = Node | string | null | undefined | false | true;

export function h(tag: string, attrs?: Record<string, unknown> | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = String(value);
      else if (key === "text") el.textContent = String(value);
      else if (key.startsWith("on") && typeof value === "function") {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === "value") (el as HTMLInputElement).value = String(value);
      else if (key === "checked") (el as HTMLInputElement).checked = Boolean(value);
      else if (key === "selected") (el as HTMLOptionElement).selected = Boolean(value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (typeof child === "string") el.appendChild(document.createTextNode(child));
    else el.appendChild(child as Node);
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Motion helper: brisk start, soft settle, no overshoot; never longer than half a
// second. With reduced motion requested, values change straight to the final one.
export function animate(from: number, to: number, durationMs: number, step: (v: number) => void, done?: () => void): void {
  if (reducedMotion() || from === to) {
    step(to);
    done?.();
    return;
  }
  const duration = Math.min(durationMs, 500);
  const start = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    step(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
    else done?.();
  };
  requestAnimationFrame(tick);
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}$${whole}.${frac < 10 ? "0" : ""}${frac}`;
}

// "<weekday> <day> <month> <year>", in the studio's own calendar.
export function screenDate(date: string, timeZone: string): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(new Date(`${date}T12:00:00Z`));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}

export function monthName(month: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, month: "long", year: "numeric" }).formatToParts(new Date(`${month}-01T12:00:00Z`));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("year")}`;
}

export function shortDateTime(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

// Dialogs: fade and rise a few pixels, focus trapped inside, Escape closes, focus
// returns to the control that opened it.
type DialogHandle = { overlay: HTMLElement; dialog: HTMLElement; opener: HTMLElement | null; onEscape?: () => void };

let openHandle: DialogHandle | null = null;

function focusableIn(root: HTMLElement): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
  return Array.from(all);
}

export function showModal(dialog: HTMLElement, opener: HTMLElement | null, opts?: { onEscape?: () => void }): void {
  closeModal();
  const overlay = h("div", { class: "overlay" }, dialog);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.appendChild(overlay);
  openHandle = { overlay, dialog, opener, onEscape: opts?.onEscape };
  const focusables = focusableIn(dialog);
  (focusables[0] ?? dialog).focus();
  requestAnimationFrame(() => overlay.classList.add("shown"));
}

export function closeModal(): void {
  const current = openHandle;
  if (!current) return;
  openHandle = null;
  current.overlay.classList.remove("shown");
  const finish = () => current.overlay.remove();
  if (reducedMotion()) finish();
  else setTimeout(finish, 150);
  if (current.opener && document.contains(current.opener)) current.opener.focus();
}

// Wired up by the shell to the document keydown handler.
export function dialogKeyHandler(e: KeyboardEvent): void {
  if (!openHandle) return;
  if (e.key === "Escape") {
    e.preventDefault();
    const onEscape = openHandle.onEscape;
    closeModal();
    onEscape?.();
    return;
  }
  if (e.key === "Tab") {
    const focusables = focusableIn(openHandle.dialog);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// A polite live region by name.
export function liveRegion(name: string): HTMLElement {
  return h("div", { role: "status", "aria-label": name, class: "live-region", text: "" });
}

export function announce(el: HTMLElement | null, text: string): void {
  if (!el) return;
  el.textContent = text;
}
