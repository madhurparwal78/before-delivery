import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from "react";
import { Icon } from "./icons";
import { enter, leave } from "./motion";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const FIELDS = 'input:not([disabled]):not([type="hidden"]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (e) => e.tabIndex >= 0 && !e.closest("[inert]") && e.offsetParent !== null,
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  role?: "dialog" | "alertdialog";
  /** Destructive confirmations open with focus on their Cancel button. */
  destructive?: boolean;
  wide?: boolean;
  children: ReactNode;
}

/**
 * A modal dialog: focus moves in on open (first field, or Cancel when destructive), Tab is trapped, Escape closes
 * and focus returns to the control that opened it. A closing dialog is inert and hidden from the start of its fade.
 */
export function Dialog({ open, onClose, title, role = "dialog", destructive = false, wide = false, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.removeAttribute("data-closing");
      dialog.removeAttribute("inert");
      dialog.removeAttribute("aria-hidden");
      dialog.showModal();
      const target =
        (destructive && dialog.querySelector<HTMLElement>("[data-cancel]")) ||
        dialog.querySelector<HTMLElement>(FIELDS) ||
        focusables(dialog).find((e) => !e.hasAttribute("data-dismiss")) ||
        dialog;
      target.setAttribute("data-initial-focus", "");
      target.addEventListener("blur", () => target.removeAttribute("data-initial-focus"), { once: true });
      target.focus();
      enter(dialog, { x: 0, y: 8 });
    } else if (!open && dialog.open) {
      dialog.close();
      dialog.setAttribute("data-closing", "");
      dialog.setAttribute("inert", "");
      dialog.setAttribute("aria-hidden", "true");
      if (opener.current?.isConnected) opener.current.focus();
      void leave(dialog, { x: 0, y: 8 }).then(() => {
        if (!dialog.open) dialog.removeAttribute("data-closing");
      });
    }
  }, [open, destructive]);

  // A pending action disables its own button, which drops focus to the page; it comes back once the button is usable.
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const lost = lastFocus.current;
    if (dialog.open && document.activeElement === document.body && lost?.isConnected && focusables(dialog).includes(lost)) lost.focus();
  });

  useEffect(() => {
    const dialog = ref.current!;
    const cancel = (event: Event) => event.preventDefault();
    dialog.addEventListener("cancel", cancel);
    return () => dialog.removeEventListener("cancel", cancel);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = ref.current!;
    if (event.target instanceof Node && !dialog.contains(event.target)) return;
    const items = focusables(dialog).filter((e) => e.closest("dialog") === dialog);
    if (!items.length) return event.preventDefault();
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
    event.stopPropagation();
  };

  return (
    <dialog
      ref={ref}
      className={wide ? "dialog dialog-wide" : "dialog"}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        if (event.target instanceof HTMLElement && event.target !== ref.current) lastFocus.current = event.target;
      }}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        {!destructive && (
          <button type="button" className="icon-button" aria-label="Close" data-dismiss onClick={() => closeRef.current()}>
            <Icon name="close" />
          </button>
        )}
      </header>
      {children}
    </dialog>
  );
}
