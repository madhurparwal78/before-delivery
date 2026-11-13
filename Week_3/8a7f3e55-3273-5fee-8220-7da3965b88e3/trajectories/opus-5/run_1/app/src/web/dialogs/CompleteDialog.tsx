import { useRef, useState, type ReactNode } from 'react';
import type { Booking } from '../../shared/api.js';
import { jsonRequest, newIdempotencyKey, noteActionFinished, sendAction } from '../api.js';
import { errorCopy, NETWORK_FAILURE, PENDING, SUCCESS } from '../copy.js';
import { useLive } from '../live.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';

export interface CompleteDialogProps {
  booking: Booking;
  onClose: () => void;
  onCompleted: (booking: Booking) => void;
}

export function CompleteDialog({
  booking,
  onClose,
  onCompleted,
}: CompleteDialogProps): ReactNode {
  const live = useLive();
  const [workedMinutes, setWorkedMinutes] = useState(String(booking.duration_minutes));
  const [mileageMiles, setMileageMiles] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const lastAttempt = useRef<string | null>(null);
  const recordButton = useRef<HTMLButtonElement | null>(null);
  const workedField = useRef<HTMLInputElement | null>(null);

  const submit = async (): Promise<void> => {
    const body = {
      worked_minutes: Number(workedMinutes),
      mileage_miles: Number(mileageMiles),
    };
    const serialized = JSON.stringify(body);
    if (lastAttempt.current !== null && lastAttempt.current !== serialized) {
      idempotencyKey.current = newIdempotencyKey();
    }
    lastAttempt.current = serialized;

    live.startAction();
    live.announceStatus(PENDING.complete);
    setPending(true);
    const outcome = await sendAction<Booking>(
      jsonRequest('POST', `/api/bookings/${booking.id}/complete`, body, idempotencyKey.current),
    );
    noteActionFinished();
    setPending(false);

    if (outcome.kind === 'ok') {
      live.announceStatus(
        SUCCESS.complete(outcome.data.ref, outcome.data.charge?.line_ref ?? ''),
      );
      onCompleted(outcome.data);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      recordButton.current?.focus();
      return;
    }
    if (outcome.kind !== 'error') return;
    live.announceError(
      errorCopy({
        action: 'complete',
        code: outcome.body.error,
        status: outcome.body.status,
        fields: outcome.body.fields,
      }),
    );
    if (outcome.body.error === 'invalid_transition') {
      onClose();
      return;
    }
    setErrors(outcome.body.fields ?? {});
    recordButton.current?.focus();
  };

  return (
    <Dialog title="Complete assignment" onEscape={onClose} focusOnOpen={() => workedField.current}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field id="cp-worked" label="Worked minutes" error={errors['worked_minutes']}>
          <input
            id="cp-worked"
            type="number"
            ref={workedField}
            value={workedMinutes}
            onChange={(event) => setWorkedMinutes(event.target.value)}
          />
        </Field>
        <Field id="cp-mileage" label="Mileage (miles)" error={errors['mileage_miles']}>
          <input
            id="cp-mileage"
            type="number"
            value={mileageMiles}
            onChange={(event) => setMileageMiles(event.target.value)}
          />
        </Field>
        <div className="dialog-buttons">
          <button type="submit" ref={recordButton} disabled={pending}>
            {pending ? PENDING.complete : 'Record completion'}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}
