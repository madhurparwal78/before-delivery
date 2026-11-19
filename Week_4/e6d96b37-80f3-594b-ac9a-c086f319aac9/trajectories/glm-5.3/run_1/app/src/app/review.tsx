import { useEffect, useRef } from "react";
import { useDesk } from "./desk_context.js";
import { feedback } from "./feedback.js";

interface ReviewDialogProps {
  title: string;
  summary: React.ReactNode;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}

/** Every review dialog: focus starts on Cancel, Tab wraps, Escape cancels, focus returns to the opener. */
export function ReviewDialog({ title, summary, confirmLabel, confirmDisabled, onConfirm, onCancel, extra }: ReviewDialogProps): React.ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Tab" && dialogRef.current) {
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]");
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="review-dialog" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef} onKeyDown={onKeyDown}>
        <h2>{title}</h2>
        <p className="review-summary">{summary}</p>
        {extra}
        <div className="review-actions">
          <button className="btn" onClick={onCancel} ref={cancelRef}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={confirmDisabled} aria-label="Confirm">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }): React.ReactElement {
  return (
    <button className="btn btn-primary" onClick={onConfirm} disabled={disabled} aria-label={label}>
      Confirm
    </button>
  );
}

/** Runs a confirmed command with pending/success/error announcements. */
export function useCommand() {
  const desk = useDesk();
  return async (commandId: string, run: () => Promise<void>): Promise<boolean> => {
    desk.clearError();
    desk.setPending(feedback("F_PENDING"));
    try {
      await run();
      desk.setPending(null);
      return true;
    } catch (err) {
      desk.setPending(null);
      const message = err instanceof Error ? err.message : feedback("F_SERVICE");
      desk.reportError(message);
      return false;
    }
  };
}
