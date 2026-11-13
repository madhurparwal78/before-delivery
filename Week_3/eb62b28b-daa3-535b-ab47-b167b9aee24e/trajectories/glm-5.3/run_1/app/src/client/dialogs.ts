import { el } from "./dom.js";
import { closeDialogMotion, openDialogMotion, prefersReducedMotion } from "./motion.js";

export type DialogSpec = {
  title: string;
  content: (dialog: HTMLDialogElement) => HTMLElement | HTMLElement[];
  onOpen?: (dialog: HTMLDialogElement) => void;
  onClose?: () => void;
};

const closingDialogs = new Set<HTMLDialogElement>();

/** A dialog that traps Tab, closes on Escape and returns focus to its opener. */
export function openDialog(spec: DialogSpec, opener: HTMLElement | null, bottomSheet = false): HTMLDialogElement {
  const dialog = el("dialog", { class: bottomSheet ? "dialog sheet" : "dialog", "aria-label": spec.title });
  const heading = el("h2", { class: "dialog-title" }, spec.title);
  const close = el("button", { type: "button", class: "dialog-close", "aria-label": "Close" }, "Close");
  const body = el("div", { class: "dialog-body" });
  const content = spec.content(dialog);
  if (Array.isArray(content)) body.append(...content);
  else body.append(content);
  dialog.append(heading, close, body);
  document.body.append(dialog);
  dialog.showModal();
  openDialogMotion(body);
  const firstField = dialog.querySelector("input, textarea, select") as HTMLElement | null;
  const firstButton = dialog.querySelector("button") as HTMLElement | null;
  (firstField ?? firstButton)?.focus();
  if (spec.onOpen) spec.onOpen(dialog);

  const finishClose = () => {
    dialog.close();
    dialog.remove();
    if (opener && document.contains(opener)) {
      opener.focus();
    } else {
      const heading = document.querySelector("h1") as HTMLElement | null;
      heading?.focus();
    }
    spec.onClose?.();
  };

  close.addEventListener("click", () => {
    beginClose();
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    beginClose();
  });

  dialog.addEventListener("close", () => {
    if (!dialog.open) spec.onClose?.();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      beginClose();
      return;
    }
    if (event.key === "Tab") {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
      ).filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0] ?? null;
      const last = focusables[focusables.length - 1] ?? null;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  if (bottomSheet) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) beginClose();
    });
  }

  let closeTimer = 0;
  function beginClose(): void {
    if (closingDialogs.has(dialog)) return;
    closingDialogs.add(dialog);
    const duration = closeDialogMotion(dialog.querySelector(".dialog-body") ?? dialog);
    if (duration === 0) {
      closingDialogs.delete(dialog);
      finishClose();
      return;
    }
    closeTimer = window.setTimeout(() => {
      if (!closingDialogs.has(dialog)) return;
      closingDialogs.delete(dialog);
      finishClose();
    }, duration);
  }

  // SR2: pressing the opener again during the closing animation reopens it.
  if (opener) {
    const handler = () => {
      if (closingDialogs.has(dialog)) {
        closingDialogs.delete(dialog);
        window.clearTimeout(closeTimer);
        openDialogMotion(dialog.querySelector(".dialog-body") ?? dialog);
        const first = dialog.querySelector("input, textarea, select") as HTMLElement | null;
        (first ?? dialog.querySelector("button"))?.focus();
      }
    };
    opener.addEventListener("click", handler);
    dialog.addEventListener("close", () => {
      opener.removeEventListener("click", handler);
    });
  }

  return dialog;
}

export type FieldErrors = Record<string, string>;

/** The Problems summary: one link per field error, each moving focus to its field. */
export function problemsRegion(errors: FieldErrors, focusIt: boolean): HTMLElement {
  const existing = document.getElementById("problems");
  const region =
    existing ??
    (() => {
      const node = el("div", { id: "problems", role: "region", "aria-label": "Problems", class: "problems" });
      document.querySelector("main")?.prepend(node);
      return node;
    })();
  region.replaceChildren();
  for (const [field, message] of Object.entries(errors)) {
    const link = el("a", { href: `#${field}`, class: "problem-link" }, message);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const target = document.getElementById(field) as HTMLElement | null;
      target?.focus();
    });
    region.append(el("p", {}, link));
  }
  region.hidden = false;
  if (focusIt && !prefersReducedMotion()) {
    region.setAttribute("tabindex", "-1");
    region.focus({ preventScroll: false });
  }
  return region;
}

export function clearProblems(): void {
  const region = document.getElementById("problems");
  if (region) {
    region.replaceChildren();
    region.hidden = true;
  }
}

export function messageRegion(text: string, focusIt = false): HTMLElement {
  const region = el("div", { class: "form-message", role: "alert" }, text);
  if (focusIt) {
    region.setAttribute("tabindex", "-1");
    region.focus();
  }
  return region;
}

