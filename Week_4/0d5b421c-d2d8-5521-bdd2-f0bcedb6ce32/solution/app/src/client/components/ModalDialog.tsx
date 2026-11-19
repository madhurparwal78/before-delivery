import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** A modal dialog that keeps Tab inside, closes on Escape unless its request is pending, and never scrolls the page. */
export function ModalDialog({
  labelId,
  pending,
  onClose,
  children,
}: {
  labelId: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const node = useRef<HTMLDialogElement>(null);
  const latest = useRef({ pending, onClose });
  latest.current = { pending, onClose };

  useEffect(() => {
    const dialog = node.current;
    if (dialog === null) return undefined;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    const refuseNativeClose = (event: Event): void => {
      event.preventDefault();
      if (!latest.current.pending) latest.current.onClose();
    };
    dialog.addEventListener("cancel", refuseNativeClose);
    return () => {
      dialog.removeEventListener("cancel", refuseNativeClose);
      dialog.close();
    };
  }, []);

  const trapTab = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== "Tab") return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((stop) => !stop.hasAttribute("disabled"));
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog ref={node} className="dialog" aria-labelledby={labelId} onKeyDown={trapTab}>
      {children}
    </dialog>
  );
}
