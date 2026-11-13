import type { ReactNode } from 'react';
import type { Booking, InterpreterHolderCard, Role } from '../../shared/api.js';
import {
  AuditPanel,
  auditToken,
  BillingPanel,
  FactsList,
  InterpretersPanel,
  PrepPanel,
} from '../components/panels.js';
import { RotationWeave } from '../components/Weave.js';
import { NOT_AVAILABLE } from '../copy.js';
import { usePolledResource } from '../hooks.js';

export function BookingDeepLink({
  bookingId,
  role,
}: {
  bookingId: string;
  role: Role;
}): ReactNode {
  const booking = usePolledResource<Booking>(`/api/bookings/${bookingId}`);
  if (booking.missing) return <p className="empty-row">{NOT_AVAILABLE}</p>;
  if (booking.data === null) return <p className="empty-row">Loading…</p>;
  const shown = booking.data;
  const holdsASeat = shown.seats.some(
    (seat) => seat.holder !== null && (seat.holder as InterpreterHolderCard).is_me === true,
  );
  const officeRole = role === 'coordinator' || role === 'billing_manager';

  return (
    <div className="panes">
      <section className="pane-detail" aria-label="Assignment detail">
        <div className="detail-heading">
          <h2 tabIndex={-1}>{`${shown.ref} · ${shown.title}`}</h2>
        </div>
        <FactsList booking={shown} showNotes={shown.requester_notes !== undefined} />
        <RotationWeave plan={shown.rotation} coverage={shown.coverage} bookingId={shown.id} />
        <InterpretersPanel booking={shown} />
        <PrepPanel
          booking={shown}
          canUpload={role === 'requester' || role === 'coordinator'}
          canDownload={role === 'interpreter' && holdsASeat}
          onChanged={() => void booking.reload()}
        />
        {officeRole ? (
          <>
            <BillingPanel booking={shown} />
            <AuditPanel bookingId={shown.id} afterAction={auditToken(shown)} />
          </>
        ) : null}
      </section>
    </div>
  );
}
