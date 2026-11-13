import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agency, AuditEntry, Contract, InvoiceLine, WeekStatement } from "../../shared/api";
import { ActionButton } from "../components/ActionButton";
import { EmptyRow, LoadingRows } from "../components/ListParts";
import { Field } from "../components/Field";
import { useAction } from "../lib/actions";
import { ApiFailure, apiGet, apiPost } from "../lib/api";
import { PENDING, SUCCESS } from "../lib/copy";
import { isDate, mondayOf } from "../../shared/calendar";
import { formatDollars, wholeNumberOrText } from "../lib/format";
import { usePolled } from "../lib/refresh";
import { consumeSignInFocus } from "../lib/signin";
import { useCompact } from "../lib/viewport";
import { AuditPanel, syncLabel } from "../panels/SidePanels";

/** Whole cents from dollars typed with up to two decimals; anything else is sent as typed so the server names the field. */
function twoDecimals(text: string): number | string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : text;
}

const percentOfBp = (bp: number): string => `${Math.trunc(bp / 100)}${bp % 100 === 0 ? "" : `.${String(bp % 100).padStart(2, "0")}`}%`;

function SyncCell({ line }: { line: InvoiceLine }) {
  const differs = line.billing_amount_cents !== null && line.billing_amount_cents !== line.amount_cents;
  return (
    <>
      {syncLabel(line.sync_status)}
      {differs ? <strong className="differs"> Differs</strong> : null}
    </>
  );
}

function InvoiceTable({ lines, selected, onSelect }: { lines: InvoiceLine[]; selected: string | null; onSelect: (ref: string) => void }) {
  return (
    <table className="lines" aria-label="Invoice lines" role="table">
      <thead role="rowgroup">
        <tr role="row">
          {["Line", "Booking", "Date", "Billable time", "Interpreters", "Amount", "Billing amount", "Sync"].map((heading) => (
            <th key={heading} role="columnheader" scope="col">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {lines.map((line) => (
          <tr
            key={line.line_ref}
            role="row"
            tabIndex={0}
            aria-current={line.line_ref === selected ? "true" : undefined}
            onClick={() => onSelect(line.line_ref)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(line.line_ref);
              }
            }}
          >
            <td role="cell" data-label="Line" className="mono">{line.line_ref}</td>
            <td role="cell" data-label="Booking" className="mono">{line.booking_ref}</td>
            <td role="cell" data-label="Date" className="mono">{line.assignment_date}</td>
            <td role="cell" data-label="Billable time" className="mono">{line.billable_minutes} min</td>
            <td role="cell" data-label="Interpreters" className="mono">{line.interpreter_count}</td>
            <td role="cell" data-label="Amount" className="mono">{formatDollars(line.amount_cents)}</td>
            <td role="cell" data-label="Billing amount" className="mono">{line.billing_amount_cents === null ? "—" : formatDollars(line.billing_amount_cents)}</td>
            <td role="cell" data-label="Sync"><SyncCell line={line} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Breakdown({ line }: { line: InvoiceLine | undefined }) {
  return (
    <section className="panel" aria-label="Line breakdown">
      <h3 className="section-label">Line breakdown</h3>
      {line === undefined ? (
        <p className="empty-note">Choose an invoice line to see how its amount was calculated.</p>
      ) : (
        <dl className="facts mono">
          <div><dt>Line</dt><dd>{line.line_ref} · {line.booking_ref} · {line.kind === "completed" ? "completed" : "late cancellation"}</dd></div>
          <div><dt>Assignment date</dt><dd>{line.assignment_date}</dd></div>
          <div><dt>Rate in force from</dt><dd>{line.rate_effective_from}</dd></div>
          <div><dt>Hourly rate</dt><dd>{formatDollars(line.hourly_rate_cents)}</dd></div>
          <div><dt>Team surcharge</dt><dd>{percentOfBp(line.team_surcharge_bp)}{line.interpreter_count === 2 ? " (applied)" : " (not applied)"}</dd></div>
          <div><dt>Basis</dt><dd>{line.basis_minutes} min</dd></div>
          <div><dt>Billable</dt><dd>{line.billable_minutes} min × {line.interpreter_count} interpreter{line.interpreter_count === 1 ? "" : "s"}</dd></div>
          <div><dt>Time amount</dt><dd>{formatDollars(line.time_amount_cents)}</dd></div>
          <div><dt>Mileage</dt><dd>{line.mileage_miles} mi × {line.mileage_cents_per_mile}¢ = {formatDollars(line.mileage_amount_cents)}</dd></div>
          <div><dt>Line amount</dt><dd>{formatDollars(line.amount_cents)}</dd></div>
          <div><dt>Billing amount</dt><dd>{line.billing_amount_cents === null ? "—" : formatDollars(line.billing_amount_cents)}</dd></div>
          <div><dt>Billing week</dt><dd>{line.billing_week}</dd></div>
        </dl>
      )}
    </section>
  );
}

function WeekTotals({ statement, orgName, onClosed }: { statement: WeekStatement; orgName: string; onClosed: () => void }) {
  const totals =
    statement.billing_total_cents === null
      ? `Relayline ${formatDollars(statement.relayline_total_cents)} · billing not yet confirmed`
      : `Relayline ${formatDollars(statement.relayline_total_cents)} · billing ${formatDollars(statement.billing_total_cents)}`;
  return (
    <section className="panel" aria-label="Week totals">
      <h3 className="section-label">Week totals</h3>
      <p className="totals mono">{totals}</p>
      {!statement.billing_reachable ? <p className="notice">Billing amounts are unavailable right now.</p> : null}
      <p className="small">{statement.status === "closed" ? `Closed ${statement.closed_at?.slice(0, 10) ?? ""}` : "Open"}</p>
      <div className="actions">
        <ActionButton
          label="Close week"
          kind="close_week"
          pending={PENDING.close_week}
          work={() => apiPost<WeekStatement>(`/api/billing/weeks/${statement.org_id}/${statement.week_start}/close`)}
          success={(closed) => SUCCESS.weekClosed(closed.week_start, orgName, closed.relayline_total_cents, closed.billing_total_cents ?? 0)}
          onDone={onClosed}
        />
      </div>
    </section>
  );
}

function RatesPanel({ contract, onAdded }: { contract: Contract | undefined; onAdded: (contract: Contract) => void }) {
  const action = useAction();
  const [values, setValues] = useState({ effective_from: "", hourly: "", surcharge: "", mileage: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((held) => ({ ...held, [key]: event.target.value }));
  if (contract === undefined) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const added = await action.run({
      kind: "add_rate",
      pending: PENDING.add_rate,
      work: () =>
        apiPost<Contract>(`/api/contracts/${contract.id}/rates`, {
          effective_from: values.effective_from,
          hourly_rate_cents: twoDecimals(values.hourly),
          team_surcharge_bp: twoDecimals(values.surcharge),
          mileage_cents_per_mile: wholeNumberOrText(values.mileage),
        }),
      success: () => SUCCESS.rateAdded(values.effective_from),
      onFailure: (failure) => setErrors(failure.body?.fields ?? {}),
    });
    if (added !== undefined) {
      setErrors({});
      setValues({ effective_from: "", hourly: "", surcharge: "", mileage: "" });
      onAdded(added);
    }
  };

  return (
    <section className="panel" aria-label="Contract rates">
      <h3 className="section-label">Contract rates</h3>
      <ul className="rates mono">
        {contract.rates.map((rate) => (
          <li key={rate.effective_from}>
            <span>{rate.effective_from}</span>
            <span>{formatDollars(rate.hourly_rate_cents)}/h</span>
            <span>{percentOfBp(rate.team_surcharge_bp)} team</span>
            <span>{rate.mileage_cents_per_mile}¢/mile</span>
          </li>
        ))}
      </ul>
      <form className="rate-form" aria-label="Add rate" noValidate onSubmit={(event) => void submit(event)}>
        <Field id="rate-from" label="Effective from" error={errors["effective_from"]}>
          {(props) => <input {...props} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="mono" value={values.effective_from} onChange={set("effective_from")} autoComplete="off" />}
        </Field>
        <Field id="rate-hourly" label="Hourly rate (dollars)" error={errors["hourly_rate_cents"]}>
          {(props) => <input {...props} type="text" inputMode="decimal" value={values.hourly} onChange={set("hourly")} autoComplete="off" />}
        </Field>
        <Field id="rate-surcharge" label="Team surcharge (percent)" error={errors["team_surcharge_bp"]}>
          {(props) => <input {...props} type="text" inputMode="decimal" value={values.surcharge} onChange={set("surcharge")} autoComplete="off" />}
        </Field>
        <Field id="rate-mileage" label="Mileage rate (cents per mile)" error={errors["mileage_cents_per_mile"]}>
          {(props) => <input {...props} type="text" inputMode="numeric" value={values.mileage} onChange={set("mileage")} autoComplete="off" />}
        </Field>
        <button type="submit" className="btn btn--primary" disabled={action.pending}>
          {action.pending ? PENDING.add_rate : "Add rate"}
        </button>
      </form>
    </section>
  );
}

/** The billing manager's home: a client's week of invoice lines beside breakdown, totals and contract rates. */
export function BillingHome({ agency }: { agency: Agency }) {
  const compact = useCompact();
  const contracts = usePolled<Contract[]>("contracts", async () => (await apiGet<{ contracts: Contract[] }>("/api/contracts")).contracts);
  const [client, setClient] = useState("");
  const [weekText, setWeekText] = useState(mondayOf(agency.today));
  const [shown, setShown] = useState<{ org: string; week: string } | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const clientSelect = useRef<HTMLSelectElement>(null);
  const signInFocus = useRef(consumeSignInFocus());

  useEffect(() => {
    const first = contracts.data?.[0];
    if (first !== undefined && client === "") {
      setClient(first.org_id);
      setShown({ org: first.org_id, week: weekText });
    }
  }, [contracts.data, client, weekText]);

  useLayoutEffect(() => {
    if (signInFocus.current && contracts.data !== undefined) {
      signInFocus.current = false;
      clientSelect.current?.focus();
    }
  }, [contracts.data]);

  const statement = usePolled<WeekStatement>(shown === null ? null : `week:${shown.org}:${shown.week}`, () =>
    apiGet<WeekStatement>(`/api/billing/weeks/${shown?.org}/${shown?.week}`),
  );
  const current = statement.data !== undefined && shown !== null && statement.data.org_id === shown.org && statement.data.week_start === shown.week ? statement.data : undefined;
  const contract = contracts.data?.find((candidate) => candidate.org_id === shown?.org);
  const line = current?.lines.find((candidate) => candidate.line_ref === selectedLine);
  const audit = usePolled<AuditEntry[]>(line ? `audit:${line.booking_id}` : null, async () => (await apiGet<{ entries: AuditEntry[] }>(`/api/bookings/${line?.booking_id}/audit`)).entries);
  const weekError = statement.failure instanceof ApiFailure ? statement.failure.body?.fields?.["week_start"] : undefined;

  const showWeek = () => {
    if (client === "") return;
    setShown({ org: client, week: weekText });
    setSelectedLine(null);
  };
  const select = (ref: string) => {
    setSelectedLine(ref);
    setShowDetail(true);
  };

  const showList = !compact || !showDetail;
  const showDetailPane = !compact || showDetail;
  return (
    <main className="screen">
      {showList ? (
        <div className="list-pane">
          <section className="list" aria-label="Weekly statement">
            <div className="list-controls list-controls--form">
              <Field id="client" label="Client">
                {(props) => (
                  <select {...props} ref={clientSelect} value={client} onChange={(event) => setClient(event.target.value)}>
                    {contracts.data?.map((item) => (
                      <option key={item.org_id} value={item.org_id}>
                        {item.org_name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field id="week-start" label="Week starting" error={weekError}>
                {(props) => <input {...props} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" className="mono" value={weekText} onChange={(event) => setWeekText(event.target.value)} autoComplete="off" />}
              </Field>
              <button type="button" className="btn btn--primary" disabled={!isDate(weekText) && weekText !== ""} onClick={showWeek}>
                Show week
              </button>
            </div>
            <div className="rows rows--table">
              {current === undefined ? (
                weekError ? <EmptyRow>Choose a Monday that is not in the future.</EmptyRow> : <LoadingRows />
              ) : current.lines.length === 0 ? (
                <EmptyRow>No invoice lines in this week.</EmptyRow>
              ) : (
                <InvoiceTable lines={current.lines} selected={selectedLine} onSelect={select} />
              )}
            </div>
            {compact ? (
              <button type="button" className="btn totals-link" onClick={() => setShowDetail(true)}>
                Totals and contract rates
              </button>
            ) : null}
          </section>
        </div>
      ) : null}
      {showDetailPane ? (
        <div className="detail-pane">
          <section className="detail" aria-label="Statement detail">
            {compact ? (
              <button type="button" className="btn back" onClick={() => setShowDetail(false)}>
                Back to list
              </button>
            ) : null}
            <header className="detail-head">
              <h2 tabIndex={-1} data-detail-heading>
                {current ? `${current.org_name} · week of ${current.week_start}` : "Weekly statement"}
              </h2>
            </header>
            <Breakdown line={line} />
            {current ? <WeekTotals statement={current} orgName={current.org_name} onClosed={() => void statement.refetch()} /> : null}
            <RatesPanel contract={contract} onAdded={() => void contracts.refetch()} />
            {line ? <AuditPanel entries={audit.data} /> : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
