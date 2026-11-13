import type { Booking } from "../../shared/api";
import { STATUS_LABELS } from "../lib/copy";
import { dateTimeOf, timeOf } from "../lib/format";

const SETTING_LABELS = { medical: "Medical", educational: "Educational", legal: "Legal", workplace: "Workplace" } as const;

/** The booking's facts as ruled label/value rows. */
export function FactsPanel({ booking }: { booking: Booking }) {
  const sameDay = booking.start.slice(0, 10) === booking.end.slice(0, 10);
  return (
    <section className="panel" aria-labelledby="facts-heading">
      <h3 id="facts-heading" className="section-label">
        Facts
      </h3>
      <dl className="facts">
        <div>
          <dt>Organisation</dt>
          <dd>{booking.org_name}</dd>
        </div>
        <div>
          <dt>Setting</dt>
          <dd>{SETTING_LABELS[booking.setting]}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{booking.location}</dd>
        </div>
        <div>
          <dt>On-site contact</dt>
          <dd>
            {booking.onsite_contact_name} <span className="mono">{booking.onsite_contact_phone}</span>
          </dd>
        </div>
        <div>
          <dt>Deaf consumer</dt>
          <dd>{booking.consumer_name}</dd>
        </div>
        <div>
          <dt>Start to end</dt>
          <dd className="mono">
            <span className="nowrap">
              {dateTimeOf(booking.start)} to {sameDay ? timeOf(booking.end) : dateTimeOf(booking.end)}
            </span>{" "}
            <span className="nowrap">· {booking.duration_minutes} min</span>
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[booking.status]}</dd>
        </div>
      </dl>
      {booking.requester_notes ? (
        <>
          <h4 className="notes-label">Notes for the agency</h4>
          <p className="notes">{booking.requester_notes}</p>
        </>
      ) : null}
    </section>
  );
}
