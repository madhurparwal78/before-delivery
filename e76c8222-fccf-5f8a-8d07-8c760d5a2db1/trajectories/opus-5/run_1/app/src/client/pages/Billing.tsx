import { ReactElement, useEffect, useState } from 'react';
import { ApiCallError, api } from '../api';
import { LiveRegion } from '../components/LiveRegion';
import { dateAndClock } from '../format';
import { Link } from '../router';
import { Rates, SETTINGS, SETTING_LABELS, TimesheetQueueRow } from '../types';

export function Billing(): ReactElement {
  const [queue, setQueue] = useState<TimesheetQueueRow[]>([]);
  const [rates, setRates] = useState<Rates | null>(null);
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  const load = async (): Promise<void> => {
    const [queuePayload, ratesPayload] = await Promise.all([api.timesheetQueue(), api.rates()]);
    setQueue(queuePayload.timesheets);
    setRates(ratesPayload.rates);
    setDraftRates({ ...ratesPayload.rates });
  };

  useEffect(() => {
    void load();
  }, []);

  const approve = async (row: TimesheetQueueRow): Promise<void> => {
    setPending(true);
    setMessage('Approving…');
    try {
      const payload = await api.approveTimesheet(row.id, crypto.randomUUID());
      setMessage(
        `Approved ${row.ref} for ${row.interpreter.name}: $${payload.timesheet.amount}.`,
      );
      await load();
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      if (failure?.code === 'billing_unavailable') {
        setMessage(
          'Billing is unreachable. The timesheet is not approved. Try again in a few minutes.',
        );
      } else if (failure?.code === 'storage_unavailable') {
        setMessage('File storage is unreachable. The timesheet is not approved.');
      } else {
        setMessage('That timesheet could not be approved.');
      }
    } finally {
      setPending(false);
    }
  };

  const saveRates = async (): Promise<void> => {
    setPending(true);
    setFields({});
    setMessage('Saving rates…');
    try {
      const payload = await api.saveRates(draftRates as Partial<Rates>);
      setRates(payload.rates);
      setDraftRates({ ...payload.rates });
      setMessage('Rates saved. They apply to approvals and cancellations from now on.');
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      setFields(failure?.fields ?? {});
      setMessage('Check the highlighted fields.');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="column">
      <h1>Billing</h1>

      <table className="stack-rows" aria-label="Timesheets awaiting approval">
        <thead>
          <tr>
            <th scope="col">Ref</th>
            <th scope="col">Interpreter</th>
            <th scope="col">Worked</th>
            <th scope="col">Billed hours</th>
            <th scope="col">Approve</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((row) => (
            <tr key={row.id}>
              <td data-label="Ref" className="ref">
                <Link to={`/requests/${row.request_id}`}>{row.ref}</Link>
              </td>
              <td data-label="Interpreter">{row.interpreter.name}</td>
              <td data-label="Worked" className="mono">
                {dateAndClock(row.actual_start)} – {dateAndClock(row.actual_end)}
              </td>
              <td data-label="Billed hours" className="mono">
                {row.billed_hours}
              </td>
              <td data-label="Approve">
                <button type="button" disabled={pending} onClick={() => void approve(row)}>
                  Approve {row.ref} for {row.interpreter.name}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {queue.length === 0 ? <p>No timesheets are waiting.</p> : null}

      <section className="detail-section" aria-label="Rates">
        <h2>Rates</h2>
        {SETTINGS.map((setting) => (
          <div className="field" key={setting}>
            <label htmlFor={`rate-${setting}`}>{SETTING_LABELS[setting]} hourly rate</label>
            <input
              id={`rate-${setting}`}
              type="text"
              className="amount"
              value={draftRates[setting] ?? ''}
              onChange={(event) =>
                setDraftRates((current) => ({ ...current, [setting]: event.target.value }))
              }
            />
            {fields[setting] ? <p className="field-error">{fields[setting]}</p> : null}
          </div>
        ))}
        <button type="button" disabled={pending || !rates} onClick={() => void saveRates()}>
          Save rates
        </button>
      </section>

      <p>
        <Link to="/invoices">Invoices</Link>
      </p>

      <LiveRegion label="Billing status" message={message} />
    </main>
  );
}
