import { useCallback, useEffect, useState } from "react";
import { NetworkError, api } from "../api";
import { EmptyNote, LoadingRows } from "../components/EmptyNote";
import { Field } from "../components/Field";
import { Status, type StatusMessage, quiet } from "../components/Status";
import { usePolling } from "../poll";
import { centsFromDollars, formatDollars } from "../../shared/money";
import { formatDay, formatLongDate } from "../../shared/time";
import type { Billing as BillingState, QueueItem, RateEntry } from "../types";

const ORGANISATIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "RVH", name: "Riverbend Valley Hospital" },
  { code: "CPSD", name: "Cedar Prairie School District" },
  { code: "LFC", name: "Lakeview Family Clinic" },
];

const STATUS_WORDS: Record<BillingState["status"], string> = {
  none: "Not billable",
  ready: "Ready",
  queued: "Queued",
  posted: "Posted",
};

function BillingQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [posting, setPosting] = useState<string | null>(null);
  const [message, setMessage] = useState<StatusMessage>(quiet);

  const load = useCallback(async () => {
    const result = await api<{ items: QueueItem[] }>("GET", "/api/billing/queue");
    if (result.ok) setItems(result.data.items);
  }, []);
  usePolling(load, [load]);

  const post = async (number: string) => {
    setPosting(number);
    setMessage({ tone: "neutral", text: "Posting…" });
    try {
      const result = await api<{ billing: BillingState }>("POST", `/api/assignments/${number}/invoice`, { json: {} });
      if (result.ok && result.data.billing.status === "posted") {
        setMessage({ tone: "success", text: `Posted to Kill Bill as invoice ${result.data.billing.invoice_id}.` });
      } else if (result.ok) {
        setMessage({ tone: "error", text: "Queued. Kill Bill is unreachable, and this will post automatically when it returns." });
      } else {
        setMessage({ tone: "error", text: "This item is not ready to invoice." });
      }
      await load();
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Try again." });
    }
    setPosting(null);
  };

  return (
    <section className="panel" aria-labelledby="queue-heading">
      <div className="list-head">
        <h2 id="queue-heading">Billing queue</h2>
        <p className="muted">Verified work and late cancellations, at the rate in force on each appointment date.</p>
      </div>
      <Status name="Billing status" message={message} />
      <table className="table queue-table" aria-label="Billing queue" role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col">Number</th>
            <th role="columnheader" scope="col">Organisation</th>
            <th role="columnheader" scope="col">Kind</th>
            <th role="columnheader" scope="col">Date</th>
            <th role="columnheader" scope="col" className="cell-money">Total</th>
            <th role="columnheader" scope="col">Status</th>
            <th role="columnheader" scope="col">Invoice id</th>
            <th role="columnheader" scope="col"><span className="visually-hidden">Action</span></th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {(items ?? []).map((item) => (
            <tr role="row" key={item.number}>
              <td role="cell" data-label="Number" className="num">{item.number}</td>
              <td role="cell" data-label="Organisation">{ORGANISATIONS.find((o) => o.code === item.org_code)?.name ?? item.org_code}</td>
              <td role="cell" data-label="Kind">{item.kind === "service" ? "Service" : "Late cancellation"}</td>
              <td role="cell" data-label="Date" className="num">{formatDay(item.start_at)}</td>
              <td role="cell" data-label="Total" className="num cell-money">{formatDollars(item.total_cents)}</td>
              <td role="cell" data-label="Status">
                <span className={`status-word billing-${item.billing.status}`}>{STATUS_WORDS[item.billing.status]}</span>
              </td>
              <td role="cell" data-label="Invoice id" className="num invoice-id">{item.billing.invoice_id ?? "—"}</td>
              <td role="cell" data-label="Action">
                {item.billing.status === "ready" ? (
                  <button
                    type="button"
                    className="button button-primary"
                    aria-label={`Post invoice for ${item.number}`}
                    disabled={posting === item.number}
                    onClick={() => void post(item.number)}
                  >
                    Post invoice
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items === null ? <LoadingRows rows={2} /> : null}
      {items?.length === 0 ? <EmptyNote>Nothing to invoice yet. Verified assignments and late cancellations appear here.</EmptyNote> : null}
    </section>
  );
}

function RateCards() {
  const [org, setOrg] = useState("RVH");
  const [entries, setEntries] = useState<RateEntry[] | null>(null);
  const [line, setLine] = useState("asl");
  const [effective, setEffective] = useState("");
  const [hourly, setHourly] = useState("");
  const [mileage, setMileage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>(quiet);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await api<{ entries: RateEntry[] }>("GET", `/api/rate-cards?org=${org}`);
    if (result.ok) setEntries(result.data.entries);
  }, [org]);
  useEffect(() => {
    setEntries(null);
    void load();
  }, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setMessage({ tone: "neutral", text: "Saving…" });
    const miles = mileage.trim();
    try {
      const result = await api<RateEntry>("POST", "/api/rate-cards", {
        json: {
          org,
          service_line: line,
          effective_from: effective.trim(),
          hourly_rate_cents: centsFromDollars(hourly),
          mileage_cents_per_mile: /^\d{1,7}$/.test(miles) ? Number.parseInt(miles, 10) : null,
        },
      });
      if (result.ok) {
        setMessage({ tone: "success", text: `Rate from ${formatLongDate(result.data.effective_from)} saved.` });
        setEffective("");
        setHourly("");
        setMileage("");
        await load();
      } else if (result.error.code === "duplicate_rate") {
        setMessage({ tone: "error", text: "A rate already starts on that date." });
      } else if (result.error.code === "validation") {
        setErrors(result.error.fields);
        setMessage({ tone: "error", text: `Check the highlighted fields. ${Object.values(result.error.fields).join(" ")}` });
      } else {
        setMessage({ tone: "error", text: result.error.message });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage({ tone: "error", text: "Couldn't reach Teamseat. Try again." });
    }
    setBusy(false);
  };

  return (
    <section className="panel" aria-labelledby="rates-heading">
      <div className="list-head">
        <h2 id="rates-heading">Rate cards</h2>
        <div className="field field-inline">
          <label htmlFor="rate-org">Organisation</label>
          <select id="rate-org" value={org} onChange={(event) => setOrg(event.target.value)}>
            {ORGANISATIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name} ({o.code})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="rates-layout">
        <table className="table rate-table" aria-label="Rate card" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">Service line</th>
              <th role="columnheader" scope="col">Effective from</th>
              <th role="columnheader" scope="col" className="cell-money">Hourly rate</th>
              <th role="columnheader" scope="col" className="cell-money">Mileage</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {(entries ?? []).map((entry) => (
              <tr role="row" key={`${entry.service_line}-${entry.effective_from}`}>
                <td role="cell" data-label="Service line">{entry.service_line === "asl" ? "ASL" : "Spoken"}</td>
                <td role="cell" data-label="Effective from" className="num">{formatLongDate(entry.effective_from)}</td>
                <td role="cell" data-label="Hourly rate" className="num cell-money">{formatDollars(entry.hourly_rate_cents)} /h</td>
                <td role="cell" data-label="Mileage" className="num cell-money">{entry.mileage_cents_per_mile} ¢/mi</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className="form rate-form" aria-label="Add rate" noValidate onSubmit={(event) => void add(event)}>
          <h3>Add a dated rate</h3>
          <Field label="Service line" error={errors.service_line}>
            {(props) => (
              <select {...props} value={line} onChange={(event) => setLine(event.target.value)}>
                <option value="asl">ASL</option>
                <option value="spoken">Spoken</option>
              </select>
            )}
          </Field>
          <Field label="Effective from" hint="YYYY-MM-DD, after today" error={errors.effective_from}>
            {(props) => (
              <input {...props} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={effective} onChange={(event) => setEffective(event.target.value)} />
            )}
          </Field>
          <Field label="Hourly rate (dollars)" hint="For example 85.75" error={errors.hourly_rate_cents}>
            {(props) => <input {...props} type="text" inputMode="decimal" value={hourly} onChange={(event) => setHourly(event.target.value)} />}
          </Field>
          <Field label="Mileage (cents per mile)" hint="Whole cents, for example 70" error={errors.mileage_cents_per_mile}>
            {(props) => <input {...props} type="text" inputMode="numeric" value={mileage} onChange={(event) => setMileage(event.target.value)} />}
          </Field>
          <button type="submit" className="button button-primary" disabled={busy}>
            Add rate
          </button>
          <Status name="Rate status" message={message} />
        </form>
      </div>
      {entries === null ? <LoadingRows rows={2} /> : null}
    </section>
  );
}

export function Billing() {
  return (
    <div className="stack">
      <BillingQueue />
      <RateCards />
    </div>
  );
}
