// Modal dialogs: focus moves in and is trapped, Escape closes, focus returns to the opener.
// Adapted from the kit's a11y_dialog module for role="dialog" elements with an inert background.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest("[hidden], [inert]"));
}

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

interface OpenDialog {
  close(): void;
}

let openNow: OpenDialog | null = null;

/** Closes whichever dialog is open (the console closes its dialog when the operator picks another view). */
export function closeOpenDialog(): void {
  openNow?.close();
}

interface Options {
  /** Element to focus first; defaults to the first focusable control. */
  initial?: HTMLElement | null;
  /** Where focus goes on close; defaults to the element focused when the dialog opened. */
  returnTo?: HTMLElement | null;
  /** Elements made inert while the dialog is open. */
  background: HTMLElement[];
  onClose?: () => void;
  /** Escape runs this instead of a plain close (the sound gate enters muted). */
  onEscape?: () => void;
  /** Animate in and out with opacity and a short rise (console dialogs). */
  rise?: boolean;
  /** Close fades out over this many milliseconds (the gate). */
  fadeMs?: number;
}

export function openDialog(dialog: HTMLElement, options: Options): OpenDialog {
  const opener = options.returnTo ?? (document.activeElement as HTMLElement | null);
  for (const element of options.background) element.inert = true;
  dialog.hidden = false;
  const keys = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (options.onEscape) options.onEscape();
      else handle.close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", keys, true);
  (options.initial ?? focusables(dialog)[0] ?? dialog).focus();
  if (options.rise && !reducedMotion()) {
    dialog.animate(
      [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }
  let closed = false;
  const handle: OpenDialog = {
    close() {
      if (closed) return;
      closed = true;
      if (openNow === handle) openNow = null;
      document.removeEventListener("keydown", keys, true);
      for (const element of options.background) element.inert = false;
      dialog.inert = true;
      if (opener?.isConnected) opener.focus();
      options.onClose?.();
      const finish = (): void => {
        dialog.hidden = true;
        dialog.inert = false;
      };
      const duration = reducedMotion() ? 0 : options.fadeMs ?? (options.rise ? 240 : 0);
      if (duration === 0) {
        finish();
        return;
      }
      const frames = options.rise
        ? [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(8px)" }]
        : [{ opacity: 1 }, { opacity: 0 }];
      const fade = dialog.animate(frames, { duration, easing: "ease-out", fill: "forwards" });
      const settle = (): void => {
        finish();
        fade.cancel();
      };
      fade.finished.then(settle, settle);
    },
  };
  openNow = handle;
  return handle;
}
