import { ReactElement, useEffect, useState } from 'react';
import { api } from '../api';
import { cardDate, clock } from '../format';
import { Link } from '../router';
import { RequestObject, SETTING_LABELS } from '../types';

export function RequestsList(): ReactElement {
  const [requests, setRequests] = useState<RequestObject[]>([]);

  useEffect(() => {
    void api.requests().then((payload) => setRequests(payload.requests));
  }, []);

  return (
    <main className="column">
      <h1>Requests</h1>
      <p>
        <Link to="/requests/new">New request</Link>
      </p>
      <table className="stack-rows" aria-label="Requests">
        <thead>
          <tr>
            <th scope="col">Ref</th>
            <th scope="col">Title</th>
            <th scope="col">Setting</th>
            <th scope="col">Start</th>
            <th scope="col">Status</th>
            <th scope="col">Seats</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td data-label="Ref" className="ref">
                <Link to={`/requests/${request.id}`}>{request.ref}</Link>
              </td>
              <td data-label="Title">{request.title}</td>
              <td data-label="Setting">{SETTING_LABELS[request.setting]}</td>
              <td data-label="Start" className="mono">
                {cardDate(request.start)} {clock(request.start)}
              </td>
              <td data-label="Status">{request.status}</td>
              <td data-label="Seats" className="counter">
                {request.seats_accepted}/{request.seats_total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
