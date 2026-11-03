import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

// The contract of kit/modules/a11y_dialog, re-implemented for React: Tab wraps both ways, Escape closes,
// focus goes to [data-autofocus] or the first control, and returns to the opener on close.

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0 && !e.closest("[inert]"));
}

/** Keep Tab and Shift+Tab cycling inside `root` (dialogs and sheets). */
export function wrapTab(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== "Tab") return;
  const items = focusables(root);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function Dialog({ label, onDismiss, children, className = "" }: { label: string; onDismiss: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const target = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0] ?? dialog;
    target.focus();
    return () => {
      if (dialog.open) dialog.close();
      const now = document.activeElement;
      if ((!now || now === document.body || dialog.contains(now)) && opener?.isConnected) opener.focus();
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (ref.current) wrapTab(event, ref.current);
  };
  return (
    <dialog ref={ref} className={`pl-dialog ${className}`} aria-label={label} onKeyDown={onKeyDown} onCancel={(e) => (e.preventDefault(), onDismiss())} tabIndex={-1}>
      {children}
    </dialog>
  );
}
