import { el, focusableIn } from "./util.js";

/**
 * One dialog implementation for every dialog in the app. Keeps focus inside,
 * closes on Escape, returns focus to its opener, and survives being reopened
 * during its exit.
 */
export interface DialogHandle {
  close(): void;
  element: HTMLElement;
}

export interface DialogSpec {
  label: string;
  build(body: HTMLElement, close: () => void): void;
  onClose: (returnFocusTo?: HTMLElement) => void;
  returnFocusTo?: HTMLElement;
}

const layer = () => document.getElementById("dialog-layer")!;

let currentDialog: { spec: DialogSpec; root: HTMLElement; opener: HTMLElement | undefined; exitTimer: number | null } | null = null;
let openerBeforeOpen: HTMLElement | null = null;

export function openDialog(spec: DialogSpec): DialogHandle {
  if (currentDialog && currentDialog.exitTimer !== null) {
    // Reopened during its exit: keep it open, cancel the hide timer.
    clearTimeout(currentDialog.exitTimer);
    currentDialog.root.classList.remove("dialog-closing");
    currentDialog.exitTimer = null;
    setInert(false);
    return { close: () => closeOpenDialog(), element: currentDialog.root.querySelector<HTMLElement>(".dialog")! };
  }
  if (currentDialog) closeOpenDialog(true);
  openerBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = el("div", { class: "dialog-backdrop" });
  const dialog = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": spec.label });
  backdrop.append(dialog);
  layer().append(backdrop);
  setInert(true);
  document.documentElement.style.overflow = "hidden";

  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeOpenDialog();
      return;
    }
    if (e.key === "Tab") {
      const focusables = focusableIn(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  backdrop.addEventListener("keydown", keydown);
  document.addEventListener("focusin", trapFocus);

  function trapFocus(e: FocusEvent): void {
    if (currentDialog && !currentDialog.root.contains(e.target as Node)) {
      const dialogEl = currentDialog.root.querySelector<HTMLElement>(".dialog")!;
      const focusables = focusableIn(dialogEl);
      (focusables[0] ?? dialogEl).focus();
    }
  }

  currentDialog = {
    spec,
    root: backdrop,
    opener: (spec.returnFocusTo ?? openerBeforeOpen) ?? undefined,
    exitTimer: null,
  };
  spec.build(dialog, () => closeOpenDialog());
  const initial = focusableIn(dialog);
  return { close: () => closeOpenDialog(), element: dialog };
}

function setInert(on: boolean): void {
  const main = document.getElementById("main");
  const topbar = document.getElementById("topbar");
  const grid = document.querySelector(".grid-lines");
  for (const n of [main, topbar, grid]) {
    if (!n) continue;
    if (on) n.setAttribute("inert", "");
    else n.removeAttribute("inert");
  }
}

export function closeOpenDialog(skipFocus = false): void {
  if (!currentDialog) return;
  const current = currentDialog;
  currentDialog = null;
  setInert(false);
  document.documentElement.style.overflow = "";
  const finish = () => {
    current.root.remove();
  };
  if (current.exitTimer !== null) clearTimeout(current.exitTimer);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    finish();
  } else {
    current.root.classList.add("dialog-closing");
    current.exitTimer = window.setTimeout(finish, 150);
  }
  if (!skipFocus && current.opener && document.contains(current.opener)) {
    current.opener.focus();
  } else if (!skipFocus) {
    current.spec.onClose(undefined);
  }
  current.spec.onClose(skipFocus ? undefined : current.opener);
}

export function isDialogOpen(): boolean {
  return currentDialog !== null;
}

export function refreshOpenDialog(): void {
  // A refresh must not close an open dialog; nothing to do — the dialog lives
  // outside the screens' DOM and is never replaced.
}
