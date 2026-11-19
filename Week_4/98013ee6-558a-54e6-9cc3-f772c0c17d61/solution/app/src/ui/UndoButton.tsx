import { useState } from "react";
import { api, ApiFailure, GENERIC_ERROR } from "../lib/api";
import { dismissToast, notify, showAlert } from "../lib/feedback";
import type { OperationView } from "../../shared/types";

/** Undo is decided by the server: the toast leaves when it says the window has closed. */
export function UndoButton({ toastId, operationId }: { toastId: number; operationId: number }) {
  const [busy, setBusy] = useState(false);
  const undo = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post<OperationView>(`/api/operations/${operationId}/undo`);
      dismissToast(toastId);
      notify("Undone");
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : "";
      if (code === "undo_expired" || code === "already_undone") {
        dismissToast(toastId);
        showAlert("Too late to undo.");
      } else if (code === "undo_conflict") {
        showAlert("This can't be undone because some pins have changed.");
      } else showAlert(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="toast-undo" disabled={busy} aria-busy={busy || undefined} onClick={() => void undo()}>
      {busy ? "Undoing" : "Undo"}
    </button>
  );
}
