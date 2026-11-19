import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null || element === document.activeElement);
}

interface ModalProps {
  title: string;
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  className?: string;
  plain?: boolean;
  children: (titleId: string) => ReactNode;
}

const open: HTMLElement[] = [];

/** A modal that keeps Tab inside, closes on Escape and gives focus back to the control that opened it. */
export function Modal({ title, onClose, role = "dialog", className = "", plain = false, children }: ModalProps) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = root.current;
    if (!dialog) return;
    open.push(dialog);
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0];
    (first ?? dialog).focus();
    const recover = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Tab" || open[open.length - 1] !== dialog || dialog.contains(document.activeElement)) return;
      event.preventDefault();
      const items = focusables(dialog);
      (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
    };
    document.addEventListener("keydown", recover, true);
    return () => {
      document.removeEventListener("keydown", recover, true);
      open.splice(open.indexOf(dialog), 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !root.current) return;
    const items = focusables(root.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!root.current.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={plain ? "modal-layer modal-layer-plain" : "modal-layer"}>
      <div
        ref={root}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={undefined}
        className={`modal ${className}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-title={title}
      >
        {children(titleId)}
      </div>
    </div>,
    document.body,
  );
}
