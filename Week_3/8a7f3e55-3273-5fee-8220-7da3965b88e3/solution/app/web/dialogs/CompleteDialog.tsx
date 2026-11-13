import { useLayoutEffect, useRef, useState } from "react";
import type { Booking } from "../../shared/api";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { useAction } from "../lib/actions";
import { apiPost } from "../lib/api";
import { PENDING, SUCCESS } from "../lib/copy";
import { wholeNumberOrText } from "../lib/format";

interface CompleteProps {
  booking: Booking;
  onCompleted: (booking: Booking) => void;
  /** The booking is no longer in progress: another completion got there first. */
  onFinal: () => void;
  onClose: () => void;
}

export function CompleteDialog({ booking, onCompleted, onFinal, onClose }: CompleteProps) {
  const action = useAction();
  const [worked, setWorked] = useState(String(booking.duration_minutes));
  const [mileage, setMileage] = useState("0");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusRequest, setFocusRequest] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (focusRequest !== null) document.getElementById(focusRequest)?.focus();
  }, [focusRequest, errors]);

  // One Idempotency-Key per draft: kept while the values are unchanged since the previous press, replaced when they change.
  const draft = useRef({ key: crypto.randomUUID(), sent: null as string | null });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (action.pending) return;
    const body = { worked_minutes: wholeNumberOrText(worked), mileage_miles: wholeNumberOrText(mileage) };
    const serialised = JSON.stringify(body);
    if (draft.current.sent !== null && draft.current.sent !== serialised) draft.current.key = crypto.randomUUID();
    draft.current.sent = serialised;
    const done = await action.run({
      kind: "complete",
      pending: PENDING.complete,
      work: () => apiPost<Booking>(`/api/bookings/${booking.id}/complete`, body, draft.current.key),
      success: (updated) => SUCCESS.completed(updated.ref, updated.charge?.line_ref ?? ""),
      onFailure: (failure) => {
        if (failure.body?.error === "invalid_transition") onFinal();
        const fields = failure.body?.fields ?? {};
        setErrors(fields);
        setFocusRequest(fields["worked_minutes"] ? "cd-worked" : fields["mileage_miles"] ? "cd-mileage" : "cd-submit");
      },
    });
    if (done !== undefined) onCompleted(done);
  };

  return (
    <Modal
      label="Complete assignment"
      onClose={onClose}
      closable={!action.pending}
      initialFocus={(dialog) => dialog.querySelector<HTMLElement>("input")}
      fallbackFocus={() => document.querySelector<HTMLElement>("[data-detail-heading]")}
    >
      <form className="dialog-form" noValidate onSubmit={(event) => void submit(event)}>
        <h2 className="dialog-title">Complete assignment</h2>
        <p className="dialog-note">
          <span className="mono">{booking.ref}</span> · scheduled {booking.duration_minutes} minutes
        </p>
        <Field id="cd-worked" label="Worked minutes" error={errors["worked_minutes"]}>
          {(props) => <input {...props} type="text" inputMode="numeric" value={worked} onChange={(event) => setWorked(event.target.value)} autoComplete="off" />}
        </Field>
        <Field id="cd-mileage" label="Mileage (miles)" error={errors["mileage_miles"]}>
          {(props) => <input {...props} type="text" inputMode="numeric" value={mileage} onChange={(event) => setMileage(event.target.value)} autoComplete="off" />}
        </Field>
        <div className="dialog-actions">
          <button id="cd-submit" type="submit" className="btn btn--primary" disabled={action.pending}>
            {action.pending ? PENDING.complete : "Record completion"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}
