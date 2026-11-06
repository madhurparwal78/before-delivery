import { useState, type ReactNode } from 'react';
import {
  BILLING_STATUS_LABELS,
  type BillingQueueItem,
  type ServiceLine,
} from '../../shared/contract.js';
import { formatAgencyDate, formatAgencyDateWithYear, formatDollars, parseDateString } from '../../shared/zone.js';
import { ApiFailure, api } from '../api.js';
import { usePoll } from '../hooks.js';
import { Field, StatusRegion } from '../ui.js';

const ORG_CODES: Array<{ code: string; name: string }> = [
  { code: 'RVH', name: 'Riverbend Valley Hospital' },
  { code: 'CPSD', name: 'Cedar Prairie School District' },
  { code: 'LFC', name: 'Lakeview Family Clinic' },
];

const SERVICE_LINES: Array<{ value: ServiceLine; label: string }> = [
  { value: 'asl', label: 'ASL' },
  { value: 'spoken', label: 'Spoken' },
];

const KIND_LABELS: Record<BillingQueueItem['kind'], string> = {
  service: 'Service',
  late_cancellation: 'Late cancellation',
};

/** Dollars typed by hand become integer cents without any floating-point arithmetic. */
function dollarsToCents(input: string): number | null {
  const match = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (match === null) {
    return null;
  }
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '0').padEnd(2, '0');
  return whole * 100 + Number(fraction);
}

export function Billing(): ReactNode {
  const queue = usePoll(() => api.billingQueue());
  const [org, setOrg] = useState('RVH');
  const rates = usePoll(() => api.rateCards(org), org);
  const [billingStatus, setBillingStatus] = useState('');
  const [posting, setPosting] = useState<string | null>(null);

  const items = queue.data?.items ?? [];

  const post = async (number: string): Promise<void> => {
    setPosting(number);
    setBillingStatus('Posting…');
    try {
      const result = await api.postInvoice(number);
      setBillingStatus(
        result.billing.status === 'posted'
          ? `Posted to Kill Bill as invoice ${result.billing.invoice_id ?? ''}.`
          : 'Queued. Kill Bill is unreachable, and this will post automatically when it returns.',
      );
      await queue.refresh();
    } catch (error) {
      setBillingStatus(
        error instanceof ApiFailure && error.code === 'not_billable'
          ? 'This item is not ready to invoice.'
          : "Couldn't reach Teamseat. Try again shortly.",
      );
    } finally {
      setPosting(null);
    }
  };

  return (
    <main className="sheet">
      <section className="panel span-12">
        <h2 className="panel__title">Billing queue</h2>
        <StatusRegion name="Billing status" text={billingStatus} />
        <div className="table-wrap">
  <table className="stacked" aria-label="Billing queue">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Organisation</th>
                <th scope="col">Kind</th>
                <th scope="col">Date (Central)</th>
                <th scope="col">Total</th>
                <th scope="col">Status</th>
                <th scope="col">Invoice id</th>
                <th scope="col">
                  <span className="visually-hidden">Post</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.number}>
                  <td data-label="Number">
                    <span className="num">{item.number}</span>
                  </td>
                  <td data-label="Organisation">{item.org_code}</td>
                  <td data-label="Kind">{KIND_LABELS[item.kind]}</td>
                  <td data-label="Date">{formatAgencyDate(new Date(item.start_at))}</td>
                  <td data-label="Total">
                    <span className="num">{formatDollars(item.total_cents)}</span>
                  </td>
                  <td data-label="Status" className="statuscell">
                    {item.billing.status === 'none'
                      ? ''
                      : BILLING_STATUS_LABELS[item.billing.status]}
                  </td>
                  <td data-label="Invoice id">
                    <span className="num">{item.billing.invoice_id ?? '—'}</span>
                  </td>
                  <td data-label="">
                    {item.billing.status === 'ready' ? (
                      <button
                        type="button"
                        className="btn btn--primary"
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
</div>
        {items.length === 0 ? <p>Nothing to invoice yet.</p> : null}
      </section>

      <section className="panel span-12">
        <h2 className="panel__title">Rate cards</h2>
        <Field label="Organisation">
          {({ id }) => (
            <select id={id} value={org} onChange={(event) => setOrg(event.target.value)}>
              {ORG_CODES.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="table-wrap">
  <table className="stacked" aria-label="Rate card">
            <thead>
              <tr>
                <th scope="col">Service line</th>
                <th scope="col">Effective from</th>
                <th scope="col">Hourly rate</th>
                <th scope="col">Mileage</th>
              </tr>
            </thead>
            <tbody>
              {(rates.data?.entries ?? []).map((entry) => (
                <tr key={`${entry.service_line}-${entry.effective_from}`}>
                  <td data-label="Service line">{entry.service_line === 'asl' ? 'ASL' : 'Spoken'}</td>
                  <td data-label="Effective from">
                    <span className="num">{entry.effective_from}</span>
                  </td>
                  <td data-label="Hourly rate">
                    <span className="num">{formatDollars(entry.hourly_rate_cents)}</span>
                  </td>
                  <td data-label="Mileage">
                    <span className="num">{entry.mileage_cents_per_mile} ¢/mi</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        <AddRateForm org={org} onAdded={() => void rates.refresh()} />
      </section>
    </main>
  );
}

function AddRateForm({ org, onAdded }: { org: string; onAdded: () => void }): ReactNode {
  const [serviceLine, setServiceLine] = useState<ServiceLine>('asl');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [hourly, setHourly] = useState('');
  const [mileage, setMileage] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    setPending(true);
    setFields({});
    setStatus('Saving…');
    const hourlyCents = dollarsToCents(hourly);
    try {
      await api.addRateCard({
        org,
        service_line: serviceLine,
        effective_from: effectiveFrom,
        hourly_rate_cents: hourlyCents,
        mileage_cents_per_mile: Number(mileage),
      });
      const parsed = parseDateString(effectiveFrom);
      setStatus(
        parsed === null
          ? 'Rate saved.'
          : `Rate from ${formatAgencyDateWithYear(new Date(`${effectiveFrom}T12:00:00-06:00`))} saved.`,
      );
      setEffectiveFrom('');
      setHourly('');
      setMileage('');
      onAdded();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'duplicate_rate') {
        setStatus('A rate already starts on that date.');
      } else if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        setStatus('Check the highlighted fields.');
      } else {
        setStatus("Couldn't reach Teamseat. Try again shortly.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      aria-label="Add rate"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Service line" error={fields['service_line']}>
        {({ id, describedBy }) => (
          <select
            id={id}
            aria-describedby={describedBy}
            value={serviceLine}
            onChange={(event) => setServiceLine(event.target.value as ServiceLine)}
          >
            {SERVICE_LINES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Effective from" hint="YYYY-MM-DD, later than today" error={fields['effective_from']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            inputMode="numeric"
            aria-describedby={describedBy}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        )}
      </Field>
      <Field label="Hourly rate (dollars)" hint="For example 90.00" error={fields['hourly_rate_cents']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            inputMode="decimal"
            aria-describedby={describedBy}
            value={hourly}
            onChange={(event) => setHourly(event.target.value)}
          />
        )}
      </Field>
      <Field label="Mileage (cents per mile)" error={fields['mileage_cents_per_mile']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            inputMode="numeric"
            aria-describedby={describedBy}
            value={mileage}
            onChange={(event) => setMileage(event.target.value)}
          />
        )}
      </Field>
      <button type="submit" className="btn btn--primary" disabled={pending}>
        Add rate
      </button>
      <StatusRegion name="Rate status" text={status} />
    </form>
  );
}
