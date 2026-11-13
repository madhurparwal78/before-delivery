import { type RefObject, useState } from "react";
import type { Booking } from "../../shared/api";
import { isBeforeCheckIn } from "../../shared/status";
import { ActionButton } from "../components/ActionButton";
import { SeatLeaveDialog } from "../dialogs/SeatLeaveDialog";
import { type ApiFailure, apiPost } from "../lib/api";
import { PENDING, SUCCESS } from "../lib/copy";
import { dateTimeOf } from "../lib/format";
import { credentialCodes, isCoordinatorHolder, mySeat } from "../lib/holders";

interface SeatsProps {
  booking: Booking;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBooking: (booking: Booking) => void;
}

function OpenCallLine({ booking, who }: { booking: Booking; who: "coordinator" | "interpreter" }) {
  if (booking.open_call_status === "open" && booking.open_call_closes_at !== null) {
    return <p className="open-call mono">Open call closes {dateTimeOf(booking.open_call_closes_at)}</p>;
  }
  if (booking.open_call_status === "closed") {
    return <p className="open-call mono">{who === "coordinator" ? "Open call closed — assign directly" : "Open call closed"}</p>;
  }
  return null;
}

/** The coordinator's Seats panel: who holds each seat, assign and release, team, open call, check-in and completion. */
export function CoordinatorSeats({ booking, headingRef, onBooking, onAssign, onComplete }: SeatsProps & { onAssign: (seat: number) => void; onComplete: () => void }) {
  const post = (path: string) => () => apiPost<Booking>(`/api/bookings/${booking.id}/${path}`);
  const [releasing, setReleasing] = useState<number | null>(null);
  const releasingHolder = booking.seats.find((candidate) => candidate.seat === releasing)?.holder ?? null;
  return (
    <section className="panel" aria-labelledby="seats-heading">
      <h3 id="seats-heading" className="section-label" tabIndex={-1} ref={headingRef}>
        Seats
      </h3>
      <ul className="seat-list">
        {booking.seats.map(({ seat, holder }) => (
          <li key={seat} className="seat">
            <div className="seat-who">
              <span className="seat-no mono">Seat {seat}</span>
              {holder !== null && isCoordinatorHolder(holder) ? (
                <div className="seat-holder">
                  <strong>{holder.name}</strong>
                  <span className="mono small">
                    {holder.credentials.map((credential) => `${credential.code} to ${credential.expires_on}`).join(" · ")}
                  </span>
                  <span className="mono small">
                    {holder.phone} · {holder.email}
                  </span>
                  <span className="mono small">
                    {holder.home_city} · pay {holder.pay_rate_cents} ¢/h
                  </span>
                </div>
              ) : (
                <span className="vacant">Vacant</span>
              )}
            </div>
            {isBeforeCheckIn(booking.status) ? (
              holder === null ? (
                <button key={`assign-${seat}`} type="button" className="btn" onClick={() => onAssign(seat)}>
                  Assign seat {seat}
                </button>
              ) : (
                <button key={`release-${seat}`} type="button" className="btn" onClick={() => setReleasing(seat)}>
                  Release seat {seat}
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <OpenCallLine booking={booking} who="coordinator" />
      {releasing !== null && releasingHolder !== null ? (
        <SeatLeaveDialog
          booking={booking}
          seat={releasing}
          label={`Release seat ${releasing}`}
          sentence={`${releasingHolder.name} will stop holding seat ${releasing} on ${booking.ref} and lose access to its prep materials.`}
          keepLabel="Keep holder"
          confirmLabel="Confirm release"
          onDone={(updated) => {
            setReleasing(null);
            onBooking(updated);
          }}
          onClose={() => setReleasing(null)}
          fallbackFocus={() => headingRef.current}
        />
      ) : null}
      <div className="actions">
        {isBeforeCheckIn(booking.status) && booking.seat_count === 1 ? (
          <ActionButton label="Make team booking" kind="team" pending={PENDING.team} work={post("team")} success={() => SUCCESS.team(booking.ref)} onDone={onBooking} />
        ) : null}
        {booking.status === "submitted" ? (
          <ActionButton label="Post open call" kind="open_call" pending={PENDING.open_call} work={post("open-call")} success={() => SUCCESS.openCall(booking.ref)} onDone={onBooking} />
        ) : null}
        {booking.status === "covered" ? (
          <ActionButton label="Check in" kind="check_in" pending={PENDING.check_in} work={post("check-in")} success={() => SUCCESS.checkedIn(booking.ref)} onDone={onBooking} />
        ) : null}
        {booking.status === "in_progress" ? (
          <button type="button" className="btn" onClick={onComplete}>
            Mark complete
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The interpreter's Seats panel: the people on the booking, claim, and withdraw. */
export function InterpreterSeats({ booking, headingRef, onBooking, claimable, onClaimed, onClaimRefused, onWithdrawn }: SeatsProps & { claimable: boolean; onClaimed: (booking: Booking) => void; onClaimRefused: (failure: ApiFailure) => void; onWithdrawn: () => void }) {
  const held = mySeat(booking);
  const [withdrawing, setWithdrawing] = useState(false);
  const vacant = booking.seats.some((seat) => seat.holder === null);
  return (
    <section className="panel" aria-labelledby="seats-heading">
      <h3 id="seats-heading" className="section-label" tabIndex={-1} ref={headingRef}>
        Seats
      </h3>
      <ul className="seat-list">
        {booking.seats.map(({ seat, holder }) => (
          <li key={seat} className="seat">
            <div className="seat-who">
              <span className="seat-no mono">Seat {seat}</span>
              {holder !== null ? (
                <div className="seat-holder">
                  <strong>{holder.name}</strong>
                  <span className="mono small">{credentialCodes(holder).join(" · ")}</span>
                </div>
              ) : (
                <span className="vacant">Vacant</span>
              )}
            </div>
            {held === seat ? (
              <button type="button" className="btn" onClick={() => setWithdrawing(true)}>
                Withdraw
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <OpenCallLine booking={booking} who="interpreter" />
      {withdrawing && held !== null ? (
        <SeatLeaveDialog
          booking={booking}
          seat={held}
          label="Withdraw from assignment"
          sentence={`You will stop holding seat ${held} on ${booking.ref} and lose access to its prep materials.`}
          keepLabel="Keep seat"
          confirmLabel="Confirm withdrawal"
          onDone={(updated) => {
            setWithdrawing(false);
            onBooking(updated);
            onWithdrawn();
          }}
          onClose={() => setWithdrawing(false)}
          fallbackFocus={() => headingRef.current}
        />
      ) : null}
      {claimable && held === null && vacant && booking.open_call_status === "open" ? (
        <div className="actions">
          <ActionButton
            label="Claim seat"
            kind="claim"
            pending={PENDING.claim}
            work={() => apiPost<Booking>(`/api/bookings/${booking.id}/claim`)}
            success={(updated) => SUCCESS.claimed(mySeat(updated) ?? 0, booking.ref)}
            onDone={onClaimed}
            onFailure={onClaimRefused}
          />
        </div>
      ) : null}
    </section>
  );
}

/** The requester's Interpreters panel: one card per held seat, with initials, name and credential codes only. */
export function InterpretersPanel({ booking }: { booking: Booking }) {
  const held = booking.seats.flatMap((seat) => (seat.holder === null ? [] : [{ seat: seat.seat, holder: seat.holder }]));
  return (
    <section className="panel" aria-labelledby="interpreters-heading">
      <h3 id="interpreters-heading" className="section-label">
        Interpreters
      </h3>
      {held.length === 0 ? (
        <p className="empty-note">No interpreter holds a seat yet.</p>
      ) : (
        <div className="cards">
          {held.map(({ seat, holder }) => (
            <article key={seat} className="card" aria-label={holder.name}>
              <span className="badge mono" aria-hidden="true">
                {holder.initials}
              </span>
              <div>
                <strong>{holder.name}</strong>
                <span className="mono small">
                  {credentialCodes(holder).map((code) => (
                    <span key={code} className="code">
                      {code}
                    </span>
                  ))}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
