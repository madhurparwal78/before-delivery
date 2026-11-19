// Modal dialogs and sheets: focus stays inside, Escape closes, focus returns to the opener.
// Closing is immediate, so a dialog reopened after a close is never hidden by a leftover timer.
import { prefersReducedMotion } from "./dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), audio[controls], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]") && el.getClientRects().length > 0);
}

interface Options {
  initialFocus?: HTMLElement | null;
  /** Where focus goes on close; the opener by default. */
  returnFocus?: () => HTMLElement | null;
  onClose?: () => void;
}

/** Each open dialog's close function. */
const open = new WeakMap<HTMLDialogElement, () => void>();
const entrances = new WeakMap<HTMLDialogElement, number>();

/** Fades the dialog in and lifts it 8 px on animation frames; a newer opening cancels an older run. */
function enter(dialog: HTMLDialogElement): void {
  cancelAnimationFrame(entrances.get(dialog) ?? 0);
  const settle = () => {
    entrances.delete(dialog);
    dialog.style.removeProperty("opacity");
    dialog.style.removeProperty("translate");
  };
  if (prefersReducedMotion()) return settle();
  const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--t-dialog"));
  let started = -1;
  const step = (now: number) => {
    if (started < 0) started = now;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    dialog.style.opacity = String(eased);
    dialog.style.translate = `0 ${(8 * (1 - eased)).toFixed(2)}px`;
    if (progress < 1 && dialog.open) entrances.set(dialog, requestAnimationFrame(step));
    else settle();
  };
  dialog.style.opacity = "0";
  dialog.style.translate = "0 8px";
  entrances.set(dialog, requestAnimationFrame(step));
}

export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null, options: Options = {}): () => void {
  open.get(dialog)?.();
  const trap = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  const cancel = (event: Event) => {
    event.preventDefault();
    close();
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open.delete(dialog);
    dialog.removeEventListener("keydown", trap);
    dialog.removeEventListener("cancel", cancel);
    if (dialog.open) dialog.close();
    options.onClose?.();
    (options.returnFocus?.() ?? opener)?.focus();
  };
  dialog.addEventListener("keydown", trap);
  dialog.addEventListener("cancel", cancel);
  open.set(dialog, close);
  if (!dialog.open) {
    dialog.showModal();
    enter(dialog);
  }
  (options.initialFocus ?? focusables(dialog)[0] ?? dialog).focus();
  return close;
}
