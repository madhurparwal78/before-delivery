import { useLayoutEffect, useRef, useState } from "react";
import type { Agency, Booking, SessionUser } from "../../shared/api";
import { ActionButton } from "../components/ActionButton";
import { Detail } from "../components/Detail";
import { EmptyRow, LoadingRows, NotAvailable } from "../components/ListParts";
import { Row } from "../components/Row";
import { ApiFailure, apiGet, apiPost } from "../lib/api";
import { PENDING, SUCCESS } from "../lib/copy";
import { addDays } from "../../shared/calendar";
import { mySeat } from "../lib/holders";
import { usePolled } from "../lib/refresh";
import { consumeSignInFocus } from "../lib/signin";
import { fetchBookings, useSelected, withBooking } from "../lib/store";
import { useCompact } from "../lib/viewport";

/** `GET /api/bookings` answers at most 31 days at a time, so held seats are read in consecutive windows. */
const WINDOW_DAYS = 31;
const WINDOWS = 18;

async function fetchHeldBookings(today: string): Promise<Booking[]> {
  const windows = Array.from({ length: WINDOWS }, (_unused, index) => {
    const from = addDays(today, index * WINDOW_DAYS);
    return fetchBookings(`?from=${from}&to=${addDays(from, WINDOW_DAYS - 1)}`);
  });
  return (await Promise.all(windows)).flat();
}

/** The interpreter's home: Open calls they can claim, My assignments, and the selected booking. */
export function InterpreterHome({ user, agency }: { user: SessionUser; agency: Agency }) {
  const compact = useCompact();
  const openCalls = usePolled<Booking[]>("open-calls", async () => (await apiGet<{ bookings: Booking[] }>("/api/open-calls")).bookings);
  const mine = usePolled<Booking[]>("held", () => fetchHeldBookings(agency.today));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [firstRowFocus, setFirstRowFocus] = useState(0);
  const openRegion = useRef<HTMLElement>(null);
  const backFocus = useRef(false);
  const signInFocus = useRef(consumeSignInFocus());
  const known = [...(openCalls.data ?? []), ...(mine.data ?? [])];
  const selected = useSelected(selectedId, known.find((booking) => booking.id === selectedId));

  const focusFirstRow = () => (document.querySelector<HTMLElement>("[data-coverage]") ?? openRegion.current)?.focus();

  useLayoutEffect(() => {
    if (!signInFocus.current || openCalls.data === undefined || mine.data === undefined) return;
    signInFocus.current = false;
    focusFirstRow();
  }, [openCalls.data, mine.data]);

  useLayoutEffect(() => {
    if (firstRowFocus > 0) focusFirstRow();
  }, [firstRowFocus]);

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
  // A claim moves its row only on the server's answer: the row leaves Open calls, joins My assignments and is selected.
  const claimed = (booking: Booking) => {
    openCalls.put((openCalls.data ?? []).filter((offered) => offered.id !== booking.id));
    mine.put(withBooking(mine.data ?? [], booking));
    selected.put(booking);
    setSelectedId(booking.id);
    setShowDetail(true);
    setFocusToken((token) => token + 1);
  };
  const openRows = useRef<Booking[] | undefined>(undefined);
  openRows.current = openCalls.data;
  const [refusalFocus, setRefusalFocus] = useState<{ index: number } | null>(null);
  // A refused claim fetches both lists again. A booking that is no longer offered leaves the screen to the list pane,
  // and focus goes to the Open calls row that took its place, else the one before it, else the Open calls region.
  const claimRefused = async (booking: Booking, failure: ApiFailure) => {
    if (failure.body === null) return;
    const position = openRows.current?.findIndex((offered) => offered.id === booking.id) ?? -1;
    // A refetch that a newer one superseded answers nothing, so the pair is asked again until both are answered.
    let offered: Booking[] | undefined;
    for (let attempt = 0; attempt < 3 && offered === undefined; attempt += 1) {
      const [openAnswer, mineAnswer] = await Promise.all([openCalls.refetch(), mine.refetch()]);
      if (mineAnswer !== undefined) offered = openAnswer;
    }
    if (offered === undefined || offered.some((candidate) => candidate.id === booking.id)) return;
    setSelectedId(null);
    setShowDetail(false);
    setRefusalFocus({ index: position });
  };
  useLayoutEffect(() => {
    if (refusalFocus === null) return;
    const rows = [...(openRegion.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])];
    (rows[refusalFocus.index] ?? rows[refusalFocus.index - 1] ?? openRegion.current)?.focus();
    setRefusalFocus(null);
  }, [refusalFocus]);
  const afterWithdraw = async () => {
    setShowDetail(false);
    const [offered, held] = await Promise.all([openCalls.refetch(), mine.refetch()]);
    if (offered !== undefined && held !== undefined && ![...offered, ...held].some((booking) => booking.id === selectedId)) setSelectedId(null);
    setFirstRowFocus((count) => count + 1);
  };
  const changeBooking = (booking: Booking) => selected.put(booking);

  const current = selected.booking;
  const showList = !compact || !showDetail;
  const showDetailPane = !compact || showDetail;
  const unavailable = selectedId !== null && current === undefined && selected.failure instanceof ApiFailure && selected.failure.status === 404;

  return (
    <main className="screen">
      {showList ? (
        <div className="list-pane">
          <div className="list list--sections">
            <section aria-label="Open calls" tabIndex={-1} ref={openRegion} className="list-section">
              <h2 className="section-label list-label">Open calls</h2>
              <div className="rows">
                {openCalls.data === undefined ? (
                  <LoadingRows />
                ) : openCalls.data.length === 0 ? (
                  <EmptyRow>No open calls match your credentials right now.</EmptyRow>
                ) : (
                  openCalls.data.map((booking) => (
                    <div key={booking.id} className="open-row">
                      <Row booking={booking} selected={booking.id === selectedId} onSelect={select} />
                      <ActionButton
                        label="Claim seat"
                        ariaLabel={`Claim seat on ${booking.ref}`}
                        kind="claim"
                        pending={PENDING.claim}
                        className="btn--claim"
                        work={() => apiPost<Booking>(`/api/bookings/${booking.id}/claim`)}
                        success={(updated) => SUCCESS.claimed(mySeat(updated) ?? 0, booking.ref)}
                        onDone={claimed}
                        onFailure={(failure) => void claimRefused(booking, failure)}
                      />
                    </div>
                  ))
                )}
              </div>
            </section>
            <section aria-label="My assignments" className="list-section">
              <h2 className="section-label list-label">My assignments</h2>
              <div className="rows">
                {mine.data === undefined ? (
                  <LoadingRows />
                ) : mine.data.length === 0 ? (
                  <EmptyRow>You hold no seats yet. Claim one from Open calls.</EmptyRow>
                ) : (
                  mine.data.map((booking) => <Row key={booking.id} booking={booking} selected={booking.id === selectedId} onSelect={select} />)
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}
      {showDetailPane ? (
        <div className="detail-pane">
          {current ? (
            <Detail
              key={current.id}
              booking={current}
              user={user}
              focusToken={focusToken}
              onBack={compact ? () => {
                backFocus.current = true;
                setShowDetail(false);
              } : null}
              onBooking={changeBooking}
              onWithdrawn={() => void afterWithdraw()}
              claimable={openCalls.data === undefined || openCalls.data.some((offered) => offered.id === current.id)}
              onClaimed={claimed}
              onClaimRefused={(failure) => void claimRefused(current, failure)}
            />
          ) : unavailable ? (
            <NotAvailable />
          ) : (
            <section className="detail detail--empty" aria-label="No booking selected">
              <EmptyRow>Choose an assignment to see your turns and prep materials.</EmptyRow>
            </section>
          )}
        </div>
      ) : null}
    </main>
  );
}
