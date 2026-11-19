// Review dialogs: every commit goes through one. Opening focuses Cancel, Tab wraps inside,
// Escape cancels, and closing returns focus to the opener. Phones get a full-width bottom sheet.
// A closed review is not rendered at all, so it can take no focus or taps.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDesk } from "./desk";

interface ReviewProps {
  label: string;
  summary: ReactNode;
  /** Resolves "close" to close (focus returns to the opener) or "stay" to keep the review open. */
  onConfirm: () => Promise<"close" | "stay">;
  onClose: () => void;
  confirmDisabled?: boolean;
  children?: ReactNode;
  /** Where focus goes after a successful confirm instead of the opener. */
  focusAfter?: () => HTMLElement | null;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

export function Review({ label, summary, onConfirm, onClose, confirmDisabled, children, focusAfter }: ReviewProps) {
  const { revoked } = useDesk();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const [busy, setBusy] = useState(false);

  const close = (target?: () => HTMLElement | null) => {
    // Leave the modal state now: React may commit the unmount after the next frame, and an opener behind an open
    // modal dialog cannot take focus (brief: focus returns to the opener after G09 succeeds).
    dialog.current?.close();
    onClose();
    requestAnimationFrame(() => {
      const back = opener.current instanceof HTMLElement && opener.current.isConnected ? opener.current : document.getElementById("desk-main");
      (target?.() ?? back)?.focus();
    });
  };

  useEffect(() => {
    const element = dialog.current!;
    if (!element.open) element.showModal();
    cancel.current?.focus();
  }, []);

  useEffect(() => {
    if (!revoked) return;
    // Closing natively first lets the browser restore focus to the opener; G05 then takes it.
    dialog.current?.close();
    document.getElementById("desk-main")?.focus();
    onClose();
    requestAnimationFrame(() => document.getElementById("desk-main")?.focus());
  }, [revoked, onClose]);

  const trap = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = [...dialog.current!.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : index === items.length - 1 ? 0 : index + 1;
    event.preventDefault();
    items[next]!.focus();
  };

  const commit = async () => {
    setBusy(true);
    const outcome = await onConfirm();
    setBusy(false);
    if (outcome === "close") close(focusAfter);
  };

  return (
    <dialog
      ref={dialog}
      className="review"
      aria-label={label}
      onKeyDown={trap}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2 className="review-title">{label}</h2>
      <div className="review-summary">{summary}</div>
      {children}
      <div className="review-actions">
        <button ref={cancel} type="button" className="button quiet" onClick={() => close()} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button primary" onClick={() => void commit()} disabled={busy || confirmDisabled}>
          Confirm
        </button>
      </div>
    </dialog>
  );
}
