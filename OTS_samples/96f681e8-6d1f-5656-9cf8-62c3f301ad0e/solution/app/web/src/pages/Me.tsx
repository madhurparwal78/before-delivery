import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "../announce";
import { call, messageOf } from "../api";
import { serverNow, setServerNow } from "../clock";
import { EmptyState, ErrorBand } from "../components/Feedback";
import { Modal } from "../components/Modal";
import { clubDate, clubTime, euros } from "../format";
import { usePagedList, useFocusKeeper } from "../lists";
import { Link } from "../router";

interface Row {
  id: string;
  kind: "booking" | "match";
  booking_id: string | null;
  status: string;
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  role: "organiser" | "co-player";
  note: string | null;
  my_amount_cents: number;
  my_payment: "due" | "paid" | "void" | "covered";
}

interface Credits {
  balance_cents: number;
}

const statusWords: Record<string, string> = {
  held: "Held",
  paid: "Paid",
  released: "Released",
  open: "Open",
  "checked-in": "Checked in",
  "no-show": "No-show",
  cancelled: "Cancelled",
};
const paymentWords = { due: "Due", paid: "Paid", void: "Void", covered: "Covered" } as const;
const refreshMs = 10_000;

const compare = (a: Row, b: Row) => {
  const byStart = Date.parse(b.start_utc) - Date.parse(a.start_utc);
  return byStart !== 0 ? byStart : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};
const rowId = (row: Row) => row.id;

export function Me() {
  const announce = useAnnounce();
  const { rows, hasMore, loaded, error, loadMore, refresh } = usePagedList<Row>({ path: "/api/me/bookings", rowId, compare });
  const [balance, setBalance] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const known = useRef<Map<string, Row> | null>(null);

  useFocusKeeper(table, useMemo(() => rows.map(rowId), [rows]), more);

  const loadBalance = useCallback(async () => {
    try {
      setBalance((await call<Credits>("/api/me/credits")).balance_cents);
    } catch {
      // The next refresh reads the balance again.
    }
  }, []);

  useEffect(() => {
    void loadBalance();
    const timer = window.setInterval(() => void loadBalance(), refreshMs);
    return () => window.clearInterval(timer);
  }, [loadBalance]);

  // A match the player is in becoming full is announced once the list notices it.
  useEffect(() => {
    if (!loaded) return;
    const before = known.current;
    known.current = new Map(rows.map((r) => [r.id, r]));
    if (!before) return;
    for (const row of rows) {
      const old = before.get(row.id);
      if (old && row.kind === "match" && old.status === "open" && old.booking_id === null && row.booking_id !== null) announce("Match is full.");
    }
  }, [rows, loaded, announce]);

  const cancel = async (row: Row) => {
    setCancelling(null);
    setActionError(null);
    setPending((p) => ({ ...p, [row.id]: true }));
    try {
      const out = await call<{ booking: { server_now: string } }>(`/api/bookings/${row.id}/cancel`, { method: "POST", body: {} });
      setServerNow(out.booking.server_now);
      announce("Booking cancelled.");
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setPending((p) => ({ ...p, [row.id]: false }));
      void refresh();
      void loadBalance();
    }
  };

  return (
    <div className="page" data-focus-scope>
      <div className="column">
        <h1 className="page__title">My bookings</h1>
        <section className="card credits-card" aria-label="Credits">
          <p>
            Credit balance: <strong className="credits-card__amount">{balance === null ? "…" : euros(balance)}</strong>
          </p>
        </section>
        {(error || actionError) && <ErrorBand>{actionError ?? error}</ErrorBand>}
        {loaded && rows.length === 0 && <EmptyState>No bookings yet.</EmptyState>}
        {rows.length > 0 && (
          <div className="table-card" tabIndex={0}>
            <table role="table" aria-label="Booking history" className="data-table data-table--stack" ref={table}>
              <thead>
                <tr role="row">
                  <th role="columnheader">Date</th>
                  <th role="columnheader">Time</th>
                  <th role="columnheader">Court</th>
                  <th role="columnheader">Status</th>
                  <th role="columnheader">Your share</th>
                  <th role="columnheader">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const canCancel = row.kind === "booking" && row.role === "organiser" && row.status === "paid" && Date.parse(row.start_utc) > serverNow();
                  return (
                    <tr role="row" key={row.id} data-row-id={row.id}>
                      <td role="cell" data-label="Date">
                        {clubDate(row.start)}
                      </td>
                      <td role="cell" data-label="Time">
                        {clubTime(row.start)}
                      </td>
                      <td role="cell" data-label="Court">
                        {row.court}
                      </td>
                      <td role="cell" data-label="Status">
                        <span className={`status-word status-word--${row.status}`}>{statusWords[row.status] ?? row.status}</span>
                      </td>
                      <td role="cell" data-label="Your share">
                        {euros(row.my_amount_cents)} {paymentWords[row.my_payment]}
                      </td>
                      <td role="cell" className="row-actions">
                        {row.booking_id && row.role === "organiser" && (
                          <Link className="pill pill--outline" to={`/bookings/${row.booking_id}`} data-control="details" aria-label={`Details, Court ${row.court} ${clubDate(row.start)} ${clubTime(row.start)}`}>
                            Details
                          </Link>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            className="pill pill--outline"
                            data-control="cancel"
                            aria-disabled={pending[row.id] ? "true" : undefined}
                            onClick={() => !pending[row.id] && setCancelling(row)}
                          >
                            {pending[row.id] ? "Cancelling..." : "Cancel booking"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="list-more">
            <button type="button" className="pill pill--cobalt" ref={more} data-more onClick={() => void loadMore()}>
              Load more bookings
            </button>
          </div>
        )}
      </div>

      {cancelling && (
        <Modal labelledBy="cancel-title" onClose={() => setCancelling(null)} className="confirm-dialog">
          <div className="confirm-dialog__body">
            <h2 id="cancel-title">Cancel this booking?</h2>
            <p>
              Court {cancelling.court}, {clubDate(cancelling.start)} {clubTime(cancelling.start)}. Credits go to your balance.
            </p>
            <div className="slot-dialog__actions">
              <button type="button" className="pill pill--cobalt" onClick={() => void cancel(cancelling)}>
                Yes, cancel
              </button>
              <button type="button" className="pill pill--outline" onClick={() => setCancelling(null)}>
                Keep booking
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
