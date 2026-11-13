import type { Booking, BookingStatus, CoverageState } from "../../shared/api";
import { COVERAGE_LABELS, STATUS_LABELS } from "../lib/copy";

const SHOWN_AS_STATUS: readonly BookingStatus[] = ["in_progress", "completed", "cancelled", "cancelled_late"];

/** The marker label of a row: its coverage state while it is still being covered, its status label after that. */
export function markerLabel(booking: Pick<Booking, "status" | "coverage">): string {
  return SHOWN_AS_STATUS.includes(booking.status) ? STATUS_LABELS[booking.status] : COVERAGE_LABELS[booking.coverage.state];
}

function markerKind(booking: Pick<Booking, "status" | "coverage">): CoverageState | BookingStatus {
  return SHOWN_AS_STATUS.includes(booking.status) ? booking.status : booking.coverage.state;
}

/** A square marker told apart by pattern, border and the word beside it, never by colour alone. */
export function Marker({ booking }: { booking: Pick<Booking, "status" | "coverage"> }) {
  const kind = markerKind(booking);
  return (
    <span className="marker-wrap">
      <span className={`marker marker--${kind}`} aria-hidden="true">
        {kind === "covered" || kind === "completed" ? (
          <svg viewBox="0 0 14 14" width="14" height="14" focusable="false">
            <path d="M2.5 7.5 5.6 10.6 11.5 3.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
          </svg>
        ) : null}
      </span>
      <span className="marker-label">{markerLabel(booking)}</span>
    </span>
  );
}
