import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DIALOG_IN_MS, DIALOG_OUT_MS, DIALOG_SLIDE_PX, EASE, prefersReducedMotion } from "./motion";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  label: string;
  onClose: () => void;
  /** CSS selector inside the dialog for the control that takes focus first; defaults to the first control. */
  initialFocus?: string;
  children: ReactNode;
}

function setPageInert(inert: boolean) {
  const root = document.getElementById("root");
  if (!root) return;
  if (inert) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
}

export function Dialog({ open, label, onClose, initialFocus, children }: DialogProps) {
  const [mounted, setMounted] = useState(open);
  const element = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(false);

  useLayoutEffect(() => {
    const dialog = element.current;
    if (open) {
      if (isOpen.current) return;
      isOpen.current = true;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setMounted(true);
      if (!dialog) return;
      dialog.getAnimations().forEach((animation) => animation.cancel());
      dialog.show();
      setPageInert(true);
      const first = (initialFocus && dialog.querySelector<HTMLElement>(initialFocus)) || dialog.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
      if (!prefersReducedMotion()) {
        dialog.animate(
          [
            { transform: `translateY(${DIALOG_SLIDE_PX}px)`, opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: DIALOG_IN_MS, easing: EASE },
        );
      }
      return;
    }
    if (!isOpen.current) return;
    isOpen.current = false;
    setPageInert(false);
    if (opener.current?.isConnected) opener.current.focus();
    if (!dialog || prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    dialog.getAnimations().forEach((animation) => animation.cancel());
    const leaving = dialog.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: `translateY(${DIALOG_SLIDE_PX}px)`, opacity: 0 },
      ],
      { duration: DIALOG_OUT_MS, easing: EASE, fill: "forwards" },
    );
    leaving.finished.then(
      () => {
        if (!isOpen.current) setMounted(false);
      },
      () => undefined,
    );
  }, [open, initialFocus]);

  useLayoutEffect(
    () => () => {
      if (isOpen.current) setPageInert(false);
    },
    [],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open && !mounted) return null;
  return createPortal(
    <>
      {open && <div className="scrim" aria-hidden="true" onClick={onClose} />}
      <dialog ref={element} className="dialog" aria-label={label} aria-modal="true" onKeyDown={onKeyDown}>
        {children}
      </dialog>
    </>,
    document.body,
  );
}
