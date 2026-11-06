// My bookings (`/bookings`): the traveller's PNRs, newest first.
import { useEffect, useState } from "react";
import type { BookingSummary } from "../../shared/api";
import { longDate } from "../../shared/format";
import { Chip, statusOfLabel } from "../components/Chip";
import { EmptyStub } from "../components/EmptyStub";
import { useRibbon } from "../components/Shell";
import { api } from "../lib/api";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";

export function MyBookings() {
  const { account } = useSession();
  const { path } = useLocation();
  const [bookings, setBookings] = useState<BookingSummary[] | null>(null);
  const [problem, setProblem] = useState("");
  useRibbon([]);
  useEffect(() => {
    if (account === null) navigate(`/signin?next=${encodeURIComponent(path)}`, { replace: true });
    if (!account) return;
    api<{ bookings: BookingSummary[] }>("/api/bookings").then(
      (b) => setBookings(b.bookings),
      () => setProblem("Can't reach Pakka right now. Try again in a moment."),
    );
  }, [account, path]);
  return (
    <section className="panel stack" aria-labelledby="mine-title">
      <h1 id="mine-title">My bookings</h1>
      <p className="status-line" role="status">{problem || (bookings === null ? "Loading your bookings" : "")}</p>
      <ul className="plain stack" aria-label="My bookings">
        {(bookings ?? []).map((b) => (
          <li key={b.pnr} className="train-card">
            <div className="panel-title">
              <Link href={`/bookings/${b.pnr}`} className="mono">{`PNR ${b.pnr}`}</Link>
              <span className="availability">{b.state.replace("_", " ").toUpperCase()}</span>
            </div>
            <p>
              <strong>{`${b.train.number} ${b.train.name}`}</strong>
              {` · ${b.from} → ${b.to} · ${b.class} · run of ${longDate(b.run_date)}`}
            </p>
            <p className="row">
              {b.summary.split(", ").map((label, i) => (
                <Chip key={i} status={statusOfLabel(label)} label={label} />
              ))}
            </p>
          </li>
        ))}
      </ul>
      {bookings && bookings.length === 0 ? (
        <div className="empty">
          <EmptyStub />
          <p>No bookings yet. Search a route to book your first berth.</p>
          <Link href="/" className="button primary">Search trains</Link>
        </div>
      ) : null}
    </section>
  );
}
