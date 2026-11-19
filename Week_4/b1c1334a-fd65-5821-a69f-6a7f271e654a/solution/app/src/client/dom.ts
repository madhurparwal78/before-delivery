// Small DOM helpers: element building, Lucide icons and live-region announcements.
import {
  ChevronDown, CircleAlert, Download, FileSpreadsheet, House, LogOut, PanelLeft, Pencil, Plus, Redo2, Share2,
  Sigma, Table2, Trash2, Undo2, createElement as lucide,
} from "lucide";

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    else if (name === "class") el.className = String(value);
    else if (value === true) el.setAttribute(name, "");
    else el.setAttribute(name, String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

const ICONS = {
  alert: CircleAlert, chevron: ChevronDown, download: Download, file: FileSpreadsheet, home: House, signOut: LogOut,
  panel: PanelLeft, pencil: Pencil, plus: Plus, redo: Redo2, share: Share2, sigma: Sigma, table: Table2, trash: Trash2,
  undo: Undo2,
} as const;

type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGElement {
  const svg = lucide(ICONS[name]);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "icon");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  return svg;
}

export function button(label: string, attrs: Attrs = {}, iconName?: IconName): HTMLButtonElement {
  return h("button", { type: "button", class: "btn", ...attrs }, iconName ? icon(iconName) : null, h("span", {}, label));
}

// Empties a live region, then fills it, so a message identical to the last is announced again.
export function announce(region: HTMLElement, text: string): void {
  region.textContent = "";
  queueMicrotask(() => {
    region.textContent = text;
  });
}

export function setBusy(control: HTMLButtonElement, busy: boolean): void {
  control.disabled = busy;
  if (busy) control.setAttribute("aria-busy", "true");
  else control.removeAttribute("aria-busy");
}

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export type Layout = "phone" | "tablet" | "desktop";

// The width picks one of the three layouts.
export const layoutOf = (): Layout => (window.innerWidth < 768 ? "phone" : window.innerWidth < 1280 ? "tablet" : "desktop");

export const overlay = (): HTMLElement => document.getElementById("overlay")!;

export function isTextField(el: Element | null): boolean {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
}

// Places a floating element under (or above) an anchor, inside the viewport and above the status bar.
export function place(floating: HTMLElement, anchor: DOMRect, statusBarTop: number): void {
  floating.style.left = "0px";
  floating.style.top = "0px";
  floating.style.maxHeight = "";
  const box = floating.getBoundingClientRect();
  const limit = Math.min(window.innerHeight, statusBarTop) - 4;
  let left = Math.min(anchor.left, window.innerWidth - box.width - 4);
  left = Math.max(4, left);
  let top = anchor.bottom + 2;
  if (top + box.height > limit) {
    const above = anchor.top - box.height - 2;
    if (above >= 4) top = above;
    else {
      top = Math.max(4, Math.min(top, limit - box.height));
      if (top + box.height > limit) floating.style.maxHeight = `${limit - top}px`;
    }
  }
  floating.style.left = `${left}px`;
  floating.style.top = `${top}px`;
}
