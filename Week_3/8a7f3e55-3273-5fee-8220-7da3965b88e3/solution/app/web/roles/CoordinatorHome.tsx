import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agency, Booking, Contract, SessionUser } from "../../shared/api";
import { Detail } from "../components/Detail";
import { EmptyRow, LoadingRows, NotAvailable } from "../components/ListParts";
import { Row } from "../components/Row";
import { NewRequestDialog } from "../dialogs/NewRequestDialog";
import { ApiFailure, apiGet } from "../lib/api";
import { addDays, isDate } from "../../shared/calendar";
import { dateOf } from "../lib/format";
import type { Cause, Place } from "../lib/router";
import { usePolled } from "../lib/refresh";
import { consumeSignInFocus } from "../lib/signin";
import { fetchBookings, useSelected, withBooking } from "../lib/store";
import { useCompact } from "../lib/viewport";

interface BoardProps {
  user: SessionUser;
  agency: Agency;
  place: Place;
  cause: Cause;
  go: (to: string, mode: "push" | "replace") => void;
}

const boardUrl = (date: string, booking?: string): string => `/?date=${date}${booking === undefined ? "" : `&booking=${booking}`}`;

/** The coordinator's coverage board: one agency-local day of bookings, with day and selection kept in the address. */
export function CoordinatorHome({ user, agency, place, cause, go }: BoardProps) {
  const compact = useCompact();
  const params = new URLSearchParams(place.search);
  const dateParam = params.get("date");
  const bookingParam = params.get("booking");
  const date = dateParam !== null && isDate(dateParam) ? dateParam : agency.today;
  const selectedId = bookingParam !== null && /^\d{1,9}$/.test(bookingParam) ? bookingParam : null;

  const list = usePolled<{ date: string; bookings: Booking[] }>(`day:${date}`, async () => ({ date, bookings: await fetchBookings(`?from=${date}&to=${date}`) }));
  const day = list.data !== undefined && list.data.date === date ? list.data.bookings : undefined;
  const fromList = day?.find((booking) => booking.id === selectedId);
  const selected = useSelected(selectedId, fromList);

  const [showDetail, setShowDetail] = useState(selectedId !== null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [dateText, setDateText] = useState(date);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const dateInput = useRef<HTMLInputElement>(null);
  const newRequest = useRef<HTMLButtonElement>(null);
  const popFocus = useRef(false);
  const backFocus = useRef(false);
  const signInFocus = useRef(consumeSignInFocus());

  useEffect(() => {
    apiGet<{ contracts: Contract[] }>("/api/contracts").then((answer) => setContracts(answer.contracts), () => undefined);
  }, []);

  // A missing or malformed date becomes the server's today; both corrections rewrite the entry in place.
  useEffect(() => {
    if (dateParam === null || !isDate(dateParam)) go(boardUrl(agency.today), "replace");
  }, [dateParam, agency.today, go]);

  // A booking that is unknown, not visible or not on this day is dropped once the day has loaded.
  useEffect(() => {
    if (selectedId === null || day === undefined || dateParam === null || !isDate(dateParam)) return;
    if (!day.some((booking) => booking.id === selectedId)) go(boardUrl(date), "replace");
  }, [selectedId, day, date, dateParam, go]);

  useEffect(() => setDateText(date), [date]);

  useLayoutEffect(() => {
    if (cause !== "pop") return;
    popFocus.current = true;
    setShowDetail(selectedId !== null);
  }, [cause, place.search, selectedId]);

  // After Back or Forward focus goes to the selected row (the heading in the compact layout), else to Board date.
  useLayoutEffect(() => {
    if (!popFocus.current) return;
    if (selectedId === null) {
      popFocus.current = false;
      dateInput.current?.focus();
    } else if (compact) {
      if (selected.booking) {
        popFocus.current = false;
        document.querySelector<HTMLElement>("[data-detail-heading]")?.focus();
      }
    } else {
      const row = document.querySelector<HTMLElement>(`[data-row-id="${selectedId}"]`);
      if (row) {
        popFocus.current = false;
        row.focus();
      }
    }
  });

  useLayoutEffect(() => {
    if (!backFocus.current || showDetail) return;
    const row = document.querySelector<HTMLElement>(`[data-row-id="${selectedId}"]`);
    if (row) {
      backFocus.current = false;
      row.focus();
    }
  });

  useLayoutEffect(() => {
    if (!signInFocus.current || day === undefined) return;
    signInFocus.current = false;
    (document.querySelector<HTMLElement>("[data-coverage]") ?? newRequest.current)?.focus();
  }, [day]);

  const goBackToList = () => {
    backFocus.current = true;
    setShowDetail(false);
  };
  const select = (id: string) => {
    go(boardUrl(date, id), "replace");
    setShowDetail(true);
    setFocusToken((token) => token + 1);
  };
  const changeBooking = (booking: Booking) => {
    selected.put(booking);
    list.put({ date, bookings: withBooking(day ?? [], booking) });
  };
  const created = (booking: Booking) => {
    setDialogOpen(false);
    const bookingDate = dateOf(booking.start);
    if (bookingDate === date) {
      list.put({ date, bookings: withBooking(day ?? [], booking) });
      go(boardUrl(date, booking.id), "replace");
    } else {
      go(boardUrl(bookingDate, booking.id), "push");
    }
  };
  const commitDate = () => {
    if (isDate(dateText) && dateText !== date) go(boardUrl(dateText), "push");
  };

  const showList = !compact || !showDetail;
  const showDetailPane = !compact || showDetail;
  const unavailable = selectedId !== null && selected.booking === undefined && selected.failure instanceof ApiFailure && selected.failure.status === 404;

  return (
    <main className="screen">
      {showList ? (
        <div className="list-pane">
          <section className="list" aria-label="Coverage board">
            <div className="list-controls list-controls--board">
              <button type="button" className="btn btn--icon" aria-label="Previous day" onClick={() => go(boardUrl(addDays(date, -1)), "push")}>
                <span aria-hidden="true">‹</span> Previous day
              </button>
              <input
                ref={dateInput}
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                autoComplete="off"
                className="date-input mono"
                aria-label="Board date"
                value={dateText}
                onChange={(event) => setDateText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitDate();
                }}
                onBlur={commitDate}
              />
              <button type="button" className="btn btn--icon" aria-label="Next day" onClick={() => go(boardUrl(addDays(date, 1)), "push")}>
                Next day <span aria-hidden="true">›</span>
              </button>
              <button type="button" className="btn btn--primary new-request" ref={newRequest} onClick={() => setDialogOpen(true)}>
                New request
              </button>
            </div>
            <div className="rows">
              {day === undefined ? <LoadingRows /> : day.length === 0 ? <EmptyRow>No bookings on this day.</EmptyRow> : day.map((booking) => <Row key={booking.id} booking={booking} selected={booking.id === selectedId} onSelect={select} />)}
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
              onBack={compact ? goBackToList : null}
              onBooking={changeBooking}
            />
          ) : unavailable ? (
            <NotAvailable />
          ) : (
            <section className="detail detail--empty" aria-label="No booking selected">
              <EmptyRow>Choose a booking to see its rotation weave and seats.</EmptyRow>
            </section>
          )}
        </div>
      ) : null}
      {dialogOpen ? (
        <NewRequestDialog user={user} organisations={contracts} agencyZone={agency.time_zone} onCreated={created} onClose={() => setDialogOpen(false)} />
      ) : null}
    </main>
  );
}
