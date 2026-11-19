import { useId, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

let openModals = 0;

export const modalIsOpen = (): boolean => openModals > 0;

function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0,
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** A dialog is centred; a sheet is anchored to the bottom edge of a phone. */
  variant?: "dialog" | "sheet";
  /** Where focus goes first; the first tabbable control when absent. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** The control focus returns to; the one that had focus when the modal opened when absent. */
  returnFocus?: RefObject<HTMLElement | null>;
  hideTitle?: boolean;
}

/** A modal dialog or sheet: the page behind is inert, Tab wraps inside, Escape closes, focus comes back. */
export function Modal({ title, onClose, children, variant = "dialog", initialFocus, returnFocus, hideTitle }: ModalProps) {
  const shell = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useLayoutEffect(() => {
    const root = document.getElementById("root");
    openModals++;
    if (root) root.inert = true;
    (initialFocus?.current ?? tabbable(shell.current as HTMLElement)[0] ?? shell.current)?.focus();
    const back = returnFocus;
    const from = opener.current;
    return () => {
      openModals--;
      if (openModals === 0 && root) root.inert = false;
      (back?.current ?? from)?.focus();
    };
  }, [initialFocus, returnFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = tabbable(shell.current as HTMLElement);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /** A sheet keeps hidden until its slide ends, so the role sits on the shell; a dialog's role sits on its visible panel. */
  const dialogRole = { role: "dialog", "aria-modal": true, "aria-labelledby": titleId } as const;
  const sheet = variant === "sheet";
  return createPortal(
    <div ref={shell} className={`modal-shell modal-${variant}`} {...(sheet ? dialogRole : {})} onKeyDown={onKeyDown}>
      <div className="modal-backdrop" />
      <div className="modal-panel" {...(sheet ? {} : dialogRole)}>
        <h2 id={titleId} className={hideTitle ? "visually-hidden" : "modal-title"}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.getElementById("modal-root") as HTMLElement,
  );
}
