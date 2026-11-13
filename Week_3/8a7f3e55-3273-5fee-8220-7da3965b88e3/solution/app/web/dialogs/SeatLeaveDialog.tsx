import type { Booking } from "../../shared/api";
import { Modal } from "../components/Modal";
import { useAction } from "../lib/actions";
import { apiPost } from "../lib/api";
import { PENDING, SUCCESS } from "../lib/copy";

interface SeatLeaveProps {
  booking: Booking;
  seat: number;
  /** The dialog's accessible name. */
  label: string;
  /** The sentence the dialog carries. */
  sentence: string;
  keepLabel: string;
  confirmLabel: string;
  onDone: (booking: Booking) => void;
  onClose: () => void;
  /** Where focus lands when the button that opened the dialog is gone. */
  fallbackFocus: () => HTMLElement | null;
}

/** The in-app confirmation for withdrawing from a seat or releasing one; the safe button is focused first. */
export function SeatLeaveDialog({ booking, seat, label, sentence, keepLabel, confirmLabel, onDone, onClose, fallbackFocus }: SeatLeaveProps) {
  const action = useAction();
  const release = async () => {
    const updated = await action.run({
      kind: "release",
      pending: PENDING.release,
      work: () => apiPost<Booking>(`/api/bookings/${booking.id}/seats/${seat}/release`),
      success: () => SUCCESS.released(seat, booking.ref),
    });
    if (updated !== undefined) onDone(updated);
  };
  return (
    <Modal label={label} onClose={onClose} closable={!action.pending} initialFocus={(dialog) => dialog.querySelector<HTMLElement>("[data-keep]")} fallbackFocus={fallbackFocus}>
      <div className="dialog-form">
        <h2 className="dialog-title">{label}</h2>
        <p>{sentence}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn--primary" data-keep onClick={onClose} disabled={action.pending}>
            {keepLabel}
          </button>
          <button type="button" className="btn" onClick={() => void release()} disabled={action.pending}>
            {action.pending ? PENDING.release : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
