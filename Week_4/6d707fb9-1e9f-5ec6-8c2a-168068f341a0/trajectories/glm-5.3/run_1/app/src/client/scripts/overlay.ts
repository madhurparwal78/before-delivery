// Dialog, sheet, menu and popover behaviour: focus trap, Escape, SR2/SR8/SR9/SR20.

import { el } from "./api.js";

export interface OverlayOptions {
  label: string;
  opener: HTMLElement | null;
  sheet?: boolean;
  onOpen?: (root: HTMLElement) => void;
  onClose?: () => void;
}

const openLayers: { root: HTMLElement; dialog: HTMLDialogElement; opener: HTMLElement | null; onClose: () => void }[] = [];

export function overlayOpen(options: OverlayOptions): HTMLElement {
  const dialog = document.createElement("dialog");
  if (options.sheet) dialog.className = "sheet";
  dialog.setAttribute("aria-label", options.label);
  const body = el("div", { class: "dialog-body" });
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    const idx = openLayers.findIndex((l) => l.dialog === dialog);
    if (idx >= 0) openLayers.splice(idx, 1);
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    overlayClose(dialog);
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    // Keep Tab inside the dialog: a native dialog element alone does not.
    const focusables = focusableIn(dialog);
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
  });
  const layer = { root: body, dialog, opener: options.opener, onClose: () => options.onClose?.() };
  openLayers.push(layer);
  dialog.showModal();
  // Focus moves inside on every opening, not only the first.
  const target = focusableIn(dialog)[0] ?? dialog;
  target.focus();
  return body;
}

export function overlayClose(dialog: HTMLDialogElement, moveTo?: HTMLElement): void {
  const layer = openLayers.find((l) => l.dialog === dialog);
  if (!layer) return;
  openLayers.splice(openLayers.indexOf(layer), 1);
  dialog.close();
  dialog.remove();
  layer.onClose?.();
  const target = moveTo ?? layer.opener;
  if (target && document.contains(target)) {
    target.focus();
  } else {
    const h1 = document.querySelector("main h1") as HTMLElement | null;
    h1?.setAttribute("tabindex", "-1");
    h1?.focus({ preventScroll: true });
  }
}

export function topOverlay(): HTMLDialogElement | null {
  return openLayers.length > 0 ? openLayers[openLayers.length - 1].dialog : null;
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const sel = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((n) => n.offsetParent !== null || n.closest("dialog") !== null);
}

/** A menu, popover or listbox anchored to a control, never cut off by its frame. */
export function floatingPanel(anchor: HTMLElement, build: (root: HTMLElement) => void): HTMLElement {
  const panel = el("div", { class: "menu", role: "menu" });
  build(panel);
  document.body.append(panel);
  const rect = anchor.getBoundingClientRect();
  const pH = panel.offsetHeight;
  const pW = panel.offsetWidth;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = rect.bottom + 4;
  if (top + pH > vh - 8) top = Math.max(8, rect.top - pH - 4);
  let left = Math.min(rect.left, vw - pW - 8);
  left = Math.max(8, left);
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  panel.style.visibility = "visible";
  return panel;
}
