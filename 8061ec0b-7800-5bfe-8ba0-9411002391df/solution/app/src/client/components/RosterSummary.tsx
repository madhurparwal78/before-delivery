// Roster statuses as a word with its own line icon; the icon is decoration, hidden from screen readers.

import type { ReactNode } from "react";
import { Award, CalendarClock, CircleDashed, FileSignature, PackageCheck, type LucideIcon } from "lucide-react";
import type { Roster } from "../../shared/api.js";
import { DELIVERY_STATUSES, DELIVERY_STATUS_WORDS, type DeliveryStatus } from "../../shared/vocabulary.js";

const ICONS: Record<DeliveryStatus, LucideIcon> = {
  no_instrument: CircleDashed, awaiting_agreement: FileSignature, scheduled: CalendarClock, delivered: PackageCheck,
  owned: Award,
};

export function DeliveryStatusWord({ status }: { status: DeliveryStatus }): ReactNode {
  const Icon = ICONS[status];
  return (
    <span className={`delivery delivery--${status}`}>
      <Icon aria-hidden="true" className="delivery__icon" size={16} strokeWidth={1.75} />
      {DELIVERY_STATUS_WORDS[status]}
    </span>
  );
}

/** "<k> of <total> students have an instrument" and one item per status, in the roster status table's order. */
export function RosterSummary({ counts, total }: { counts: Roster["counts"]; total: number }): ReactNode {
  const placed = counts.scheduled + counts.delivered + counts.owned;
  return (
    <div className="roster-summary">
      <p className="roster-summary__line">{placed} of {total} students have an instrument</p>
      <ul aria-label="Roster summary" className="roster-summary__list">
        {DELIVERY_STATUSES.map((status) => (
          <li key={status}><DeliveryStatusWord status={status} />: {counts[status]}</li>
        ))}
      </ul>
    </div>
  );
}
