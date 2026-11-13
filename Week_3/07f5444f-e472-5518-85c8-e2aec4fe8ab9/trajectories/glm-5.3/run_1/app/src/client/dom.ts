// DOM helpers: element building, focus trapping, live regions, latest-save wins.

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined | null> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function icon(name: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `icon lucide lucide-${name}`);
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

/** A polite status region with the given accessible name. */
export function statusRegion(name: string, className?: string): HTMLElement {
  return el("div", {
    class: className ?? "status-line",
    role: "status",
    "aria-label": name,
  });
}

export function setStatus(region: HTMLElement, text: string): void {
  region.textContent = text;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Focus trap for a modal dialog or drawer: Tab and Shift+Tab stay inside. */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusables = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([hidden]), button:not([aria-hidden="true"]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const list = Array.from(focusables).filter((node) => !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true" && node.offsetParent !== null);
  if (list.length === 0) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface ModalHandle {
  root: HTMLElement;
  close: () => void;
}

/** Opens a modal dialog that returns focus to its opener on Escape and close. */
export function openModal(
  title: string,
  opener: HTMLElement | null,
  build: (modal: ModalHandle) => HTMLElement
): ModalHandle {
  const backdrop = el("div", { class: "modal-backdrop", "data-open": "true" });
  const dialog = el("div", {
    class: "modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
  });
  const heading = el("h2", { class: "modal-title" }, title);
  const body = el("div", { class: "modal-body" });

  let closed = false;
  const handle: ModalHandle = {
    root: dialog,
    close: () => {
      if (closed) return;
      closed = true;
      const reduce = prefersReducedMotion();
      const finish = () => {
        backdrop.remove();
        document.body.classList.remove("modal-open");
        if (opener && document.contains(opener)) opener.focus();
        else dialog.dataset.focusReturn = "none";
      };
      if (reduce) finish();
      else {
        backdrop.classList.add("leaving");
        setTimeout(finish, 250);
      }
    },
  };

  dialog.append(heading, body);
  body.append(build(handle));
  backdrop.append(dialog);
  document.body.classList.add("modal-open");
  document.body.append(backdrop);

  const reduce = prefersReducedMotion();
  if (!reduce) {
    requestAnimationFrame(() => backdrop.classList.add("entering"));
    setTimeout(() => backdrop.classList.add("settled"), 20);
  }
  setTimeout(() => {
    const target = dialog.querySelector<HTMLElement>(
      'input, select, textarea, button:not([disabled]), button:not([aria-disabled="true"])'
    );
    (target ?? dialog).focus();
  }, reduce ? 0 : 260);

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      handle.close();
      document.removeEventListener("keydown", keyHandler, true);
    } else if (event.key === "Tab") {
      trapFocus(dialog, event);
    }
  };
  document.addEventListener("keydown", keyHandler, true);
  dialog.addEventListener("keydown", (event) => trapFocus(dialog, event));
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) handle.close();
  });
  dialog.dataset.opened = "true";
  return handle;
}

/** A sequence number that decides which in-flight response is the latest. */
export class LatestWins {
  private counter = 0;

  begin(): number {
    this.counter += 1;
    return this.counter;
  }

  isLatest(ticket: number): boolean {
    return ticket === this.counter;
  }
}
