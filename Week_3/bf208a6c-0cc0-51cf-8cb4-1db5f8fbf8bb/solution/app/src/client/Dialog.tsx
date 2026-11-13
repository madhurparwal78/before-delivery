import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { DURATION, play, reducedMotion } from "./motion";

const CloseContext = createContext<() => void>(() => undefined);

/** Closes the dialog it is rendered in, after its exit motion. */
export const useDialogClose = (): (() => void) => useContext(CloseContext);

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
}

interface Props {
  label: string;
  onClose: () => void;
  /** Below 768px the dialog is a bottom sheet that slides up and down. */
  sheet?: boolean;
  alert?: boolean;
  className?: string;
  children: ReactNode;
}

/** A modal dialog: Tab and Shift+Tab wrap inside it, Escape closes it, and focus returns to what opened it. */
export function Dialog({ label, onClose, sheet = false, alert = false, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [closing, setClosing] = useState(false);
  const asSheet = sheet && window.matchMedia("(max-width: 767px)").matches;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const first = focusables(dialog).find((element) => element.hasAttribute("data-autofocus")) ?? focusables(dialog)[0];
    first?.focus();
    if (asSheet) void play(dialog, [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], DURATION.sheet);
    return () => {
      const target = opener.current;
      const active = document.activeElement;
      const holdsFocus = !active || active === document.body || dialog.contains(active);
      dialog.close();
      if (target instanceof HTMLElement && target.isConnected && holdsFocus) target.focus();
    };
  }, [asSheet]);

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    const dialog = ref.current;
    if (!closing || !dialog) return;
    if (asSheet && !reducedMotion()) void play(dialog, [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], DURATION.sheet).then(onClose);
    else onClose();
  }, [closing, asSheet, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      const items = focusables(event.currentTarget);
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (items.length === 0) event.preventDefault();
      else if (document.activeElement === edge || !event.currentTarget.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0])?.focus();
      }
    }
  };

  return (
    <CloseContext.Provider value={close}>
      <dialog
        ref={ref}
        role={alert ? "alertdialog" : "dialog"}
        aria-label={label}
        className={`dialog${asSheet ? " dialog-sheet" : ""}${className ? ` ${className}` : ""}`}
        onKeyDown={onKeyDown}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        {children}
      </dialog>
    </CloseContext.Provider>
  );
}
