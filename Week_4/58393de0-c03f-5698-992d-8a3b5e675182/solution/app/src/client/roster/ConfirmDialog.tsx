import { useRef } from "react";
import { Dialog } from "../ui/Dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** Does the work and closes the dialog itself; a second press while it runs is ignored. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  /** Where focus goes when the dialog closes; the opener when this returns null. */
  returnFocus?: () => HTMLElement | null;
}

/** A confirmation (`alertdialog`) with one destructive or irreversible action and `Cancel`. */
export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onCancel, returnFocus }: ConfirmDialogProps) {
  const running = useRef(false);
  const submit = async () => {
    if (running.current) return;
    running.current = true;
    try {
      await onConfirm();
    } finally {
      running.current = false;
    }
  };
  return (
    <Dialog open={open} title={title} role="alertdialog" onClose={onCancel} returnFocus={returnFocus}>
      <p>{body}</p>
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={() => void submit()}>{confirmLabel}</button>
        <button type="button" className="pill pill--outline" onClick={onCancel}>Cancel</button>
      </div>
    </Dialog>
  );
}
