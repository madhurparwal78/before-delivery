import { useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { useDebounced, usePolled } from '../hooks.js';
import { Link } from '../router.jsx';
import { SETTING_LABELS, isCancelled, clock, monthDay, weekday } from '../format.js';
import { StatusCell } from '../components/StatusCell.jsx';

export function Requests(): ReactNode {
  const [search, setSearch] = useState('');
  const [immediate, setImmediate] = useState('');
  const debounced = useDebounced(search);
  const query = immediate !== '' ? immediate : debounced;
  const list = usePolled(
    () => api.requests(query === '' ? '' : `?q=${encodeURIComponent(query)}`),
    ['requests', query],
  );

  const requests = [...(list.data?.requests ?? [])].sort(
    (left, right) => new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime(),
  );

  return (
    <main className="page">
      <h1>Requests</h1>
      <div className="field form-6">
        <label htmlFor="search-requests">Search requests</label>
        <input
          id="search-requests"
          type="search"
          aria-label="Search requests"
          placeholder="Reference or consumer name"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setImmediate('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setImmediate(search);
          }}
        />
      </div>
      <table className="stacked-table">
        <caption>Requests</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Date</th>
            <th scope="col">Time</th>
            <th scope="col">Setting</th>
            <th scope="col">Status</th>
            <th scope="col">Seats</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td data-label="Reference">
                <Link
                  to={`/requests/${request.id}`}
                  aria-label={request.reference}
                  className={isCancelled(request.status) ? 'struck mono' : 'mono'}
                >
                  {request.reference}
                </Link>
              </td>
              <td data-label="Date" className="num">
                {`${weekday(request.starts_at)}, ${monthDay(request.starts_at)}`}
              </td>
              <td data-label="Time" className="num">
                {clock(request.starts_at)}
              </td>
              <td data-label="Setting">{SETTING_LABELS[request.setting]}</td>
              <td data-label="Status">
                <StatusCell request={request} />
              </td>
              <td data-label="Seats">
                {request.seats.length === 0
                  ? '—'
                  : request.seats
                      .map(
                        (seat) =>
                          `${seat.label}: ${seat.interpreter?.display_name ?? (seat.status === 'confirmed' ? 'taken' : 'open')}`,
                      )
                      .join(', ')}
              </td>
            </tr>
          ))}
          {list.data !== null && requests.length === 0 ? (
            <tr>
              <td className="empty" colSpan={6}>
                No requests match.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
