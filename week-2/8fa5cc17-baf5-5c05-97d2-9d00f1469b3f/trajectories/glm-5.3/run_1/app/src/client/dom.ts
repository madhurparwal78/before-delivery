// DOM helpers and home-clock time formats for the client.

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface El {
  el: HTMLElement;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, ...children: unknown[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function apply(el: HTMLElement, attrs?: Record<string, unknown>): void {
  if (attrs === undefined) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) {
        el.dataset[dk] = String(dv);
      }
    } else if (k === "value") {
      (el as HTMLInputElement).value = String(v);
    } else if (k === "checked") {
      (el as HTMLInputElement).checked = Boolean(v);
    } else if (k === "style") {
      for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
        (el.style as unknown as Record<string, string>)[sk] = sv;
      }
    } else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, String(v));
  }
}

export function clearChildren(el: HTMLElement): void {
  while (el.firstChild !== null) el.removeChild(el.firstChild);
}

/** `<Weekday> <D> <Month> <YYYY>` for a home-clock date. */
export function dateHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** `<D> <Mon> <YYYY>, <HH:MM>` for a UTC instant on the home clock. */
export function dateTimeShort(at: Date, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  return `${get("day")} ${get("month")} ${get("year")}, ${String(hour).padStart(2, "0")}:${get("minute")}`;
}

export function monthShort(m: number): string {
  return MONTHS_SHORT[m - 1];
}

export function plural(n: number, singularWord: string, pluralWord: string): string {
  return n === 1 ? singularWord : pluralWord;
}

export function announce(message: string): void {
  const region = document.querySelector('[role="status"][aria-live="polite"]');
  if (region === null) return;
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

export function alertMessage(message: string): void {
  const region = document.getElementById("app-alert");
  if (region === null) return;
  region.textContent = message;
}

export function clearAlert(): void {
  const region = document.getElementById("app-alert");
  if (region !== null) region.textContent = "";
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function focusTrap(container: HTMLElement, opener: HTMLElement | null): { dispose: () => void } {
  const focusables = (): HTMLElement[] => {
    const list = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
    );
    return list;
  };
  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", onKeydown);
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      container.dispatchEvent(new CustomEvent("dialog-close", { bubbles: false }));
    }
  };
  container.addEventListener("keydown", onEscape);
  return {
    dispose: () => {
      container.removeEventListener("keydown", onKeydown);
      container.removeEventListener("keydown", onEscape);
      if (opener !== null && document.contains(opener)) opener.focus();
    },
  };
}

export function openDialog(el: HTMLElement, opener: HTMLElement | null): { close: () => void } {
  const trap = focusTrap(el, opener);
  const closeFn = (): void => {
    el.remove();
    trap.dispose();
  };
  el.addEventListener("dialog-close", () => closeFn());
  return { close: closeFn };
}
