import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { focusables, isTopDialog, popDialog, pushDialog, trapTab } from "./focus";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
  /** Where focus goes back to; defaults to the element that was focused when the dialog opened. */
  returnFocusTo?: HTMLElement | null;
}

/** A centred panel at 600px and wider, a bottom sheet below; Tab stays inside, Escape closes, focus returns. */
export function Dialog({ title, onClose, children, role = "dialog", returnFocusTo }: Props) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [opener] = useState<HTMLElement | null>(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const token = useRef(Symbol("dialog"));
  const pressedScrim = useRef(false);

  useLayoutEffect(() => {
    const own = token.current;
    pushDialog(own);
    const root = panel.current;
    if (root) {
      const target = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root).find((element) => !element.hasAttribute("data-close")) ?? root;
      target.focus({ preventScroll: true });
    }
    return () => {
      popDialog(own);
      const back = returnFocusTo ?? opener;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [opener, returnFocusTo]);

  useEffect(() => {
    const pull = (event: FocusEvent): void => {
      const root = panel.current;
      if (!root || !isTopDialog(token.current) || !(event.target instanceof Node) || root.contains(event.target)) return;
      (focusables(root)[0] ?? root).focus();
    };
    document.addEventListener("focusin", pull);
    return () => document.removeEventListener("focusin", pull);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!isTopDialog(token.current) || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (panel.current) trapTab(event, panel.current);
  };

  return createPortal(
    <div
      className="scrim"
      onPointerDown={(event) => {
        pressedScrim.current = event.target === event.currentTarget;
      }}
      onMouseDown={(event) => {
        if (event.target instanceof Element && !event.target.closest("input, textarea, select, button, a, [tabindex='0'], [role='option']")) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedScrim.current && isTopDialog(token.current)) onClose();
        pressedScrim.current = false;
      }}
    >
      <div ref={panel} className="dialog" role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="dialog-head">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button type="button" className="icon-button" aria-label="Close dialog" data-close onClick={onClose}>
            <X aria-hidden="true" size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
