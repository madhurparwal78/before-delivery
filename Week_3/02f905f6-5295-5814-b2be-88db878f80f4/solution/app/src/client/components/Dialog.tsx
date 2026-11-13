// Modal dialog: focus to the first field, Tab and Shift+Tab wrap, Escape closes, focus returns to
// the opener. It fades and rises in, and reverses on close.
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { DURATION, tween } from "../motion";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}

function place(dialog: HTMLElement, p: number) {
  dialog.style.opacity = String(p);
  dialog.style.transform = `translateY(${(1 - p) * 12}px)`;
}

export function Dialog({ title, onClose, wide, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const done = useRef(onClose);
  done.current = onClose;
  const closing = useRef(false);

  const close = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    // The page is usable again at once: the dialog stops being modal and fades out without taking input.
    dialog.close();
    dialog.inert = true;
    dialog.style.pointerEvents = "none";
    dialog.show();
    tween(DURATION.panel, (p) => place(dialog, 1 - p), () => done.current());
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const first =
      dialog.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea") ??
      dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const stop = tween(DURATION.panel, (p) => place(dialog, p));
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstItem || !dialog.contains(active))) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (active === lastItem || !dialog.contains(active))) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("keydown", onKey);
    return () => {
      stop();
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("keydown", onKey);
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [close]);

  return (
    <dialog ref={ref} className={`dialog${wide ? " wide" : ""}`} aria-label={title}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>{title}</h2>
        </div>
        {children(close)}
      </div>
    </dialog>
  );
}
