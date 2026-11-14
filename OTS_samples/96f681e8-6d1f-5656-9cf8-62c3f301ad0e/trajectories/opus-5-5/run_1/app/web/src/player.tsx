import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { NotFound } from "./main";
import {
  RequestKey,
  announce,
  api,
  clubDate,
  clubDateTime,
  clubTime,
  errorText,
  euros,
  get,
  goSignIn,
  paymentWords,
  serverNowMs,
  statusWords,
  syncServerClock,
  trapKeys,
  useInterval,
} from "./lib";
import { usePagedList } from "./paged";
import { Alert, Empty, PendingButton } from "./ui";

type Share = {
  token: string;
  amount_cents: number;
  status: string;
  court: number;
  start: string;
  minutes: number;
  organiser_name: string;
  kind: string;
  settle_at: string | null;
};

export function SharePage({ token }: { token: string }) {
  const [share, setShare] = useState<Share | null | "missing">(null);
  const [alert, setAlert] = useState("");
  const [pending, setPending] = useState(false);
  const key = useRef(new RequestKey());
  const load = useCallback(async () => {
    const a = await get<Share>(`/api/shares/${encodeURIComponent(token)}`);
    if (a.status === 200) setShare(a.data);
    else if (a.status === 404 || a.status === 403) setShare("missing");
    else if (a.status === 401) goSignIn();
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);
  useInterval(load, 10000);
  if (share === "missing") return <NotFound />;
  if (!share) return <div class="column page"><p class="loading">Loading your share…</p></div>;
  const pay = async () => {
    if (pending) return;
    setAlert("");
    const k = key.current.next({});
    setPending(true);
    const a = await api<Share>("POST", `/api/shares/${encodeURIComponent(token)}/pay`, {}, k);
    key.current.settle(a.status);
    setPending(false);
    if (a.status === 401) return goSignIn();
    if (a.status === 200) {
      setShare(a.data);
      announce("Payment received.");
      return;
    }
    setAlert(errorText(a));
    if (a.error?.code === "SHARE_SETTLED" || a.error?.code === "SHARE_VOID") load();
  };
  return (
    <div class="column page narrow-page">
      <section class="card share-card" aria-labelledby="share-heading">
        <h1 id="share-heading">Your share</h1>
        <p class="share-amount">
          {euros(share.amount_cents)} for Court {share.court}, {clubDate(share.start)} {clubTime(share.start)}
        </p>
        <p class="caption">
          {share.kind === "lesson" ? "Lesson" : "Booking"} organised by {share.organiser_name}, {share.minutes} minutes.
        </p>
        {share.settle_at && (
          <p>Unpaid shares go on the organiser's card at {clubDateTime(share.settle_at)}.</p>
        )}
        <Alert text={alert} />
        {share.status === "due" ? (
          <PendingButton label="Pay my share" pendingLabel="Paying..." pending={pending} onClick={pay} />
        ) : (
          <p class={"status-word big status-" + share.status}>{paymentWords[share.status]}</p>
        )}
        {share.status === "covered" && <p>This share was covered by the organiser.</p>}
      </section>
    </div>
  );
}

type HistoryRow = {
  id: string;
  kind: string;
  booking_id: string | null;
  status: string;
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  role: string;
  note: string | null;
  my_amount_cents: number;
  my_payment: string;
};

const historyOrder = (a: HistoryRow, b: HistoryRow) =>
  a.start_utc !== b.start_utc ? (a.start_utc > b.start_utc ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function ConfirmCancel({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && onNo()}>
      <div
        ref={root}
        class="dialog small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(e) => trapKeys(e, root.current, onNo)}
      >
        <div class="dialog-band">
          <h2 id="confirm-title">Cancel this booking?</h2>
        </div>
        <div class="dialog-body dialog-actions">
          <button type="button" class="pill pill-cobalt" onClick={onYes}>
            Yes, cancel
          </button>
          <button type="button" class="pill pill-outline" onClick={onNo}>
            Keep booking
          </button>
        </div>
      </div>
    </div>
  );
}

export function MyBookingsPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const list = usePagedList<HistoryRow>("/api/me/bookings", historyOrder);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const returnFocus = useRef<HTMLElement | null>(null);
  const loadBalance = useCallback(async () => {
    const a = await get<{ balance_cents: number }>("/api/me/credits");
    if (a.status === 200) setBalance(a.data.balance_cents);
  }, []);
  useEffect(() => {
    list.refresh();
    loadBalance();
  }, []);
  useInterval(loadBalance, 10000);

  const cancel = async (id: string) => {
    setConfirm(null);
    list.setRowPending(id, "cancel");
    setRowErrors((e) => ({ ...e, [id]: "" }));
    const a = await api("POST", `/api/bookings/${id}/cancel`, {});
    list.setRowPending(id, null);
    if (a.status === 401) return goSignIn();
    if (a.status === 200) {
      list.setRow(id, { status: a.data.booking.status });
      announce("Booking cancelled.");
      loadBalance();
      list.refresh();
    } else {
      setRowErrors((e) => ({ ...e, [id]: errorText(a) }));
    }
    requestAnimationFrame(() => returnFocus.current?.isConnected && returnFocus.current.focus());
  };

  const now = serverNowMs();
  return (
    <div class="column page" ref={(el) => {
        list.container.current = el;
      }}>
      <h1>My bookings</h1>
      <section class="card credits" role="region" aria-label="Credits">
        <h2>Credits</h2>
        <p class="balance">Credit balance: {balance === null ? "…" : euros(balance)}</p>
      </section>
      {list.rows === null ? (
        <p class="loading">Loading your bookings…</p>
      ) : list.rows.length === 0 ? (
        <Empty>No bookings yet.</Empty>
      ) : (
        <table class="data-table stacked" aria-label="Booking history" tabIndex={-1}>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Time</th>
              <th scope="col">Court</th>
              <th scope="col">Status</th>
              <th scope="col">Your share</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => {
              const pendingCancel = list.pending[r.id] === "cancel";
              const canCancel =
                r.kind === "booking" && r.role === "organiser" && r.status === "paid" && Date.parse(r.start_utc) > now;
              return (
                <tr data-row={r.id} key={r.id}>
                  <td data-label="Date">{clubDate(r.start)}</td>
                  <td data-label="Time">{clubTime(r.start)}</td>
                  <td data-label="Court">Court {r.court}</td>
                  <td data-label="Status">{statusWords[r.status] ?? r.status}</td>
                  <td data-label="Your share">
                    {euros(r.my_amount_cents)} {paymentWords[r.my_payment] ?? r.my_payment}
                  </td>
                  <td class="row-actions">
                    {rowErrors[r.id] && <Alert text={rowErrors[r.id]} />}
                    {r.role === "organiser" && r.booking_id && (
                      <a href={`/bookings/${r.booking_id}`} data-control="details" class="pill pill-outline">
                        Details
                      </a>
                    )}
                    {(canCancel || pendingCancel) && (
                      <button
                        type="button"
                        class="pill pill-cobalt"
                        data-control="cancel"
                        aria-disabled={pendingCancel ? "true" : undefined}
                        onClick={(e) => {
                          if (pendingCancel) return;
                          returnFocus.current = e.currentTarget as HTMLElement;
                          setConfirm(r.id);
                        }}
                      >
                        {pendingCancel ? "Cancelling..." : "Cancel booking"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {list.next && (
        <button type="button" class="pill pill-outline more" data-control="more" onClick={list.loadMore}>
          Load more bookings
        </button>
      )}
      {confirm && (
        <ConfirmCancel
          onYes={() => cancel(confirm)}
          onNo={() => {
            setConfirm(null);
            requestAnimationFrame(() => returnFocus.current?.focus());
          }}
        />
      )}
    </div>
  );
}

type Booking = {
  id: string;
  kind: string;
  status: string;
  court: number;
  start: string;
  minutes: number;
  note: string;
  total_cents: number;
  organiser: { name: string };
  shares: { position: number; player: { name: string }; amount_cents: number; status: string }[];
  settle_at: string | null;
  server_now: string;
};

export function BookingPage({ id }: { id: string }) {
  const [b, setB] = useState<Booking | null | "missing">(null);
  const load = useCallback(async () => {
    const a = await get<Booking>(`/api/bookings/${encodeURIComponent(id)}`);
    if (a.status === 200) {
      syncServerClock(a.data.server_now);
      setB(a.data);
    } else if (a.status === 404 || a.status === 403) setB("missing");
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  useInterval(load, 10000);
  if (b === "missing") return <NotFound />;
  if (!b) return <div class="column page"><p class="loading">Loading the booking…</p></div>;
  return (
    <div class="column page">
      <h1>
        Court {b.court}, {clubDate(b.start)} {clubTime(b.start)}
      </h1>
      <section class="card booking-card">
        <p>
          {b.minutes} minutes · {euros(b.total_cents)} · <span class="status-word">{statusWords[b.status] ?? b.status}</span>
        </p>
        {b.note && <p class="note">Note: {b.note}</p>}
        {b.kind === "booking" && b.settle_at && (
          <p class="settle-line">Unpaid shares go on the organiser's card at {clubDateTime(b.settle_at)}.</p>
        )}
      </section>
      <table class="data-table" aria-label="Shares">
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {b.shares.map((s) => (
            <tr>
              <td>{s.player.name}</td>
              <td>{euros(s.amount_cents)}</td>
              <td>
                <span class={"share-status share-" + s.status}>{paymentWords[s.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
