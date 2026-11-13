// Modal dialogs and phone bottom sheets: focus moves in, wraps, Escape closes, focus returns to the opener.
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { EASE_IN_OUT, play } from "./motion";
import { useBand } from "./viewport";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);

interface Props {
  label: string;
  onClose: () => void;
  /** On a phone this dialog is a bottom sheet that rises with `sheet-rise`. */
  sheet?: boolean;
  children: ReactNode;
}

export function Modal({ label, onClose, sheet = false, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const band = useBand();
  const asSheet = sheet && band === "phone";

  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = box.current as HTMLDivElement;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(root)[0] ?? root;
    first.focus();
    if (asSheet) play(root, "sheet-rise", [{ transform: "translateY(min(100%, 32px))" }, { transform: "translateY(0)" }], 240, EASE_IN_OUT);
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(event.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={`overlay${asSheet ? " overlay-sheet" : ""}`}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`dialog${asSheet ? " sheet" : ""}`} onKeyDown={onKeyDown}>
        <h2 className="dialog-title">{label}</h2>
        {children}
      </div>
    </div>
  );
}
