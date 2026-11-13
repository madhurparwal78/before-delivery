// DOM and interaction helpers for the Interline Desk front end.

export type Child = Node | string | null | undefined | false;

type ElementTagMap = {
  button: HTMLButtonElement; input: HTMLInputElement; select: HTMLSelectElement;
  textarea: HTMLTextAreaElement; form: HTMLFormElement; a: HTMLAnchorElement;
  table: HTMLTableElement; thead: HTMLTableSectionElement; tbody: HTMLTableSectionElement;
  tr: HTMLTableRowElement; th: HTMLTableCellElement; td: HTMLTableCellElement;
  label: HTMLLabelElement; ul: HTMLUListElement; li: HTMLLIElement; aside: HTMLElement;
  article: HTMLElement; section: HTMLElement; nav: HTMLElement; header: HTMLElement;
  footer: HTMLElement; main: HTMLElement; div: HTMLElement; span: HTMLElement;
  p: HTMLElement; h1: HTMLHeadingElement; h2: HTMLHeadingElement; h3: HTMLHeadingElement;
  h4: HTMLHeadingElement; h5: HTMLHeadingElement; i: HTMLElement; svg: HTMLElement;
};

export function h<T extends keyof ElementTagMap>(tag: T, attrs?: Record<string, any> | null, ...children: Child[]): ElementTagMap[T];
export function h<T extends HTMLElement = HTMLElement>(tag: string, attrs?: Record<string, any> | null, ...children: Child[]): T;
export function h(tag: string, attrs?: Record<string, any> | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) { appendChildren(el, c as Child[]); continue; }
    if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c as Node);
  }
}

export function div(cls: string, ...children: Child[]): HTMLElement {
  return h("div", { class: cls }, ...children);
}

export function clearEl(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export interface Feedback {
  setStatus(msg: string): void;
  setProblem(msg: string): void;
  clearStatus(): void;
  clearProblem(): void;
}

export function createLiveRegions(): { statusEl: HTMLElement; alertEl: HTMLElement; fb: Feedback } {
  const statusEl = h("div", { class: "live-status", role: "status", "aria-label": "Desk updates" });
  const alertEl = h("div", { class: "live-region", role: "alert", "aria-label": "Desk problems" });
  return { statusEl, alertEl, fb: { setStatus: (m) => { statusEl.textContent = m; }, setProblem: (m) => { alertEl.textContent = m; }, clearStatus: () => { statusEl.textContent = ""; }, clearProblem: () => { alertEl.textContent = ""; } } };
}

export const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Standard dialog controller: focus trap, Tab wrap, Escape to close, focus return. */
export class Dialog {
  backdrop: HTMLElement;
  dlg: HTMLElement;
  opener: HTMLElement | null;
  onClose: ((result: boolean) => void) | null = null;
  private firstField: HTMLElement | null = null;
  private focusables: HTMLElement[] = [];

  constructor(dlg: HTMLElement, opener: HTMLElement | null = null, opts?: { labelledBy?: string }) {
    this.dlg = dlg;
    this.opener = opener;
    this.backdrop = h("div", { class: "dialog-backdrop" });
    this.backdrop.appendChild(dlg);
    void opts;
  }

  open(): void {
    document.body.appendChild(this.backdrop);
    document.body.classList.add("no-scroll");
    this.initFocusables();
    this.focusFirst();
    document.addEventListener("keydown", this.kb);
  }

  close(result = false): void {
    document.removeEventListener("keydown", this.kb);
    this.backdrop.remove();
    document.body.classList.remove("no-scroll");
    if (this.onClose) this.onClose(result);
    restoreFocus(this.opener);
  }

  private kb = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault(); ev.stopPropagation();
      this.close(false);
    } else if (ev.key === "Tab") {
      const f = this.currentFocusables();
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && (document.activeElement === first || !this.dlg.contains(document.activeElement))) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault(); first.focus();
      }
    }
  };

  private initFocusables(): void {
    this.focusables = getFocusable(this.dlg);
  }

  focusFirst(): void {
    const f = getFocusable(this.dlg);
    if (f.length) f[0].focus();
  }

  private currentFocusables(): HTMLElement[] {
    return getFocusable(this.dlg);
  }

  update(): void { this.initFocusables(); }
}

export function getFocusable(root: HTMLElement): HTMLElement[] {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    const t = el.getAttribute("tabindex");
    if (t && parseInt(t, 10) < 0) return false;
    return true;
  });
}

export function restoreFocus(el: HTMLElement | null): void {
  if (el && document.body.contains(el)) el.focus();
}

export async function postFeedback(promise: Promise<unknown>, fb: Feedback, pending: string, success: string | ((data: any) => string)): Promise<boolean> {
  fb.setStatus(pending);
  try {
    const data = await promise;
    fb.setStatus(typeof success === "function" ? success(data) : success);
    return true;
  } catch (e: any) {
    fb.setProblem(e.message);
    return false;
  }
}

export function bindHeaderScroll(): void {
  const header = document.querySelector<HTMLElement>(".site-header");
  if (!header) return;
  const upd = () => header.classList.toggle("scrolled", window.scrollY > 10);
  upd();
  window.addEventListener("scroll", upd, { passive: true });
}

export function formatBytes(n: number): string {
  return `${n} bytes`;
}
