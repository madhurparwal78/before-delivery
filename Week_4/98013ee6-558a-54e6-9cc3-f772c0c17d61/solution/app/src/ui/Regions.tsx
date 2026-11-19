import { X } from "lucide-react";
import { useEffect } from "react";
import { dismissAlert, dropUndoToast, useFeedback } from "../lib/feedback";
import { onLive } from "../lib/live";
import { UndoButton } from "./UndoButton";

/** The three live regions every screen carries: polite announcements, visible notices, and alerts. */
export function Regions() {
  const { announcements, toasts, alerts } = useFeedback();
  useEffect(() => onLive((message) => message.type === "operation_expired" && dropUndoToast(message.id)), []);
  return (
    <>
      <div className="visually-hidden" role="status" aria-label="Announcements" aria-live="polite">
        {announcements.map((item) => (
          <p key={item.id}>{item.text}</p>
        ))}
      </div>
      <div className="notices" role="status" aria-label="Notices">
        {toasts.map((item) => (
          <div key={item.id} className={`toast${item.leaving ? " toast--leaving" : ""}`} data-deadline={item.undo?.deadline}>
            {item.undo ? (
              <p>
                {item.text} · <UndoButton toastId={item.id} operationId={item.undo.operationId} />
              </p>
            ) : (
              <p>{item.text}</p>
            )}
          </div>
        ))}
      </div>
      <div className="alerts">
        {alerts.map((item) => (
          <div key={item.id} role="alert" className="alert-card">
            <p>{item.text}</p>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dismissAlert(item.id)}>
              <X aria-hidden="true" size={20} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
