import { useState, type ReactNode } from 'react';
import { api, newIdempotencyKey, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import { usePolled } from '../hooks.js';
import { monthDay, weekday } from '../format.js';

export function Billing(): ReactNode {
  const ready = usePolled(() => api.requests('?status=completed'), ['ready-to-close']);
  const [message, setMessage] = useState('');
  const [closing, setClosing] = useState('');

  const close = async (id: string, reference: string): Promise<void> => {
    setClosing(id);
    setMessage(`Closing ${reference}…`);
    try {
      const result = await api.close(id, newIdempotencyKey());
      setMessage(
        result.invoice.billing_status === 'posted'
          ? `${reference} invoiced at $${result.invoice.amount}.`
          : `${reference} closed at $${result.invoice.amount}. Invoice pending: it posts to billing automatically once the billing system responds.`,
      );
      ready.refresh();
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        setMessage(failure.code === 'unreachable' ? UNREACHABLE_COPY : failure.message);
      }
      ready.refresh();
    } finally {
      setClosing('');
    }
  };

  return (
    <main className="page">
      <h1>Billing</h1>
      <table className="stacked-table">
        <caption>Ready to close</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Organisation</th>
            <th scope="col">Date</th>
            <th scope="col">Seats</th>
            <th scope="col">Actual minutes</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {(ready.data?.requests ?? []).map((request) => (
            <tr key={request.id}>
              <td data-label="Reference" className="num">
                {request.reference}
              </td>
              <td data-label="Organisation">{request.organisation?.name ?? ''}</td>
              <td data-label="Date" className="num">
                {`${weekday(request.starts_at)}, ${monthDay(request.starts_at)}`}
              </td>
              <td data-label="Seats" className="num">
                {request.seats.filter((seat) => seat.status === 'confirmed').length}
              </td>
              <td data-label="Actual minutes" className="num">
                {request.actual_minutes ?? '—'}
              </td>
              <td data-label="Action">
                <button
                  type="button"
                  aria-label={`Close ${request.reference}`}
                  disabled={closing === request.id}
                  onClick={() => void close(request.id, request.reference)}
                >
                  Close
                </button>
              </td>
            </tr>
          ))}
          {ready.data !== null && ready.data.requests.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
                No completed jobs are waiting to be closed.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="live" role="status" aria-label="Billing status">
        {message}
      </p>
    </main>
  );
}
