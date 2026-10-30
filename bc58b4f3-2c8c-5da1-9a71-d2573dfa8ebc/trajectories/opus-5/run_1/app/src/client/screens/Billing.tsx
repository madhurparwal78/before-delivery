import { useMemo, useState, type ReactNode } from 'react';
import { ORGANISATIONS, nameOf } from '../../shared/catalog';
import { formatDollars } from '../../shared/money';
import { formatCentralFullDay, parseCentralDateKey } from '../../shared/centralTime';
import {
  ApiFailure,
  addRate,
  loadBillingQueue,
  loadRateCard,
  postInvoice,
  type QueueItem,
} from '../lib/api';
import { LiveStatus } from '../components/Shell';
import { dateTimeText } from '../lib/format';
import { usePolling } from '../lib/hooks';

const KIND_LABELS: Record<string, string> = {
  service: 'Service',
  late_cancellation: 'Late cancellation',
};

const BILLING_LABELS: Record<string, string> = {
  ready: 'Ready',
  queued: 'Queued',
  posted: 'Posted',
};

function RateCard(): ReactNode {
  const [org, setOrg] = useState(ORGANISATIONS[0]?.code ?? '');
  const [serviceLine, setServiceLine] = useState('asl');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [hourly, setHourly] = useState('');
  const [mileage, setMileage] = useState('');
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const { data, refresh } = usePolling(() => loadRateCard(org), [org]);
  const entries = useMemo(() => data?.entries ?? [], [data]);

  const dollarsToCents = (value: string): number => {
    const match = /^\s*\$?(\d+)(?:\.(\d{1,2}))?\s*$/.exec(value);
    if (match === null) return Number.NaN;
    const cents = (match[2] ?? '').padEnd(2, '0');
    return Number.parseInt(match[1] as string, 10) * 100 + Number.parseInt(cents === '' ? '0' : cents, 10);
  };

  return (
    <div className="panel">
      <h2>Rate card</h2>
      <div className="field">
        <label htmlFor="rate-org">Organisation</label>
        <select id="rate-org" value={org} onChange={(event) => setOrg(event.target.value)}>
          {ORGANISATIONS.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <table aria-label="Rate card" className="stacked-table">
        <thead>
          <tr>
            <th scope="col">Service line</th>
            <th scope="col">Effective from</th>
            <th scope="col">Hourly rate</th>
            <th scope="col">Mileage</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.service_line}-${entry.effective_from}`}>
              <td data-label="Service line">{entry.service_line === 'asl' ? 'ASL' : 'Spoken'}</td>
              <td data-label="From">
                {formatCentralFullDay(
                  parseCentralDateKey(entry.effective_from) ?? new Date(entry.effective_from),
                )}
              </td>
              <td data-label="Hourly" className="amount">
                {formatDollars(entry.hourly_rate_cents)}
              </td>
              <td data-label="Mileage" className="amount">
                {entry.mileage_cents_per_mile} ¢/mi
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        noValidate
        aria-label="Add rate"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setStatus('Saving…');
          setFields({});
          addRate({
            org,
            service_line: serviceLine,
            effective_from: effectiveFrom,
            hourly_rate_cents: dollarsToCents(hourly),
            mileage_cents_per_mile: Number.parseInt(mileage, 10),
          })
            .then((entry) => {
              const day = parseCentralDateKey(entry.effective_from);
              setStatus(
                `Rate from ${day === null ? entry.effective_from : formatCentralFullDay(day)} saved.`,
              );
              setEffectiveFrom('');
              setHourly('');
              setMileage('');
              refresh();
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure && error.code === 'duplicate_rate') {
                setStatus('A rate already starts on that date.');
                return;
              }
              if (error instanceof ApiFailure && error.code === 'validation') {
                setFields(error.fields);
                setStatus('Check the highlighted fields.');
                return;
              }
              setStatus('That rate could not be saved.');
            })
            .finally(() => setPending(false));
        }}
      >
        <h3>Add rate</h3>
        <div className="field">
          <label htmlFor="rate-line">Service line</label>
          <select
            id="rate-line"
            value={serviceLine}
            onChange={(event) => setServiceLine(event.target.value)}
          >
            <option value="asl">ASL</option>
            <option value="spoken">Spoken</option>
          </select>
          {fields['service_line'] === undefined ? null : (
            <p className="field-error">{fields['service_line']}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rate-from">Effective from</label>
          <input
            id="rate-from"
            type="text"
            placeholder="YYYY-MM-DD"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          {fields['effective_from'] === undefined ? null : (
            <p className="field-error">{fields['effective_from']}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rate-hourly">Hourly rate (dollars)</label>
          <input
            id="rate-hourly"
            type="text"
            inputMode="decimal"
            value={hourly}
            onChange={(event) => setHourly(event.target.value)}
          />
          {fields['hourly_rate_cents'] === undefined ? null : (
            <p className="field-error">{fields['hourly_rate_cents']}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rate-mileage">Mileage (cents per mile)</label>
          <input
            id="rate-mileage"
            type="text"
            inputMode="numeric"
            value={mileage}
            onChange={(event) => setMileage(event.target.value)}
          />
          {fields['mileage_cents_per_mile'] === undefined ? null : (
            <p className="field-error">{fields['mileage_cents_per_mile']}</p>
          )}
        </div>
        <button type="submit" className="primary" disabled={pending}>
          Add rate
        </button>
        <LiveStatus name="Rate status" message={status} />
      </form>
    </div>
  );
}

export function Billing(): ReactNode {
  const [status, setStatus] = useState('');
  const [pendingNumber, setPendingNumber] = useState<string | null>(null);
  const { data, refresh } = usePolling(() => loadBillingQueue(), []);
  const items: QueueItem[] = useMemo(() => data?.items ?? [], [data]);

  const post = (number: string): void => {
    setPendingNumber(number);
    setStatus('Posting…');
    postInvoice(number)
      .then((result) => {
        setStatus(
          result.billing.status === 'posted'
            ? `Posted to Kill Bill as invoice ${result.billing.invoice_id ?? ''}.`
            : 'Queued. Kill Bill is unreachable, and this will post automatically when it returns.',
        );
        refresh();
      })
      .catch((error: unknown) => {
        setStatus(
          error instanceof ApiFailure && error.code === 'not_billable'
            ? 'This item is not ready to invoice.'
            : 'This item could not be posted.',
        );
      })
      .finally(() => setPendingNumber(null));
  };

  return (
    <main className="sheet">
      <h1>Billing</h1>
      <div className="panel">
        <h2>Billing queue</h2>
        <LiveStatus name="Billing status" message={status} />
        <table aria-label="Billing queue" className="stacked-table">
          <caption>{items.length === 0 ? 'Nothing to invoice yet.' : `${items.length} items`}</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Organisation</th>
              <th scope="col">Kind</th>
              <th scope="col">Date (Central)</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Invoice id</th>
              <th scope="col">Post</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.number}>
                <td data-label="Number" className="numeral">
                  {item.number}
                </td>
                <td data-label="Organisation">{nameOf(ORGANISATIONS, item.org_code)}</td>
                <td data-label="Kind">{KIND_LABELS[item.kind] ?? item.kind}</td>
                <td data-label="Date">{dateTimeText(item.start_at)}</td>
                <td data-label="Total" className="amount">
                  {item.total_cents === null ? '—' : formatDollars(item.total_cents)}
                </td>
                <td data-label="Status">
                  <span className="status-label">
                    {BILLING_LABELS[item.billing.status] ?? item.billing.status}
                  </span>
                </td>
                <td data-label="Invoice id">{item.billing.invoice_id ?? '—'}</td>
                <td data-label="Post">
                  {item.billing.status === 'ready' ? (
                    <button
                      type="button"
                      aria-label={`Post invoice for ${item.number}`}
                      disabled={pendingNumber === item.number}
                      onClick={() => post(item.number)}
                    >
                      Post invoice
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RateCard />
    </main>
  );
}
