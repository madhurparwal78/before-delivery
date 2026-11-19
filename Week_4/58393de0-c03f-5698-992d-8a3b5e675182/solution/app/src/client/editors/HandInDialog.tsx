import { useState } from "react";
import { Dialog } from "../ui/Dialog";

interface HandInDialogProps {
  open: boolean;
  projectName: string;
  /** Resolves true when the project is handed in. */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}

export function HandInDialog({ open, projectName, onConfirm, onClose, returnFocus }: HandInDialogProps) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await onConfirm();
    setBusy(false);
    onClose();
  };
  return (
    <Dialog open={open} title={`Hand in ${projectName}?`} role="alertdialog" onClose={onClose} returnFocus={returnFocus}>
      <p>Your instructor sees the version that is saved now. After you hand it in, this project can no longer be changed.</p>
      <div className="dialog-actions">
        <button type="button" className="pill" disabled={busy} onClick={() => void submit()}>Hand in now</button>
        <button type="button" className="pill pill--outline" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
