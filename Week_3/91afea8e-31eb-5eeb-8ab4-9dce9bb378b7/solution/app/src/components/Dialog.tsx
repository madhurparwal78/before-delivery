import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'button, input, select, textarea, a[href], summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !(element as HTMLInputElement).disabled && !element.hidden && element.getAttribute("type") !== "hidden" && element.getClientRects().length > 0,
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  /** A full-width sheet (the phone filters). */
  sheet?: boolean;
  children: ReactNode;
}

/** A modal dialog: focus goes to the first field, Tab and Shift+Tab wrap inside, Escape closes and focus returns to the opener. */
export function Dialog({ title, onClose, sheet, children }: DialogProps): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    const dialog = box.current as HTMLDivElement;
    (focusables(dialog)[0] ?? dialog).focus();
    return () => {
      root?.removeAttribute("inert");
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const trap = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") return;
    const dialog = box.current as HTMLDivElement;
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

  return createPortal(
    <div className={`dialog-backdrop${sheet ? " dialog-backdrop--sheet" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} className={`dialog${sheet ? " dialog--sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={trap}>
        <h3 id={titleId} className="dialog__title">
          {title}
        </h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}
