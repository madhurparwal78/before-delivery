import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgencySettings, Booking } from '../../shared/api.js';
import { jsonRequest, noteActionFinished, sendAction } from '../api.js';
import { useBoardAddress } from '../board-url.js';
import {
  AuditPanel,
  auditToken,
  BillingPanel,
  FactsList,
  PrepPanel,
} from '../components/panels.js';
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
import { agencyDateOf } from '../format.js';
import { useLayoutRange, usePolledResource } from '../hooks.js';
import { useLive } from '../live.js';
import { Field } from '../components/Field.js';
import { AssignDialog } from '../dialogs/AssignDialog.js';
import { CancelDialog } from '../dialogs/CancelDialog.js';
import { CompleteDialog } from '../dialogs/CompleteDialog.js';
import { NewRequestDialog } from '../dialogs/NewRequestDialog.js';
import { ReleaseDialog } from '../dialogs/ReleaseDialog.js';

type OpenDialog =
  | { kind: 'none' }
  | { kind: 'new-request' }
  | { kind: 'assign'; seat: number }
  | { kind: 'complete' }
  | { kind: 'cancel' }
  | { kind: 'release'; seat: number; holderName: string };

export interface CoordinatorHomeProps {
  agency: AgencySettings;
  organisations: { id: string; name: string }[];
}

export function CoordinatorHome({ agency, organisations }: CoordinatorHomeProps): ReactNode {
  const live = useLive();
  const range = useLayoutRange();
  const board = useBoardAddress(agency.today);
  const { date, bookingId } = board.address;

  const list = usePolledResource<{ bookings: Booking[] }>(
    `/api/bookings?from=${date}&to=${date}`,
  );
  const detail = usePolledResource<Booking>(
    bookingId === null ? null : `/api/bookings/${bookingId}`,
  );
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const [dateField, setDateField] = useState(date);
  const [showDetailPane, setShowDetailPane] = useState(bookingId !== null);

  const heading = useRef<HTMLHeadingElement | null>(null);
  const seatsHeading = useRef<HTMLHeadingElement | null>(null);
  const newRequestButton = useRef<HTMLButtonElement | null>(null);
  const boardDateField = useRef<HTMLInputElement | null>(null);
  const rowNodes = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterRender = useRef<'heading' | 'seats' | 'row' | 'board-date' | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const closeDialog = (): void => {
    setDialog({ kind: 'none' });
    const back = opener.current;
    if (back !== null && back.isConnected) back.focus();
    else focusAfterRender.current = 'heading';
  };

  const bookings = list.data?.bookings ?? [];
  const selected = detail.data;

  useEffect(() => {
    setDateField(date);
  }, [date]);

  useEffect(() => {
    if (bookingId !== null && detail.missing) board.select(null);
  }, [bookingId, detail.missing, board]);

  useEffect(() => {
    if (selected !== null && agencyDateOf(selected.start) !== date) board.select(null);
  }, [selected, date, board]);

  useEffect(() => {
    if (!board.address.cameFromHistory) return;
    board.consumeHistoryFlag();
    setShowDetailPane(bookingId !== null);
    focusAfterRender.current =
      bookingId === null ? 'board-date' : range === 'compact' ? 'heading' : 'row';
  }, [board, bookingId, range]);

  useEffect(() => {
    const target = focusAfterRender.current;
    if (target === null) return;
    if (target === 'heading' && heading.current !== null) {
      focusAfterRender.current = null;
      heading.current.focus();
      return;
    }
    if (target === 'seats' && seatsHeading.current !== null) {
      focusAfterRender.current = null;
      seatsHeading.current.focus();
      return;
    }
    if (target === 'board-date' && boardDateField.current !== null) {
      focusAfterRender.current = null;
      boardDateField.current.focus();
      return;
    }
    if (target === 'row' && bookingId !== null) {
      const node = rowNodes.current.get(bookingId);
      if (node !== undefined) {
        focusAfterRender.current = null;
        node.focus();
      }
    }
  });

  const applyBooking = (booking: Booking): void => {
    detail.apply(booking);
    list.apply((current) =>
      current === null
        ? current
        : {
            bookings: current.bookings.map((entry) =>
              entry.id === booking.id ? booking : entry,
            ),
          },
    );
    void list.reload();
  };

  const selectRow = (id: string): void => {
    board.select(id);
    setShowDetailPane(true);
    focusAfterRender.current = 'heading';
  };

  const runSeatAction = async (
    path: string,
    pendingCopy: string,
    success: (booking: Booking) => string,
    action: 'openCall' | 'other',
  ): Promise<void> => {
    live.startAction();
    live.announceStatus(pendingCopy);
    const outcome = await sendAction<Booking>(jsonRequest('POST', path));
    noteActionFinished();
    if (outcome.kind === 'ok') {
      live.announceStatus(success(outcome.data));
      applyBooking(outcome.data);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    live.announceError(
      errorCopy({ action, code: outcome.body.error, status: outcome.body.status }),
    );
    void detail.reload();
  };

  const listPane = (
    <section className="pane-list" aria-label="Coverage board">
      <div className="list-controls">
        <button type="button" onClick={() => board.goToDay(shiftDay(date, -1))}>
          Previous day
        </button>
        <button type="button" onClick={() => board.goToDay(shiftDay(date, 1))}>
          Next day
        </button>
        <Field id="board-date" label="Board date">
          <input
            id="board-date"
            type="date"
            ref={boardDateField}
            value={dateField}
            onChange={(event) => setDateField(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              board.goToDay(event.currentTarget.value);
            }}
          />
        </Field>
        <button
          type="button"
          ref={newRequestButton}
          onClick={() => setDialog({ kind: 'new-request' })}
        >
          New request
        </button>
      </div>
      <ul className="rows" role="list">
        {bookings.length === 0 ? (
          <li className="empty-row">No bookings for this day.</li>
        ) : (
          bookings.map((booking) => (
            <li key={booking.id}>
              <BookingRow
                booking={booking}
                selected={booking.id === bookingId}
                onSelect={() => selectRow(booking.id)}
                buttonRef={(node) => {
                  if (node === null) rowNodes.current.delete(booking.id);
                  else rowNodes.current.set(booking.id, node);
                }}
              />
            </li>
          ))
        )}
      </ul>
    </section>
  );

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
              focusAfterRender.current = 'row';
            }}
          >
            Back to list
          </button>
        ) : null}
        <div className="detail-heading">
          <h2 tabIndex={-1} ref={heading}>
            {`${selected.ref} · ${selected.title}`}
          </h2>
          {['submitted', 'open', 'partially_covered', 'covered'].includes(selected.status) ? (
            <button
              type="button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setDialog({ kind: 'cancel' });
              }}
            >
              Cancel booking
            </button>
          ) : null}
        </div>
        <FactsList booking={selected} showNotes />
        <RotationWeave
          plan={selected.rotation}
          coverage={selected.coverage}
          bookingId={selected.id}
        />
        <section className="panel" aria-label="Seats">
          <h3 className="label" tabIndex={-1} ref={seatsHeading}>
            Seats
          </h3>
          {selected.seats.map((seat) => (
            <div className="seat-line" key={seat.seat}>
              <span className="mono">{`Seat ${seat.seat}`}</span>
              {seat.holder === null ? (
                <span>Vacant</span>
              ) : (
                <span>
                  <span className="initials">{seat.holder.initials}</span> {seat.holder.name}
                </span>
              )}
              {seat.holder === null &&
              ['submitted', 'open', 'partially_covered'].includes(selected.status) ? (
                <button
                  type="button"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setDialog({ kind: 'assign', seat: seat.seat });
                  }}
                >
                  {`Assign seat ${seat.seat}`}
                </button>
              ) : null}
              {seat.holder !== null &&
              ['partially_covered', 'covered'].includes(selected.status) ? (
                <button
                  type="button"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setDialog({
                      kind: 'release',
                      seat: seat.seat,
                      holderName: seat.holder?.name ?? '',
                    });
                  }}
                >
                  {`Release seat ${seat.seat}`}
                </button>
              ) : null}
            </div>
          ))}
          <p>
            {selected.open_call_status === 'open' && selected.open_call_closes_at !== null
              ? openCallOpenLine(selected.open_call_closes_at)
              : selected.open_call_status === 'closed'
                ? OPEN_CALL_CLOSED_LINE
                : null}
          </p>
          <div className="panel-actions">
            {selected.seat_count === 1 &&
            ['submitted', 'open', 'partially_covered', 'covered'].includes(selected.status) ? (
              <button
                type="button"
                onClick={() =>
                  void runSeatAction(
                    `/api/bookings/${selected.id}/team`,
                    PENDING.makeTeam,
                    (booking) => SUCCESS.makeTeam(booking.ref),
                    'other',
                  )
                }
              >
                Make team booking
              </button>
            ) : null}
            {selected.status === 'submitted' ? (
              <button
                type="button"
                onClick={() =>
                  void runSeatAction(
                    `/api/bookings/${selected.id}/open-call`,
                    PENDING.postOpenCall,
                    (booking) => SUCCESS.postOpenCall(booking.ref),
                    'openCall',
                  )
                }
              >
                Post open call
              </button>
            ) : null}
            {selected.status === 'covered' ? (
              <button
                type="button"
                onClick={() =>
                  void runSeatAction(
                    `/api/bookings/${selected.id}/check-in`,
                    PENDING.checkIn,
                    (booking) => SUCCESS.checkIn(booking.ref),
                    'other',
                  )
                }
              >
                Check in
              </button>
            ) : null}
            {selected.status === 'in_progress' ? (
              <button
                type="button"
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setDialog({ kind: 'complete' });
                }}
              >
                Mark complete
              </button>
            ) : null}
          </div>
        </section>
        <PrepPanel
          booking={selected}
          canUpload
          canDownload={false}
          onChanged={() => void detail.reload()}
        />
        <BillingPanel booking={selected} />
        <AuditPanel bookingId={selected.id} afterAction={auditToken(selected)} />
      </section>
    );

  return (
    <>
      <div className="panes">
        {range === 'compact' ? (showDetailPane ? detailPane : listPane) : (
          <>
            {listPane}
            {detailPane}
          </>
        )}
      </div>

      {dialog.kind === 'new-request' ? (
        <NewRequestDialog
          organisations={organisations}
          agencyToday={agency.today}
          timeZone={agency.time_zone}
          onClose={() => {
            setDialog({ kind: 'none' });
            newRequestButton.current?.focus();
          }}
          onCreated={(booking) => {
            setDialog({ kind: 'none' });
            board.selectOnDay(agencyDateOf(booking.start), booking.id);
            setShowDetailPane(true);
            detail.apply(booking);
            void list.reload();
            newRequestButton.current?.focus();
          }}
        />
      ) : null}

      {dialog.kind === 'assign' && selected !== null ? (
        <AssignDialog
          booking={selected}
          seat={dialog.seat}
          onClose={closeDialog}
          onAssigned={(booking) => {
            setDialog({ kind: 'none' });
            applyBooking(booking);
            focusAfterRender.current = 'seats';
          }}
        />
      ) : null}

      {dialog.kind === 'release' && selected !== null ? (
        <ReleaseDialog
          booking={selected}
          seat={dialog.seat}
          mode="release"
          holderName={dialog.holderName}
          onClose={closeDialog}
          onReleased={(booking) => {
            setDialog({ kind: 'none' });
            applyBooking(booking);
            focusAfterRender.current = 'seats';
          }}
        />
      ) : null}

      {dialog.kind === 'complete' && selected !== null ? (
        <CompleteDialog
          booking={selected}
          onClose={closeDialog}
          onCompleted={(booking) => {
            setDialog({ kind: 'none' });
            applyBooking(booking);
          }}
        />
      ) : null}

      {dialog.kind === 'cancel' && selected !== null ? (
        <CancelDialog
          booking={selected}
          onClose={closeDialog}
          onCancelled={(booking) => {
            setDialog({ kind: 'none' });
            applyBooking(booking);
            focusAfterRender.current = 'heading';
          }}
          onBecameFinal={() => {
            setDialog({ kind: 'none' });
            void detail.reload();
            focusAfterRender.current = 'heading';
          }}
        />
      ) : null}
    </>
  );
}

function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
