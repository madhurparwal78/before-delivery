import { useRef, useState, type ReactNode } from 'react';
import type { Booking } from '../../shared/api.js';
import { jsonRequest, noteActionFinished, sendAction } from '../api.js';
import { errorCopy, NETWORK_FAILURE, PENDING, SUCCESS } from '../copy.js';
import { useLive } from '../live.js';
import { Dialog } from '../components/Dialog.js';

export interface ReleaseDialogProps {
  booking: Booking;
  seat: number;
  mode: 'withdraw' | 'release';
  holderName: string;
  onClose: () => void;
  onReleased: (booking: Booking, seat: number) => void;
}

export function ReleaseDialog({
  booking,
  seat,
  mode,
  holderName,
  onClose,
  onReleased,
}: ReleaseDialogProps): ReactNode {
  const live = useLive();
  const [pending, setPending] = useState(false);
  const safeButton = useRef<HTMLButtonElement | null>(null);

  const confirm = async (): Promise<void> => {
    live.startAction();
    live.announceStatus(PENDING.release);
    setPending(true);
    const outcome = await sendAction<Booking>(
      jsonRequest('POST', `/api/bookings/${booking.id}/seats/${seat}/release`),
    );
    noteActionFinished();
    setPending(false);

    if (outcome.kind === 'ok') {
      live.announceStatus(SUCCESS.release(seat, outcome.data.ref));
      onReleased(outcome.data, seat);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    live.announceError(
      errorCopy({ action: 'other', code: outcome.body.error, status: outcome.body.status }),
    );
  };

  const title = mode === 'withdraw' ? 'Withdraw from assignment' : `Release seat ${seat}`;
  const sentence =
    mode === 'withdraw'
      ? `You will stop holding seat ${seat} on ${booking.ref} and lose access to its prep materials.`
      : `${holderName} will stop holding seat ${seat} on ${booking.ref} and lose access to its prep materials.`;

  return (
    <Dialog
      title={title}
      onEscape={pending ? null : onClose}
      focusOnOpen={() => safeButton.current}
    >
      <p>{sentence}</p>
      <div className="dialog-buttons">
        <button type="button" ref={safeButton} onClick={onClose}>
          {mode === 'withdraw' ? 'Keep seat' : 'Keep holder'}
        </button>
        <button type="button" disabled={pending} onClick={() => void confirm()}>
          {pending
            ? PENDING.release
            : mode === 'withdraw'
              ? 'Confirm withdrawal'
              : 'Confirm release'}
        </button>
      </div>
    </Dialog>
  );
}
