// The docket: a printed tab with the hour balance, Repeat weekly for, the live hold, the selected
// ticket and the compliance line (renters), or the selected ticket's renter (staff).

import { useEffect } from "react";
import type { BookingView, ComplianceView } from "../../../shared/api.js";
import { formatHours } from "../../../shared/hours.js";
import { useServerNow } from "../../clock.js";
import { type Message, StatusRegion } from "../../components/Feedback.js";
import { useReducedMotion } from "../../motion.js";
import { complianceLine } from "../../words.js";
import { RollingNumber } from "./RollingNumber.js";

export interface StaffSelection {
  business: string;
  station: string;
  times: string;
  date: string;
}

interface RenterDocketProps {
  balanceMinutes: number | null;
  heldMinutes: number;
  weeksText: string;
  onWeeks: (value: string) => void;
  liveHold: BookingView[] | null;
  selected: BookingView | null;
  compliance: ComplianceView | null;
  busy: "confirm" | "release" | "cancel" | null;
  onConfirm: () => void;
  onRelease: () => void;
  onCancel: () => void;
  onExpired: () => void;
  status: Message | null;
}

function Countdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const reduced = useReducedMotion();
  const now = useServerNow(reduced ? 60_000 : 1000);
  const remaining = now === null ? 0 : Math.max(0, Date.parse(expiresAt) - now);
  const expired = now !== null && remaining <= 0;
  useEffect(() => {
    if (expired) onExpired();
  }, [expired, onExpired]);
  const seconds = Math.ceil(remaining / 1000);
  const text = reduced
    ? `${Math.ceil(remaining / 60_000)} min left`
    : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <span role="timer" aria-label="Hold countdown" className="countdown mono">
      {text}
    </span>
  );
}

export function RenterDocket(props: RenterDocketProps) {
  const series = props.liveHold ?? [];
  const [first] = series;
  return (
    <aside className="docket" aria-label="Docket">
      <div className="docket__tab">
        <span className="docket__caption">Hour balance</span>
        <p role="status" aria-label="Hour balance" className="docket__balance mono">
          {props.balanceMinutes === null ? "—" : <RollingNumber value={`${formatHours(props.balanceMinutes)} h`} />}
        </p>
      </div>
      <div className="docket__repeat">
        <label htmlFor="repeat-weeks" className="field__label">
          Repeat weekly for
        </label>
        <span className="docket__repeat-row">
          <input id="repeat-weeks" className="field__input field__input--spin mono" type="number" min={1} max={12} step={1} value={props.weeksText} onChange={(event) => props.onWeeks(event.target.value)} />
          <span>week(s)</span>
        </span>
      </div>
      {first ? (
        <section className="docket__hold" aria-label="Live hold">
          <span className="docket__caption">Live hold</span>
          <p className="docket__line">
            {`Hold ${first.station_name} `}
            <span className="mono">{`${first.date} ${first.start}–${first.end}`}</span>
          </p>
          {series.length > 1 ? <p className="docket__meta mono">{`× ${series.length} weeks`}</p> : null}
          <p className="docket__meta mono">{`Pending −${formatHours(props.heldMinutes)} h`}</p>
          <p className="docket__countdown">
            <span className="docket__caption">Confirm within</span> <Countdown expiresAt={first.hold_expires_at} onExpired={props.onExpired} />
          </p>
          <div className="docket__actions">
            <button type="button" className="button button--primary" data-focus="confirm" disabled={props.busy !== null} onClick={props.onConfirm}>
              Confirm booking
            </button>
            <button type="button" className="button" disabled={props.busy !== null} onClick={props.onRelease}>
              Release hold
            </button>
          </div>
        </section>
      ) : null}
      {props.selected && props.selected.status !== "hold" ? (
        <section className="docket__selected" aria-label="Selected booking">
          <p className="docket__line">{`${props.selected.station_name} · ${props.selected.date}`}</p>
          <p className="docket__meta mono">{`${props.selected.start}–${props.selected.end} · ${formatHours(props.selected.minutes_debited)} h`}</p>
          <p className="docket__meta">{`Sanitation buffer ${props.selected.buffer_minutes} min`}</p>
          {props.selected.status === "confirmed" ? (
            <div className="docket__actions">
              <button type="button" className="button" data-focus="cancel" disabled={props.busy !== null} onClick={props.onCancel}>
                Cancel booking
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      <p className="docket__compliance">{props.compliance ? complianceLine(props.compliance) : ""}</p>
      <StatusRegion name="Booking status" message={props.status} />
    </aside>
  );
}

export function StaffDocket({ selected, status }: { selected: StaffSelection | null; status: Message | null }) {
  return (
    <aside className="docket" aria-label="Docket">
      <div className="docket__tab">
        <span className="docket__caption">Selected ticket</span>
        <p className="docket__business">{selected ? selected.business : "None"}</p>
      </div>
      {selected ? (
        <section className="docket__selected" aria-label="Selected booking">
          <p className="docket__line">{`${selected.station} · ${selected.date}`}</p>
          <p className="docket__meta mono">{selected.times}</p>
        </section>
      ) : (
        <p className="docket__meta">Choose a ticket on a rail to see whose booking it is.</p>
      )}
      <StatusRegion name="Booking status" message={status} />
    </aside>
  );
}
