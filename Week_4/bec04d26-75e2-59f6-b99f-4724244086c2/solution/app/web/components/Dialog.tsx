import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef } from "react";
import { focusables, prefersReducedMotion } from "../lib/dom";

const CloseContext = createContext<() => void>(() => undefined);

/** Closes the surrounding dialog (the send-back sheet slides down first). */
export const useDialogClose = (): (() => void) => useContext(CloseContext);

interface DialogProps {
  title: string;
  onClose: () => void;
  /** A bottom sheet that slides up and down (it appears at once under reduced motion). */
  sheet?: boolean;
  /** Where focus goes on close when the control that opened the dialog no longer exists. */
  fallbackFocus?: () => void;
  children: ReactNode;
}

const SHEET_MS = 280;
const SHEET_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** A modal dialog: opens on its first field, wraps Tab inside, closes on Escape and returns focus to its opener. */
export function Dialog({ title, onClose, sheet = false, fallbackFocus, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const closing = useRef(false);
  const fallback = useRef(fallbackFocus);
  fallback.current = fallbackFocus;
  const titleId = useId();

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (sheet && ref.current && !prefersReducedMotion()) {
      const slide = ref.current.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
        { duration: SHEET_MS, easing: SHEET_EASING, fill: "forwards" });
      slide.finished.then(onClose, onClose);
    } else {
      onClose();
    }
  }, [onClose, sheet]);

  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    (focusables(dialog)[0] ?? dialog).focus();
    if (sheet && !prefersReducedMotion()) {
      dialog.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
        { duration: SHEET_MS, easing: SHEET_EASING });
    }
  }, [sheet]);

  useEffect(() => () => {
    const target = opener.current;
    if (target instanceof HTMLElement && target.isConnected) target.focus();
    else fallback.current?.();
  }, []);

  const wrapTab = (event: React.KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== "Tab") return;
    const items = focusables(event.currentTarget);
    const active = document.activeElement as HTMLElement;
    const index = items.indexOf(active);
    const last = items.length - 1;
    if (!items.length) event.preventDefault();
    else if (index === -1) {
      // Focus is on a message (tabindex -1): move to the neighbour in document order, wrapping at the ends.
      const precedes = (el: HTMLElement): boolean => Boolean(el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
      const follows = (el: HTMLElement): boolean => Boolean(el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_PRECEDING);
      const next = event.shiftKey ? [...items].reverse().find(precedes) ?? items[last] : items.find(follows) ?? items[0];
      event.preventDefault();
      next.focus();
    } else if (event.shiftKey && index === 0) {
      event.preventDefault();
      items[last].focus();
    } else if (!event.shiftKey && index === last) {
      event.preventDefault();
      items[0].focus();
    }
  };

  return (
    <CloseContext.Provider value={requestClose}>
      <dialog ref={ref} className={sheet ? "dialog sheet" : "dialog"} aria-labelledby={titleId} tabIndex={-1}
        onCancel={(event) => { event.preventDefault(); requestClose(); }} onKeyDown={wrapTab}>
        <h2 id={titleId} className="dialog-title">{title}</h2>
        {children}
      </dialog>
    </CloseContext.Provider>
  );
}
