import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { Earnings } from "../../shared/api";
import { euros } from "../../shared/money";
import { addMonths, monthTitle, shortDateTime, todayOf } from "../../shared/time";
import { ApiError, errorMessage } from "../lib/http";
import { api } from "../lib/http";
import { useLive } from "../lib/live";
import { replaceQuery, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { useRequireMember } from "../lib/useRequireSignIn";
import { Alert, EmptyState, PageHeading, Skeleton } from "../ui/Bits";

const COLUMNS = ["Departure", "From", "To", "Passenger", "Seats", "Paid", "Refunded", "Earned", "Status"] as const;

export function EarningsPage(): ReactElement | null {
  const member = useRequireMember();
  const session = useSession();
  const { search } = useLocation();
  const today = todayOf(session.serverNow);
  const current = `${today.year}-${String(today.month).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(search.get("month") ?? "") ? (search.get("month") as string) : current;
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Earnings>("GET", `/api/driver/earnings?month=${month}`));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError) setData(null);
    }
  }, [month]);

  useEffect(() => {
    if (member) void load();
  }, [member, load]);

  useLive({
    onEvent: (event) => {
      if (event.type === "hello" || event.type === "booking" || event.type === "clock") void load();
    },
  });

  if (!member) return null;

  const months: string[] = [];
  for (let back = 12; back >= -3; back -= 1) {
    const at = addMonths({ ...today, day: 1 }, -back);
    months.push(`${at.year}-${String(at.month).padStart(2, "0")}`);
  }
  if (!months.includes(month)) months.push(month);
  months.sort();

  const label = (key: string): string => monthTitle(Number(key.slice(0, 4)), Number(key.slice(5, 7)));

  const download = async (): Promise<void> => {
    const response = await fetch(`/api/driver/earnings.csv?month=${month}`, { credentials: "same-origin" });
    if (!response.ok) {
      setError("We could not export the earnings. Try again.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `longseat-earnings-${month}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="earnings-page">
      <PageHeading>Earnings</PageHeading>
      <div className="earnings-tools">
        <div className="field">
          <label htmlFor="month">Month</label>
          <select id="month" value={month} onChange={(e) => replaceQuery(new URLSearchParams({ month: e.target.value }))}>
            {months.map((key) => (
              <option key={key} value={key}>
                {label(key)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => void download()}>
          Export earnings CSV
        </button>
      </div>
      <Alert>{error}</Alert>
      {data === null && !error ? <Skeleton rows={4} /> : null}
      {data && data.rows.length === 0 ? (
        <EmptyState sentence="No bookings on rides in this month." seed="earnings-empty" />
      ) : null}
      {data && data.rows.length > 0 ? (
        <table aria-label="Earnings" className="data-table">
          <thead>
            <tr>
              {COLUMNS.map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.booking_id} data-id={row.booking_id}>
                <td data-label="Departure">{shortDateTime(new Date(row.departure))}</td>
                <td data-label="From">{row.from}</td>
                <td data-label="To">{row.to}</td>
                <td data-label="Passenger">{row.passenger}</td>
                <td data-label="Seats">{row.seats}</td>
                <td data-label="Paid">{euros(row.paid_cents)}</td>
                <td data-label="Refunded">{euros(row.refunded_cents)}</td>
                <td data-label="Earned">{euros(row.earned_cents)}</td>
                <td data-label="Status">{row.status.replace(/_/g, " ")}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td colSpan={COLUMNS.length}>{`Total earned ${euros(data.total_earned_cents)}`}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
