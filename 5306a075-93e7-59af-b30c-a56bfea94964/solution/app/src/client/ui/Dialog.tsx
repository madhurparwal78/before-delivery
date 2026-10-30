// Modal dialogs on native <dialog> (adapted from kit/modules/a11y_dialog): focus moves to the first field,
// Tab and Shift+Tab cycle inside, Escape closes, focus returns to the control that opened it.
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion, QUICK, SETTLE } from "../motion.js";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function Dialog(props: {
  title: string;
  role?: "dialog" | "alertdialog";
  onClosed: () => void;
  returnFocus?: () => HTMLElement | null;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closing = useRef(false);
  const behind = useRef<HTMLElement[]>([]);
  const reveal = (): void => behind.current.forEach((el) => el.removeAttribute("aria-hidden"));
  const titleId = useId();
  const { onClosed, returnFocus } = props;

  const close = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    const finish = (): void => {
      dialog.close();
      reveal();
      onClosed();
      (returnFocus?.() ?? opener.current)?.focus();
    };
    if (prefersReducedMotion()) finish();
    else {
      dialog.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(4px)" }], { duration: QUICK, easing: SETTLE, fill: "forwards" })
        .finished.then(finish, finish);
    }
  }, [onClosed, returnFocus]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The page behind a modal leaves the accessibility tree too, so only the dialog's controls are found.
    behind.current = Array.from(document.querySelectorAll<HTMLElement>(".app > header, .app > main, .solo > main"));
    behind.current.forEach((el) => el.setAttribute("aria-hidden", "true"));
    dialog.showModal();
    (focusables(dialog).find((el) => !el.classList.contains("dialog-close")) ?? dialog).focus();
    return reveal;
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <dialog
      ref={ref}
      role={props.role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      className={`dialog ${props.className ?? ""}`}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onKeyDown={onKeyDown}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{props.title}</h2>
        <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={close}><X aria-hidden="true" size={18} /></button>
      </header>
      {props.children(close)}
    </dialog>,
    document.body,
  );
}
