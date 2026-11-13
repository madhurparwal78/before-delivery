import type { ReactNode, Ref } from 'react';
import type { Booking, BookingStatus } from '../../shared/api.js';
import { COVERAGE_LABELS, STATUS_LABELS } from '../copy.js';
import { agencyTimeOf } from '../format.js';

const COVERAGE_PHASES: BookingStatus[] = ['submitted', 'open', 'partially_covered', 'covered'];

function markerLabel(booking: Booking): string {
  return COVERAGE_PHASES.includes(booking.status)
    ? COVERAGE_LABELS[booking.coverage.state]
    : STATUS_LABELS[booking.status];
}

function CoverageMarker({ booking }: { booking: Booking }): ReactNode {
  const label = markerLabel(booking);
  return (
    <span className="marker" data-state={booking.coverage.state}>
      <span className="swatch" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export interface RowProps {
  booking: Booking;
  selected: boolean;
  onSelect: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function BookingRow({ booking, selected, onSelect, buttonRef }: RowProps): ReactNode {
  const name = `${agencyTimeOf(booking.start)} ${booking.ref} ${booking.title}, ${markerLabel(booking)}`;
  return (
    <button
      type="button"
      className="row"
      ref={buttonRef}
      data-coverage={booking.coverage.state}
      aria-label={name}
      {...(selected ? { 'aria-current': 'true' as const } : {})}
      onClick={onSelect}
    >
      <span className="row-time mono">{agencyTimeOf(booking.start)}</span>
      <span className="row-ref mono">{booking.ref}</span>
      <span className="row-title">{booking.title}</span>
      <span className="row-status">
        <CoverageMarker booking={booking} />
        <span> {STATUS_LABELS[booking.status]}</span>
      </span>
    </button>
  );
}
