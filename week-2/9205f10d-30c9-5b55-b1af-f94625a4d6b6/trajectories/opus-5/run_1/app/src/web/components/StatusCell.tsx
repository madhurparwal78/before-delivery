import type { ReactNode } from 'react';
import type { RequestView } from '../../shared/types.js';
import { STATUS_LABELS, isCancelled } from '../format.js';

export function confirmedSeatCount(request: RequestView): number {
  return request.seats.filter((seat) => seat.status === 'confirmed').length;
}

export function seatCounterText(request: RequestView): string {
  return `${confirmedSeatCount(request)}/${request.team_size}`;
}

/** Status never reads by colour alone: a word, hatched or solid seat cells, and a counter. */
export function StatusCell({ request }: { request: RequestView }): ReactNode {
  const cells =
    request.seats.length > 0
      ? request.seats.map((seat) => ({ key: seat.label, confirmed: seat.status === 'confirmed' }))
      : Array.from({ length: request.team_size }, (_, index) => ({
          key: String(index),
          confirmed: false,
        }));
  return (
    <span className="status-cell">
      <span className={`status-label${isCancelled(request.status) ? ' alert' : ''}`}>
        {STATUS_LABELS[request.status]}
      </span>
      <span className="seat-cells" aria-hidden="true">
        {cells.map((cell) => (
          <span key={cell.key} className={`seat-cell ${cell.confirmed ? 'confirmed' : 'open'}`} />
        ))}
      </span>
      <span className="seat-counter">{seatCounterText(request)}</span>
    </span>
  );
}
