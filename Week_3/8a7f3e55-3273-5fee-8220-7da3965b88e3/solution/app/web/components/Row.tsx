import { memo } from "react";
import type { Booking } from "../../shared/api";
import { STATUS_LABELS } from "../lib/copy";
import { timeOf } from "../lib/format";
import { Marker, markerLabel } from "./Marker";

interface RowProps {
  booking: Booking;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** One ruled list row: start time, reference, title, marker and status label. */
export const Row = memo(function Row({ booking, selected, onSelect }: RowProps) {
  const time = timeOf(booking.start);
  const label = markerLabel(booking);
  const showStatus = STATUS_LABELS[booking.status] !== label;
  const name = `${time} ${booking.ref} ${booking.title}, ${label}`;
  return (
    <button
      type="button"
      className="row"
      data-coverage={booking.coverage.state}
      data-row-id={booking.id}
      aria-current={selected ? "true" : undefined}
      aria-label={name}
      onClick={() => onSelect(booking.id)}
    >
      <span className="row-time mono">{time}</span>{" "}
      <span className="row-ref mono">{booking.ref}</span>{" "}
      <span className="row-title">{booking.title}</span>{" "}
      <span className="row-state">
        {showStatus ? <span className="row-status">{STATUS_LABELS[booking.status]}</span> : null}{" "}
        <Marker booking={booking} />
      </span>
    </button>
  );
});
