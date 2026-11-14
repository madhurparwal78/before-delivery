type Child = Node | string | null | undefined | false | Child[];
type AttrValue = string | number | boolean | null | undefined | ((event: never) => void);

/** Creates an element; `on*` attributes become listeners, `false`/`null` attributes are left out. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function setAttrs(el: HTMLElement, attrs: Record<string, AttrValue>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "value" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement))
      el.value = String(value);
    else if (key === "checked" && el instanceof HTMLInputElement) el.checked = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

function append(el: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function setRegion(id: string, text: string): void {
  const region = document.getElementById(id);
  if (!region) return;
  if (region.textContent === text) region.textContent = "";
  region.textContent = text;
}

/** Polite announcement through #announcer. */
export function announce(text: string): void {
  if (text) setRegion("announcer", text);
}

/** Assertive refusal through #alert. */
export function alertText(text: string): void {
  setRegion("alert", text);
}

export function focusables(root: Element): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hidden && el.getClientRects().length > 0);
}

export interface Dialog {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
}

export interface DialogOptions {
  title: string;
  opener: HTMLElement | null;
  className?: string;
  onClose?: () => void;
  /** Overrides the Tab cycle (the calendar cycles through its own four stops). */
  tabStops?: () => HTMLElement[];
}

/** A modal dialog: focus wraps inside it, Escape closes it, and closing returns focus to its opener. */
export function openDialog(options: DialogOptions, ...content: Child[]): Dialog {
  const titleId = uid("dialog-title");
  const body = h("div", { class: "dialog-body" });
  append(body, content);
  const el = h(
    "div",
    { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, class: `dialog ${options.className ?? ""}` },
    h("h2", { id: titleId }, options.title),
    body,
  );
  const backdrop = h("div", { class: "dialog-backdrop" }, el);
  const root = document.getElementById("root") as HTMLElement;
  const close = (): void => {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    if (!document.querySelector(".dialog-backdrop")) root.inert = false;
    options.onClose?.();
    options.opener?.focus();
  };
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = options.tabStops ? options.tabStops() : focusables(el);
    if (stops.length === 0) return;
    const index = stops.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    const next = event.shiftKey ? (index <= 0 ? stops.length - 1 : index - 1) : index === stops.length - 1 || index < 0 ? 0 : index + 1;
    stops[next].focus();
  });
  document.body.appendChild(backdrop);
  root.inert = true;
  return { el, body, close };
}

/** Focuses the first control of a dialog. */
export function focusFirst(dialog: Dialog): void {
  focusables(dialog.body)[0]?.focus();
}

export function setTitle(text: string): void {
  document.title = text;
}

export function field(label: string, control: HTMLElement, error?: HTMLElement): HTMLElement {
  const id = control.id || uid("field");
  control.id = id;
  return h("div", { class: "field" }, h("label", { for: id }, label), control, error ?? null);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Restarts a CSS animation class on an element. */
export function restartAnimation(el: Element, className: string): void {
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
}
