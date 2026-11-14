import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnounce } from "../announce";
import { type Paged, call, messageOf } from "../api";
import { EmptyState, ErrorBand } from "../components/Feedback";
import { clubTime } from "../format";
import { useFocusKeeper, usePagedList } from "../lists";

interface DeskRow {
  id: string;
  kind: "booking" | "match";
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  status: "paid" | "checked-in" | "no-show";
  organiser_name: string;
  players: number;
}

/** Today's list answers with today's club date, so the heading never reads the browser's or the UTC date. */
interface DeskPage extends Paged<DeskRow> {
  date: string;
}

interface FailedNotice {
  id: number;
  event: string;
  channel: string;
  recipient: string;
}

const statusWords = { paid: "Paid", "checked-in": "Checked in", "no-show": "No-show" } as const;
const kindWords = { booking: "Booking", match: "Match" } as const;
const refreshMs = 10_000;

const compare = (a: DeskRow, b: DeskRow) => {
  const byStart = Date.parse(a.start_utc) - Date.parse(b.start_utc);
  if (byStart !== 0) return byStart;
  if (a.court !== b.court) return a.court - b.court;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const rowId = (row: DeskRow) => row.id;

type Action = "check-in" | "no-show";

export function Desk() {
  const announce = useAnnounce();
  const { rows, hasMore, loaded, error, loadMore, refresh, latestPage } = usePagedList<DeskRow, DeskPage>({
    path: "/api/desk/bookings",
    rowId,
    compare,
  });
  const [pending, setPending] = useState<Record<string, Action>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedNotice[] | null>(null);
  const [noticesTried, setNoticesTried] = useState(false);
  const [edits, setEdits] = useState<Record<string, DeskRow["status"]>>({});
  const table = useRef<HTMLTableElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const known = useRef<Set<string> | null>(null);

  useFocusKeeper(table, useMemo(() => rows.map(rowId), [rows]), more);

  const loadFailed = useCallback(async () => {
    try {
      setFailed((await call<Paged<FailedNotice>>("/api/desk/notices?status=failed&limit=50")).items);
    } catch {
      // The next refresh reads the failed notices again.
    }
    setNoticesTried(true);
  }, []);

  useEffect(() => {
    void loadFailed();
    const timer = window.setInterval(() => void loadFailed(), refreshMs);
    return () => window.clearInterval(timer);
  }, [loadFailed]);

  // At the desk, any of today's matches becoming full is announced when its row arrives.
  useEffect(() => {
    if (!loaded) return;
    const before = known.current;
    known.current = new Set(rows.map(rowId));
    if (!before) return;
    if (rows.some((row) => row.kind === "match" && !before.has(row.id))) announce("Match is full.");
  }, [rows, loaded, announce]);

  const act = async (row: DeskRow, action: Action) => {
    setPending((p) => ({ ...p, [row.id]: action }));
    setActionError(null);
    try {
      const done = await call<DeskRow>(`/api/desk/bookings/${row.id}/${action}`, { method: "POST", body: {} });
      setEdits((e) => ({ ...e, [row.id]: done.status }));
    } catch (e) {
      setActionError(messageOf(e));
    } finally {
      setPending((p) => {
        const { [row.id]: _gone, ...rest } = p;
        return rest;
      });
      void refresh();
    }
  };

  return (
    <div className="page" data-focus-scope>
      <div className="column">
        <h1 className="page__title">Today{latestPage ? `, ${latestPage.date}` : ""}</h1>
        {(error || actionError) && <ErrorBand>{actionError ?? error}</ErrorBand>}
        {!(loaded && noticesTried) && <p className="visually-hidden">Loading…</p>}
        {/* The list and the notices card appear together, so neither pushes the other once its answer is in. */}
        <div hidden={!(loaded && noticesTried)}>
          {loaded && rows.length === 0 && <EmptyState>No bookings today.</EmptyState>}
          {rows.length > 0 && (
            <div className="table-card" tabIndex={0}>
              <table role="table" aria-label="Today's bookings" className="data-table data-table--stack data-table--desk" ref={table}>
                <thead>
                  <tr role="row">
                    <th role="columnheader">Time</th>
                    <th role="columnheader">Court</th>
                    <th role="columnheader">Organiser</th>
                    <th role="columnheader">Kind</th>
                    <th role="columnheader">Status</th>
                    <th role="columnheader">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const busy = pending[row.id];
                    const status = busy ? row.status : (edits[row.id] ?? row.status);
                    const slot = `${row.organiser_name}, Court ${row.court} at ${clubTime(row.start)}`;
                    // Disabled stays focusable (aria-disabled), so a pending or finished row keeps the desk's focus.
                    const off = Boolean(busy) || status !== "paid";
                    return (
                      <tr role="row" key={row.id} data-row-id={row.id}>
                        <td role="cell" data-label="Time">
                          {clubTime(row.start)}
                        </td>
                        <td role="cell" data-label="Court">
                          {row.court}
                        </td>
                        <td role="cell" data-label="Organiser">
                          {row.organiser_name}
                        </td>
                        <td role="cell" data-label="Kind">
                          {kindWords[row.kind]}
                        </td>
                        <td role="cell" data-label="Status">
                          <span className={`status-word status-word--${status}`}>{statusWords[status]}</span>
                        </td>
                        <td role="cell" className="row-actions">
                          <button
                            type="button"
                            className="pill pill--cobalt"
                            data-control="check-in"
                            aria-label={`Check in ${slot}`}
                            aria-disabled={off ? "true" : undefined}
                            onClick={() => !off && void act(row, "check-in")}
                          >
                            {busy === "check-in" ? "Checking in..." : "Check in"}
                          </button>
                          <button
                            type="button"
                            className="pill pill--outline"
                            data-control="no-show"
                            aria-label={`Mark no-show ${slot}`}
                            aria-disabled={off ? "true" : undefined}
                            onClick={() => !off && void act(row, "no-show")}
                          >
                            {busy === "no-show" ? "Marking..." : "Mark no-show"}
                          </button>
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

          <section className="card failed-notices" aria-label="Failed notices">
            <h2>Failed notices</h2>
            {failed && failed.length === 0 && <p className="muted">No failed notices.</p>}
            {failed && failed.length > 0 && (
              <ul>
                {failed.map((n) => (
                  <li key={n.id}>
                    {n.event} {n.channel} to {n.recipient}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
