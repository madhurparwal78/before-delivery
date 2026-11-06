import { ReactElement } from 'react';
import { GATE_LABELS, GATE_ORDER, RequestObject, SETTING_LABELS, UserSummary } from '../types';
import { cardDate, clock, dateAndClock } from '../format';
import { GateView } from './boardState';
import { Link } from '../router';

export function BoardDetail({
  request,
  preferred,
  gateView,
}: {
  request: RequestObject | null;
  preferred: UserSummary[];
  gateView: GateView | undefined;
}): ReactElement {
  return (
    <section className="board-detail" aria-label="Request detail">
      {!request ? (
        <p>Select a request to see its file.</p>
      ) : (
        <>
          <h2>
            <span className="ref">{request.ref}</span> {request.title}
          </h2>
          <dl className="detail-section">
            <div className="pair">
              <dt>When</dt>
              <dd className="mono">
                {cardDate(request.start)} {clock(request.start)}–{clock(request.end)}
              </dd>
            </div>
            <div className="pair">
              <dt>Setting</dt>
              <dd>{SETTING_LABELS[request.setting]}</dd>
            </div>
            <div className="pair">
              <dt>Organisation</dt>
              <dd>{request.org_name}</dd>
            </div>
            <div className="pair">
              <dt>Location</dt>
              <dd>{request.location}</dd>
            </div>
            <div className="pair">
              <dt>Deaf consumer</dt>
              <dd>{request.consumer.name}</dd>
            </div>
            <div className="pair">
              <dt>Status</dt>
              <dd>{request.status}</dd>
            </div>
            <div className="pair">
              <dt>Seats</dt>
              <dd className="counter">
                {request.seats_claimed}/{request.seats_total}
              </dd>
            </div>
            <div className="pair">
              <dt>Preferred interpreters</dt>
              <dd>{preferred.length > 0 ? preferred.map((item) => item.name).join(', ') : 'None recorded'}</dd>
            </div>
          </dl>

          <div className="detail-section">
            <h3>Seats</h3>
            <ul className="plain">
              {request.seats.map((seat) => (
                <li key={seat.id}>
                  Seat {seat.position}: {seat.status}
                  {seat.interpreter ? ` — ${seat.interpreter.name}` : ''}
                  {seat.held_by ? `, held by ${seat.held_by.name}` : ''}
                  {seat.offer ? (
                    <span className="mono"> expires {dateAndClock(seat.offer.expires_at)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="detail-section">
            <h3>Prep materials</h3>
            {request.prep_files.length === 0 ? (
              <p>No prep material yet.</p>
            ) : (
              <ul className="plain">
                {request.prep_files.map((file) => (
                  <li key={file.id}>
                    <a href={`/api/prep/${file.id}`}>{file.filename}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="detail-section">
            <h3>Latest gate results</h3>
            {!gateView || gateView.phase === 'pending' ? (
              <p>No gate check yet.</p>
            ) : (
              <ul className="plain">
                {GATE_ORDER.map((gate, index) => {
                  const result = gateView.gates[index];
                  if (!result) return null;
                  return (
                    <li key={gate}>
                      {GATE_LABELS[gate]}: {result.pass ? 'pass' : 'fail'}
                      {result.reason ? ` — ${result.reason}` : ''}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <Link to={`/requests/${request.id}`}>Open full request</Link>
        </>
      )}
    </section>
  );
}
