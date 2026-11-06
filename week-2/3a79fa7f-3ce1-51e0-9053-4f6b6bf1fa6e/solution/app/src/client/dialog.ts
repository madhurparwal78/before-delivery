// Modal dialogs and the cart drawer: native <dialog>, focus trapped and returned, Escape and backdrop close,
// drawer slides from the right frame by frame on the page clock, other dialogs fade and grow; instant under
// reduced motion.
// (Pattern adapted from kit/modules/a11y_dialog.)
import { CURVES, EASE, reducedMotion, tween } from "./dom.ts";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
}

interface Opened {
  close(): Promise<void>;
}

const DRAWER = { enterMs: 300, leaveMs: 200 };
const DIALOG_MS = 200;

/** Slides the drawer between `from` and `to` (shares of its width off the right edge); resolves at rest. */
function slide(dialog: HTMLDialogElement, from: number, to: number, ms: number, curve: (x: number) => number): Promise<void> {
  const place = (off: number) => (dialog.style.transform = off ? `translateX(${off * 100}%)` : "");
  if (reducedMotion()) {
    place(to);
    return Promise.resolve();
  }
  place(from);
  return new Promise((resolve) => tween(ms, curve, (p, done) => {
    place(from + (to - from) * p);
    if (done) resolve();
  }));
}

/** Opens `dialog` modally; `onShown` runs once its entrance has come to rest. */
export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, kind: "drawer" | "dialog" = "dialog", onClose?: () => void, onShown?: () => void): Opened {
  const returnTo = opener ?? (document.activeElement as HTMLElement | null);
  let closing = false;

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  const onCancel = (event: Event) => {
    event.preventDefault();
    void close();
  };
  const onBackdrop = (event: MouseEvent) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    if (outside) void close();
  };

  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("click", onBackdrop);
    if (kind === "drawer") await slide(dialog, 0, 1, DRAWER.leaveMs, CURVES.accelerate);
    else if (!reducedMotion()) {
      await dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DIALOG_MS, easing: EASE.accelerate, fill: "forwards" }).finished.catch(() => undefined);
    }
    dialog.close();
    dialog.style.transform = "";
    dialog.getAnimations().forEach((a) => a.cancel());
    returnTo?.focus();
    onClose?.();
  }

  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onBackdrop);
  dialog.showModal();
  if (kind === "drawer") {
    void (async () => {
      await slide(dialog, 1, 0, DRAWER.enterMs, CURVES.decelerate);
      onShown?.();
    })();
  }
  else {
    if (!reducedMotion()) dialog.animate([{ opacity: 0, transform: "scale(0.98)" }, { opacity: 1, transform: "scale(1)" }], { duration: DIALOG_MS, easing: EASE.decelerate });
    onShown?.();
  }
  const target = dialog.querySelector<HTMLElement>("[autofocus]") ?? focusables(dialog)[0];
  (target ?? dialog).focus();
  return { close };
}
