export type Attrs = Record<string, unknown>;

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, children?: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      if (key === "class") {
        node.className = String(value);
      } else if (key === "text") {
        node.textContent = String(value);
      } else if (key === "html") {
        node.innerHTML = String(value);
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2), value as EventListener);
      } else if (value === true) {
        node.setAttribute(key, "");
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  if (children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) {
        continue;
      }
      node.append(child);
    }
  }
  return node;
}

/** The seven line icons, from the Lucide set. */
const ICON_PATHS: Record<string, string> = {
  paintbrush:
    '<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  cross: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "warning-file":
    '<path d="M12.5 18.5h-7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l5 5v7.5"/><path d="M15 18.5v-7h3l3 3v4a1 1 0 0 1-1 1h-2.5"/><path d="M13.5 8.5h-2v-2"/><path d="m9.5 14.5 1 1.5 2-3"/>',
  "warning-file-real":
    '<path d="M13 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l5 5v3"/><path d="M15 18.5v-7h3l3 3v4a1 1 0 0 1-1 1h-2.5"/><path d="M13.5 8.5h-2v-2"/><path d="m9.5 14.5 1 1.5 2-3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};

export function icon(name: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const wrapped = ICON_PATHS[name] ?? ICON_PATHS.alert ?? "";
  const container = document.createElementNS("http://www.w3.org/2000/svg", "g");
  container.innerHTML = wrapped;
  for (const child of [...container.childNodes]) {
    svg.append(child);
  }
  return svg;
}

export function fmtMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${frac}`;
}

export function fmtHours(quarters: number): string {
  return `${Math.floor(quarters / 4)}.${String((quarters % 4) * 25).padStart(2, "0")}`;
}

/** The kitchen wall-clock time of an instant. */
export function wallTime(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour12: false, hour: "2-digit", minute: "2-digit" }).format(instant);
  return parts === "24:00" ? "00:00" : parts;
}

export interface DialogSpec {
  label: string;
  body: HTMLElement;
  onEscape?: () => void;
  onOpen?: (dialog: HTMLElement) => void;
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  return [...nodes].filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
}

/** A dialog that traps focus, closes on Escape and returns focus to its opener. */
export function openDialog(spec: DialogSpec, onClose: (result: unknown) => void): { close: (result: unknown) => void; dialog: HTMLElement } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overlay = el("div", { class: "overlay" });
  const dialog = el("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": spec.label,
    class: "dialog fade-in",
  });
  dialog.append(spec.body);
  overlay.append(dialog);
  document.body.append(overlay);
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) {
      finish(null);
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
    } else if (event.key === "Tab") {
      const focusables = focusableIn(dialog);
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  const escapeHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      document.removeEventListener("keydown", escapeHandler, true);
      finish(null);
    }
  };
  document.addEventListener("keydown", escapeHandler, true);

  let closed = false;
  function finish(result: unknown): void {
    if (closed) {
      return;
    }
    closed = true;
    document.removeEventListener("keydown", escapeHandler, true);
    overlay.remove();
    if (opener && document.contains(opener)) {
      opener.focus();
    }
    onClose(result);
  }
  const first = focusableIn(dialog);
  (first[0] ?? dialog).focus();
  if (spec.onOpen) {
    spec.onOpen(dialog);
  }
  return {
    dialog,
    close: finish,
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Counts from one money value to another in about a third of a second. */
export function countTo(from: number, to: number, render: (cents: number) => void): () => void {
  if (prefersReducedMotion() || from === to) {
    render(to);
    return () => undefined;
  }
  const duration = 330;
  const startedAt = performance.now();
  let raf = 0;
  const tick = (now: number): void => {
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    render(Math.round(from + (to - from) * eased));
    if (t < 1) {
      raf = requestAnimationFrame(tick);
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function statusRegion(label: string, extra?: Attrs): HTMLElement {
  return el("div", { role: "status", "aria-label": label, class: "status-line", ...(extra ?? {}) });
}

export function isoToLocalDateInput(date: string): string {
  return date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
