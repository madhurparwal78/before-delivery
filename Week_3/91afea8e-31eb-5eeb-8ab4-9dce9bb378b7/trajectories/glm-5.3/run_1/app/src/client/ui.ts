/** DOM helpers and the small shared widgets every page uses. */

export type Html = string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Escape text for attribute and node contexts. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function statusRegion(label: string): HTMLElement {
  return el("div", { class: "status", role: "status", "aria-label": label, id: `status-${slug(label)}` });
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Announce copy in the page's live region. */
export function announce(message: string, region?: HTMLElement): void {
  const target = region ?? document.querySelector<HTMLElement>("[role=status][aria-label='Cart updates']")
    ?? document.querySelector<HTMLElement>("[role=status]");
  if (!target) return;
  clear(target);
  target.append(document.createTextNode(message));
}

/** Every button that calls the server shows a spinner inside it and is disabled until the reply. */
export async function busy<T>(button: HTMLButtonElement, fn: () => Promise<T>): Promise<T> {
  const wasDisabled = button.disabled;
  button.disabled = true;
  const spinner = el("span", { class: "spinner", "aria-hidden": "true" });
  button.prepend(spinner);
  try {
    return await fn();
  } finally {
    spinner.remove();
    button.disabled = wasDisabled;
  }
}

export function dialogShell(title: string, ...children: (Node | string)[]): HTMLDialogElement {
  const dlg = el("dialog", { "aria-label": title });
  const heading = el("h2", { text: title });
  dlg.append(heading, ...children);
  return dlg;
}

/** Dialog contract: focus the first field, wrap Tab inside, Escape closes, focus returns. */
export function openDialog(dlg: HTMLDialogElement, opener: HTMLElement | null): void {
  const previous = document.activeElement as HTMLElement | null;
  const focusFirst = () => {
    const focusable = dlg.querySelector<HTMLElement>("input, select, textarea, button");
    (focusable ?? dlg).focus();
  };
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(dlg.querySelectorAll<HTMLElement>("input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])"))
      .filter((n) => !n.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const closeDialog = () => {
    dlg.close();
    dlg.removeEventListener("keydown", onKeydown);
    const back = opener ?? previous;
    if (back && document.contains(back)) back.focus();
    if (dlg.parentElement) dlg.parentElement.removeChild(dlg);
  };
  dlg.addEventListener("keydown", onKeydown);
  dlg.addEventListener("close", () => {
    dlg.removeEventListener("keydown", onKeydown);
  });
  document.body.append(dlg);
  dlg.showModal();
  queueMicrotask(focusFirst);
}

/** Countdowns computed from the end time and the server time the API returned. */
export class Countdown {
  private timer: number | null = null;
  constructor(
    private readonly element: HTMLElement,
    private readonly endsAtMs: number,
    private readonly clockSkewMs: number,
    private readonly onExpire?: () => void,
  ) {
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    const remaining = Math.max(0, Math.ceil((this.endsAtMs - (Date.now() + this.clockSkewMs)) / 1000));
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    this.element.textContent = `${m}:${String(s).padStart(2, "0")}`;
    if (remaining <= 0) {
      this.stop();
      this.onExpire?.();
    }
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

export function clockSkew(serverTimeIso: string | null | undefined): number {
  if (!serverTimeIso) return 0;
  const server = new Date(serverTimeIso).getTime();
  if (!Number.isFinite(server)) return 0;
  return server - Date.now();
}
