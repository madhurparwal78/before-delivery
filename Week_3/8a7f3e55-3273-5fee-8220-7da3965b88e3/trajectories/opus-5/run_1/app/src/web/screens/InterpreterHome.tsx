import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Booking, InterpreterHolderCard, Seat } from '../../shared/api.js';
import { jsonRequest, noteActionFinished, sendAction, sendRefetch } from '../api.js';
import { FactsList, PrepPanel } from '../components/panels.js';
import { BookingRow } from '../components/Row.js';
import { RotationWeave } from '../components/Weave.js';
import {
  errorCopy,
  NETWORK_FAILURE,
  OPEN_CALL_CLOSED_LINE,
  openCallOpenLine,
  PENDING,
  SUCCESS,
} from '../copy.js';
import { useLayoutRange, usePolledResource } from '../hooks.js';
import { useLive } from '../live.js';
import { ReleaseDialog } from '../dialogs/ReleaseDialog.js';

type ClaimSource = 'row' | 'seats';

function mySeatOf(booking: Booking): Seat | null {
  return (
    booking.seats.find(
      (seat) => seat.holder !== null && (seat.holder as InterpreterHolderCard).is_me,
    ) ?? null
  );
}

function credentialCodes(holder: NonNullable<Seat['holder']>): string {
  return holder.credentials
    .map((credential) => (typeof credential === 'string' ? credential : credential.code))
    .join(' · ');
}

export function InterpreterHome(): ReactNode {
  const live = useLive();
  const range = useLayoutRange();
  const openCalls = usePolledResource<{ bookings: Booking[] }>('/api/open-calls');
  const mine = usePolledResource<{ bookings: Booking[] }>('/api/bookings');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = usePolledResource<Booking>(
    selectedId === null ? null : `/api/bookings/${selectedId}`,
  );
  const [showDetailPane, setShowDetailPane] = useState(false);
  const [withdrawSeat, setWithdrawSeat] = useState<number | null>(null);
  const [claimPending, setClaimPending] = useState<string | null>(null);

  const heading = useRef<HTMLHeadingElement | null>(null);
  const openCallsRegion = useRef<HTMLElement | null>(null);
  const rowClaimButtons = useRef(new Map<string, HTMLButtonElement>());
  const seatsClaimButton = useRef<HTMLButtonElement | null>(null);
  const firstRowButton = useRef<HTMLButtonElement | null>(null);
  const pendingFocus = useRef<(() => void) | null>(null);
  const withdrawOpener = useRef<HTMLElement | null>(null);

  const openCallBookings = openCalls.data?.bookings ?? [];
  const myBookings = mine.data?.bookings ?? [];
  const selected = detail.data;
  const firstRowId = openCallBookings[0]?.id ?? myBookings[0]?.id ?? null;

  useEffect(() => {
    const run = pendingFocus.current;
    if (run === null) return;
    pendingFocus.current = null;
    run();
  });

  useEffect(() => {
    if (detail.missing) setSelectedId(null);
  }, [detail.missing]);

  const selectRow = (id: string): void => {
    setSelectedId(id);
    setShowDetailPane(true);
    pendingFocus.current = () => heading.current?.focus();
  };

  const focusFirstListRow = (): void => {
    pendingFocus.current = () => {
      const node = firstRowButton.current;
      if (node !== null) node.focus();
      else openCallsRegion.current?.focus();
    };
  };

  const focusClaimButton = (bookingId: string, source: ClaimSource): void => {
    pendingFocus.current = () => {
      const node =
        source === 'row'
          ? rowClaimButtons.current.get(bookingId) ?? null
          : seatsClaimButton.current;
      node?.focus();
    };
  };

  const claim = async (booking: Booking, source: ClaimSource): Promise<void> => {
    live.startAction();
    live.announceStatus(PENDING.claim);
    setClaimPending(booking.id);
    const outcome = await sendAction<Booking>(
      jsonRequest('POST', `/api/bookings/${booking.id}/claim`),
    );
    noteActionFinished();
    setClaimPending(null);

    if (outcome.kind === 'ok') {
      const seat = mySeatOf(outcome.data)?.seat ?? 1;
      live.announceStatus(SUCCESS.claim(seat, outcome.data.ref));
      setSelectedId(outcome.data.id);
      setShowDetailPane(true);
      detail.apply(outcome.data);
      void openCalls.reload();
      void mine.reload();
      pendingFocus.current = () => heading.current?.focus();
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      focusClaimButton(booking.id, source);
      return;
    }
    if (outcome.kind !== 'error') return;

    live.announceError(
      errorCopy({ action: 'claim', code: outcome.body.error, status: outcome.body.status }),
    );
    const departedAt = openCallBookings.findIndex((entry) => entry.id === booking.id);
    const refreshed = await sendRefetch<{ bookings: Booking[] }>('/api/open-calls');
    const remaining = refreshed.kind === 'ok' ? refreshed.data.bookings : openCallBookings;
    if (refreshed.kind === 'ok') openCalls.apply(refreshed.data);
    void mine.reload();

    if (remaining.some((entry) => entry.id === booking.id)) {
      focusClaimButton(booking.id, source);
      return;
    }
    const neighbour = remaining[departedAt] ?? remaining[departedAt - 1] ?? null;
    if (selectedId === booking.id) {
      setSelectedId(null);
      setShowDetailPane(false);
    }
    pendingFocus.current = () => {
      const node = neighbour === null ? null : rowClaimButtons.current.get(neighbour.id) ?? null;
      if (node !== null) node.focus();
      else openCallsRegion.current?.focus();
    };
  };

  const afterWithdrawal = async (): Promise<void> => {
    const [calls, held] = await Promise.all([
      sendRefetch<{ bookings: Booking[] }>('/api/open-calls'),
      sendRefetch<{ bookings: Booking[] }>('/api/bookings'),
    ]);
    if (calls.kind === 'ok') openCalls.apply(calls.data);
    if (held.kind === 'ok') mine.apply(held.data);
    const listed =
      (calls.kind === 'ok' && calls.data.bookings.some((entry) => entry.id === selectedId)) ||
      (held.kind === 'ok' && held.data.bookings.some((entry) => entry.id === selectedId));
    setShowDetailPane(false);
    if (!listed) setSelectedId(null);
    else void detail.reload();
    focusFirstListRow();
  };

  const listPane = (
    <div className="pane-list">
      <section aria-label="Open calls" tabIndex={-1} ref={openCallsRegion}>
        <h3 className="label">Open calls</h3>
        <ul className="rows" role="list">
          {openCallBookings.length === 0 ? (
            <li className="empty-row">No open calls right now.</li>
          ) : (
            openCallBookings.map((booking) => (
              <li key={booking.id}>
                <BookingRow
                  booking={booking}
                  selected={booking.id === selectedId}
                  onSelect={() => selectRow(booking.id)}
                  {...(booking.id === firstRowId ? { buttonRef: firstRowButton } : {})}
                />
                <button
                  type="button"
                  disabled={claimPending === booking.id}
                  ref={(node) => {
                    if (node === null) rowClaimButtons.current.delete(booking.id);
                    else rowClaimButtons.current.set(booking.id, node);
                  }}
                  aria-label={
                    claimPending === booking.id ? PENDING.claim : `Claim seat on ${booking.ref}`
                  }
                  onClick={() => void claim(booking, 'row')}
                >
                  {claimPending === booking.id ? PENDING.claim : 'Claim seat'}
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
      <section aria-label="My assignments">
        <h3 className="label">My assignments</h3>
        <ul className="rows" role="list">
          {myBookings.length === 0 ? (
            <li className="empty-row">No assignments yet.</li>
          ) : (
            myBookings.map((booking) => (
              <li key={booking.id}>
                <BookingRow
                  booking={booking}
                  selected={booking.id === selectedId}
                  onSelect={() => selectRow(booking.id)}
                  {...(booking.id === firstRowId ? { buttonRef: firstRowButton } : {})}
                />
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );

  const mySeat = selected === null ? null : mySeatOf(selected);
  const hasVacantSeat = selected?.seats.some((entry) => entry.holder === null) ?? false;

  const detailPane =
    selected === null ? (
      <section className="pane-detail" aria-label="Assignment detail">
        <p className="empty-row">Select a booking to see its detail.</p>
      </section>
    ) : (
      <section className="pane-detail" aria-label="Assignment detail">
        {range === 'compact' ? (
          <button
            type="button"
            onClick={() => {
              setShowDetailPane(false);
              focusFirstListRow();
            }}
          >
            Back to list
          </button>
        ) : null}
        <div className="detail-heading">
          <h2 tabIndex={-1} ref={heading}>
            {`${selected.ref} · ${selected.title}`}
          </h2>
        </div>
        <FactsList booking={selected} showNotes={false} />
        <RotationWeave
          plan={selected.rotation}
          coverage={selected.coverage}
          bookingId={selected.id}
        />
        <section className="panel" aria-label="Seats">
          <h3 className="label">Seats</h3>
          {selected.seats.map((seat) => {
            const holder = seat.holder;
            return (
              <div className="seat-line" key={seat.seat}>
                <span className="mono">{`Seat ${seat.seat}`}</span>
                {holder === null ? (
                  <span>Vacant</span>
                ) : (
                  <article className="interpreter-card" aria-label={holder.name}>
                    <span className="initials" aria-hidden="true">
                      {holder.initials}
                    </span>
                    <span>
                      {holder.name} <span className="mono">{credentialCodes(holder)}</span>
                    </span>
                  </article>
                )}
                {holder !== null && (holder as InterpreterHolderCard).is_me ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      withdrawOpener.current = event.currentTarget;
                      setWithdrawSeat(seat.seat);
                    }}
                  >
                    Withdraw
                  </button>
                ) : null}
              </div>
            );
          })}
          <p>
            {selected.open_call_status === 'open' && selected.open_call_closes_at !== null
              ? openCallOpenLine(selected.open_call_closes_at)
              : selected.open_call_status === 'closed'
                ? OPEN_CALL_CLOSED_LINE
                : null}
          </p>
          {hasVacantSeat && mySeat === null && selected.open_call_status === 'open' ? (
            <button
              type="button"
              ref={seatsClaimButton}
              disabled={claimPending === selected.id}
              aria-label={claimPending === selected.id ? PENDING.claim : 'Claim seat'}
              onClick={() => void claim(selected, 'seats')}
            >
              {claimPending === selected.id ? PENDING.claim : 'Claim seat'}
            </button>
          ) : null}
        </section>
        <PrepPanel
          booking={selected}
          canUpload={false}
          canDownload={mySeat !== null}
          onChanged={() => void detail.reload()}
        />
      </section>
    );

  return (
    <>
      <div className="panes">
        {range === 'compact' ? (
          showDetailPane ? (
            detailPane
          ) : (
            listPane
          )
        ) : (
          <>
            {listPane}
            {detailPane}
          </>
        )}
      </div>
      {withdrawSeat !== null && selected !== null ? (
        <ReleaseDialog
          booking={selected}
          seat={withdrawSeat}
          mode="withdraw"
          holderName=""
          onClose={() => {
            setWithdrawSeat(null);
            const back = withdrawOpener.current;
            if (back !== null && back.isConnected) back.focus();
          }}
          onReleased={() => {
            setWithdrawSeat(null);
            void afterWithdrawal();
          }}
        />
      ) : null}
    </>
  );
}
