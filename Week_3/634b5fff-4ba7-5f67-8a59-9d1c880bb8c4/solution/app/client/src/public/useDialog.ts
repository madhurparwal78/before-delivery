import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

/** The hand-built focus trap of dialogs and sheets: focus goes in, Tab wraps, Escape asks to close, focus goes back. */

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

const focusablesIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);

interface DialogOptions {
  /** Focus the root itself on opening, instead of its first control (sheets). */
  focusRoot?: boolean;
  /** Called on Escape. */
  onEscape?: () => void;
  /** Where focus lands when the dialog closes; defaults to the element that had it when the dialog opened. */
  returnTo?: () => HTMLElement | null;
}

/** Returns the keydown handler to put on the dialog's root. */
export const useDialog = (root: RefObject<HTMLElement | null>, options: DialogOptions = {}): ((event: KeyboardEvent) => void) => {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const element = root.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element) (latest.current.focusRoot ? element : (focusablesIn(element)[0] ?? element)).focus();
    return () => {
      const target = latest.current.returnTo?.() ?? opener;
      if (target?.isConnected) target.focus();
    };
  }, [root]);

  return (event: KeyboardEvent): void => {
    const element = root.current;
    if (!element) return;
    if (event.key === "Escape" && latest.current.onEscape) {
      event.stopPropagation();
      event.preventDefault();
      latest.current.onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    const items = focusablesIn(element);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === element)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
};
