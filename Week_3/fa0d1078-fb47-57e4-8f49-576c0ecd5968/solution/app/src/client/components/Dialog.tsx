import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  name: string;
  role?: "dialog" | "alertdialog";
  /** Escape closes the dialog by calling this; dialogs that ignore Escape leave it out. */
  onEscape?: () => void;
  /** Runs when the dialog goes away, to put focus where it belongs; without it focus returns to the opener. */
  onClose?: () => void;
  children: ComponentChildren;
}

/** A modal dialog: focus starts on its `data-autofocus` control (else its first control), Tab and Shift+Tab wrap within it, and closing hands focus back via `onClose`. */
export function Dialog({ name, role = "dialog", onEscape, onClose, children }: DialogProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const heading = `dialog-${name.replace(/\s+/g, "-").toLowerCase()}`;
  useLayoutEffect(() => {
    const dialog = root.current;
    if (!dialog) return undefined;
    const opener = document.activeElement;
    const controls = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? dialog).focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const pullBack = (event: FocusEvent): void => {
      if (event.target instanceof Node && !dialog.contains(event.target)) (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? controls()[0] ?? dialog).focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", pullBack);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", pullBack);
      if (onClose) onClose();
      else if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);
  return (
    <div class="scrim">
      <div ref={root} class="dialog" role={role} aria-modal="true" aria-labelledby={heading} tabIndex={-1}>
        <h2 id={heading} class="dialog-title">
          {name}
        </h2>
        {children}
      </div>
    </div>
  );
}
