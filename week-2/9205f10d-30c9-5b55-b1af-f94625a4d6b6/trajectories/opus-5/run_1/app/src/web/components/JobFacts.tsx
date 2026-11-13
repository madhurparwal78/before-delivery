import type { ReactNode } from 'react';
import type { RequestView, Seat } from '../../shared/types.js';
import { SETTING_LABELS, monthDay, timeWindowWithZone, weekday } from '../format.js';

export function seatWordFor(seat: Seat): string {
  if (seat.status === 'open') return 'open';
  return seat.interpreter === null ? 'taken' : seat.interpreter.display_name;
}

export function JobFacts({ request }: { request: RequestView }): ReactNode {
  return (
    <ul className="facts-list">
      <li>
        <b>Date</b>
        <span>{`${weekday(request.starts_at)}, ${monthDay(request.starts_at)}`}</span>
      </li>
      <li>
        <b>Time</b>
        <span className="mono">{timeWindowWithZone(request.starts_at, request.ends_at)}</span>
      </li>
      <li>
        <b>Setting</b>
        <span>{SETTING_LABELS[request.setting]}</span>
      </li>
      <li>
        <b>Required credential</b>
        <span className="mono">{request.required_credential}</span>
      </li>
      <li>
        <b>City</b>
        <span>{request.city}</span>
      </li>
      {request.consumer_name !== undefined ? (
        <li>
          <b>Deaf consumer</b>
          <span>{request.consumer_name}</span>
        </li>
      ) : null}
      {request.location_address !== undefined ? (
        <li>
          <b>Street address</b>
          <span>{request.location_address}</span>
        </li>
      ) : null}
      {request.notes !== undefined ? (
        <li>
          <b>Notes</b>
          <span>{request.notes}</span>
        </li>
      ) : null}
    </ul>
  );
}

export function SeatsList({ request }: { request: RequestView }): ReactNode {
  return (
    <>
      <h4>Seats</h4>
      <ul className="seat-list" aria-label="Seats">
        {request.seats.map((seat) => (
          <li key={seat.id} aria-label={`Seat ${seat.label}: ${seatWordFor(seat)}`}>
            <span className="mono">{`Seat ${seat.label}`}</span>
            <span>{seatWordFor(seat)}</span>
            {(seat.interpreter?.credentials ?? []).map((code) => (
              <span className="badge" key={code}>
                {code}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
