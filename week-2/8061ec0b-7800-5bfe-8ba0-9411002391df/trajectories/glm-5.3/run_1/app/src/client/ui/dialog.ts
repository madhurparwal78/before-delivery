// Dialog framework: focus stays inside, Escape and Cancel close, focus
// returns to the opener, and reopening during an exit keeps the dialog open
// (DP-51, DP-72).
import { h, FOCUSABLE } from "./dom.js";
import { animateValue, prefersReducedMotion } from "./motion.js";

export interface DialogHandle {
  close(): void;
  element: HTMLElement;
}

interface PendingClose {
  dialog: HTMLElement;
  timer: number;
}

const pendingCloses: PendingClose[] = [];

export function openDialog(options: {
  name: string;
  opener: HTMLElement;
  build(body: HTMLElement, close: () => void): void;
  onClose?(): void;
}): DialogHandle {
  // Reopening a dialog that is still leaving shows it open again.
  const pending = pendingCloses.find((p) => p.dialog.dataset.dialogName === options.name);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCloses.splice(pendingCloses.indexOf(pending), 1);
    pending.dialog.remove();
  }

  const overlay = h("div", { class: "dialog-overlay hidden-dialog" });
  const dialog = h("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-label": options.name,
    class: "dialog hidden-dialog",
    "data-dialog-name": options.name,
  });
  overlay.appendChild(dialog);
  const close = (): void => {
    // From the moment closing starts it takes no clicks or keys, and focus
    // has already moved on.
    dialog.classList.add("dialog-closing");
    overlay.classList.add("dialog-overlay-closing");
    const remove = (): void => {
      overlay.remove();
      const idx = pendingCloses.findIndex((p) => p.dialog === dialog);
      if (idx >= 0) pendingCloses.splice(idx, 1);
    };
    if (prefersReducedMotion()) {
      remove();
    } else {
      const timer = window.setTimeout(remove, 200);
      pendingCloses.push({ dialog, timer });
    }
    options.onClose?.();
  };
  options.build(dialog, close);
  document.body.appendChild(overlay);

  // It rises in from 12 pixels below its resting place and fades in.
  dialog.classList.remove("hidden-dialog");
  overlay.classList.remove("hidden-dialog");
  if (!prefersReducedMotion()) {
    dialog.style.transform = "translateY(12px)";
    dialog.style.opacity = "0";
    animateValue(
      dialog,
      { from: { transform: "translateY(12px)", opacity: "0" }, to: { transform: "translateY(0px)", opacity: "1" } },
      "medium"
    );
    overlay.style.opacity = "0";
    animateValue(overlay, { from: { opacity: "0" }, to: { opacity: "1" } }, "quick");
  }

  const firstField = dialog.querySelector<HTMLElement>(
    'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])'
  );
  (firstField ?? dialog).focus();

  const focusables = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      options.opener.focus();
      close();
      return;
    }
    if (event.key === "Tab") {
      const list = focusables();
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
  });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      options.opener.focus();
      close();
    }
  });
  return { close, element: dialog };
}
