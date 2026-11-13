import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgencySettings, Booking } from '../../shared/api.js';
import { FactsList, InterpretersPanel, PrepPanel } from '../components/panels.js';
import { BookingRow } from '../components/Row.js';
import { RotationWeave } from '../components/Weave.js';
import { money } from '../format.js';
import { useLayoutRange, usePolledResource } from '../hooks.js';
import { CancelDialog } from '../dialogs/CancelDialog.js';
import { NewRequestDialog } from '../dialogs/NewRequestDialog.js';

const CANCELLABLE = ['submitted', 'open', 'partially_covered', 'covered'];

export function RequesterHome({ agency }: { agency: AgencySettings }): ReactNode {
  const range = useLayoutRange();
  const list = usePolledResource<{ bookings: Booking[] }>('/api/bookings');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = usePolledResource<Booking>(
    selectedId === null ? null : `/api/bookings/${selectedId}`,
  );
  const [showDetailPane, setShowDetailPane] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const heading = useRef<HTMLHeadingElement | null>(null);
  const newRequestButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);
  const rowNodes = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<(() => void) | null>(null);

  const bookings = list.data?.bookings ?? [];
  const selected = detail.data;

  useEffect(() => {
    const run = pendingFocus.current;
    if (run === null) return;
    pendingFocus.current = null;
    run();
  });

  useEffect(() => {
    if (detail.missing) setSelectedId(null);
  }, [detail.missing]);

  const applyBooking = (booking: Booking): void => {
    detail.apply(booking);
    void list.reload();
  };

  const listPane = (
    <section className="pane-list" aria-label="Bookings">
      <div className="list-controls">
        <button type="button" ref={newRequestButton} onClick={() => setNewRequestOpen(true)}>
          New request
        </button>
      </div>
      <ul className="rows" role="list">
        {bookings.length === 0 ? (
          <li className="empty-row">No bookings in the next two weeks.</li>
        ) : (
          bookings.map((booking) => (
            <li key={booking.id}>
              <BookingRow
                booking={booking}
                selected={booking.id === selectedId}
                onSelect={() => {
                  setSelectedId(booking.id);
                  setShowDetailPane(true);
                  pendingFocus.current = () => heading.current?.focus();
                }}
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
              pendingFocus.current = () => rowNodes.current.get(selected.id)?.focus();
            }}
          >
            Back to list
          </button>
        ) : null}
        <div className="detail-heading">
          <h2 tabIndex={-1} ref={heading}>
            {`${selected.ref} · ${selected.title}`}
          </h2>
          {CANCELLABLE.includes(selected.status) ? (
            <button type="button" ref={cancelButton} onClick={() => setCancelOpen(true)}>
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
        <InterpretersPanel booking={selected} />
        <PrepPanel
          booking={selected}
          canUpload
          canDownload={false}
          onChanged={() => void detail.reload()}
        />
        {selected.charge === null || selected.charge === undefined ? null : (
          <p className="panel mono">
            {`Charge ${selected.charge.line_ref} · ${money(selected.charge.amount_cents)}`}
          </p>
        )}
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

      {newRequestOpen ? (
        <NewRequestDialog
          organisations={null}
          agencyToday={agency.today}
          timeZone={agency.time_zone}
          onClose={() => {
            setNewRequestOpen(false);
            newRequestButton.current?.focus();
          }}
          onCreated={(booking) => {
            setNewRequestOpen(false);
            setSelectedId(booking.id);
            detail.apply(booking);
            void list.reload();
            newRequestButton.current?.focus();
          }}
        />
      ) : null}

      {cancelOpen && selected !== null ? (
        <CancelDialog
          booking={selected}
          onClose={() => {
            setCancelOpen(false);
            cancelButton.current?.focus();
          }}
          onCancelled={(booking) => {
            setCancelOpen(false);
            applyBooking(booking);
            pendingFocus.current = () => heading.current?.focus();
          }}
          onBecameFinal={() => {
            setCancelOpen(false);
            void detail.reload();
            pendingFocus.current = () => heading.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
