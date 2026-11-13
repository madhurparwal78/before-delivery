import { useLayoutEffect, useRef, useState } from "react";
import type { Agency, Booking, SessionUser } from "../../shared/api";
import { Detail } from "../components/Detail";
import { EmptyRow, LoadingRows, NotAvailable } from "../components/ListParts";
import { Row } from "../components/Row";
import { NewRequestDialog } from "../dialogs/NewRequestDialog";
import { ApiFailure } from "../lib/api";
import { usePolled } from "../lib/refresh";
import { consumeSignInFocus } from "../lib/signin";
import { fetchBookings, useSelected, withBooking } from "../lib/store";
import { useCompact } from "../lib/viewport";

/** The requester's home: the organisation's bookings from today through the next 13 days, and the selected booking. */
export function RequesterHome({ user, agency }: { user: SessionUser; agency: Agency }) {
  const compact = useCompact();
  const list = usePolled<Booking[]>("requester-list", () => fetchBookings(""));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const newRequest = useRef<HTMLButtonElement>(null);
  const backFocus = useRef(false);
  const signInFocus = useRef(consumeSignInFocus());
  const selected = useSelected(selectedId, list.data?.find((booking) => booking.id === selectedId));

  useLayoutEffect(() => {
    if (!signInFocus.current || list.data === undefined) return;
    signInFocus.current = false;
    (document.querySelector<HTMLElement>("[data-coverage]") ?? newRequest.current)?.focus();
  }, [list.data]);

  useLayoutEffect(() => {
    if (!backFocus.current || showDetail) return;
    const row = document.querySelector<HTMLElement>(`[data-row-id="${selectedId}"]`);
    if (row) {
      backFocus.current = false;
      row.focus();
    }
  });

  const select = (id: string) => {
    setSelectedId(id);
    setShowDetail(true);
    setFocusToken((token) => token + 1);
  };
  const changeBooking = (booking: Booking) => {
    selected.put(booking);
    list.put(withBooking(list.data ?? [], booking));
  };
  const showList = !compact || !showDetail;
  const showDetailPane = !compact || showDetail;
  const unavailable = selectedId !== null && selected.booking === undefined && selected.failure instanceof ApiFailure && selected.failure.status === 404;

  return (
    <main className="screen">
      {showList ? (
        <div className="list-pane">
          <section className="list" aria-label="Bookings">
            <div className="list-controls">
              <button type="button" className="btn btn--primary new-request" ref={newRequest} onClick={() => setDialogOpen(true)}>
                New request
              </button>
              <p className="list-range mono">
                {agency.today} and the next 13 days
              </p>
            </div>
            <div className="rows">
              {list.data === undefined ? (
                <LoadingRows />
              ) : list.data.length === 0 ? (
                <EmptyRow>No bookings yet. Use New request to book an interpreter.</EmptyRow>
              ) : (
                list.data.map((booking) => <Row key={booking.id} booking={booking} selected={booking.id === selectedId} onSelect={select} />)
              )}
            </div>
          </section>
        </div>
      ) : null}
      {showDetailPane ? (
        <div className="detail-pane">
          {selected.booking ? (
            <Detail
              key={selected.booking.id}
              booking={selected.booking}
              user={user}
              focusToken={focusToken}
              onBack={compact ? () => {
                backFocus.current = true;
                setShowDetail(false);
              } : null}
              onBooking={changeBooking}
            />
          ) : unavailable ? (
            <NotAvailable />
          ) : (
            <section className="detail detail--empty" aria-label="No booking selected">
              <EmptyRow>Choose a booking to see who covers it and when.</EmptyRow>
            </section>
          )}
        </div>
      ) : null}
      {dialogOpen ? (
        <NewRequestDialog
          user={user}
          organisations={[]}
          agencyZone={agency.time_zone}
          onCreated={(booking) => {
            setDialogOpen(false);
            list.put(withBooking(list.data ?? [], booking));
            setSelectedId(booking.id);
          }}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </main>
  );
}
