import type { ReactNode } from 'react';
import type { Session } from '../../shared/api';
import { refusalCopy } from '../copy';
import { timeRange, venueClock } from '../format';
import { Link } from '../router';
import type { Viewer } from '../state';
import { rowKey, type Booking, type BookingAction } from './booking';
import { CheckIcon, PlusIcon } from './icons';

// The session row and its seat actions, used by the board, the session page and My Agenda.

export function speakerLine(session: Session): string {
  return session.speakers.map((speaker) => `${speaker.name} - ${speaker.company}`).join(', ');
}

export function Pills({ session }: { session: Session }) {
  return (
    <p className="pills">
      {session.stage_name ? (
        <span className="pill pill-stage">{session.stage_name}</span>
      ) : (
        session.location && <span className="pill pill-location">{session.location}</span>
      )}
      {session.format_label && <span className="pill pill-format">{session.format_label}</span>}
    </p>
  );
}

export function SeatLine({ session }: { session: Session }) {
  const seats = session.seats;
  if (!seats) return null;
  const open = seats.capacity > 0 ? Math.max(0, Math.min(1, seats.left / seats.capacity)) : 0;
  const full = seats.left <= 0;
  return (
    <div className={full ? 'seat is-full' : 'seat'}>
      <p className="seat-line">
        <span>
          {seats.left} of {seats.capacity} seats left
        </span>
        {full && <span className="pill pill-full">Full</span>}
      </p>
      <div className="seat-bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${open})` }} />
      </div>
      {session.waitlist_count !== null && session.waitlist_count > 0 && (
        <p className="waitlist-line">{session.waitlist_count} on the waitlist</p>
      )}
    </div>
  );
}

interface ActionsProps {
  session: Session;
  context: string;
  booking: Booking;
  viewer: Viewer;
}

export function SeatActions({ session, context, booking, viewer }: ActionsProps) {
  if (viewer === 'organiser') return null;
  const title = session.title;
  const pressed = booking.pending.get(session.id) ?? null;
  const refusal = booking.refusals.get(rowKey(context, session.id)) ?? null;
  const press = (action: BookingAction) => () => booking.run(action, session, context);
  const control = (action: BookingAction, slot: string, label: string, text: string, tone: string) => (
    <button
      key={slot}
      type="button"
      data-slot={slot}
      className={`btn ${tone}`}
      aria-label={label}
      aria-disabled={pressed === action ? 'true' : undefined}
      onClick={press(action)}
    >
      {text}
    </button>
  );

  const seats = session.seats;
  let state: ReactNode = null;
  let seatControls: ReactNode[] = [];
  if (seats) {
    if (session.my_hold) {
      state = <p className="hold-line">Seat held for you until {venueClock(session.my_hold.held_until)}</p>;
      seatControls = [
        control('claim', 'seat', `Claim seat for ${title}`, 'Claim seat', 'btn-primary is-held'),
        control('release', 'seat-second', `Release hold for ${title}`, 'Release hold', 'btn-outline is-held'),
      ];
    } else if (session.reserved_by_me) {
      state = <span className="pill pill-reserved">Reserved</span>;
      seatControls = [control('cancel', 'seat', `Cancel reservation for ${title}`, 'Cancel reservation', 'btn-outline')];
    } else if (session.waitlist_position !== null) {
      state = <span className="waitlist-position">Waitlist position {session.waitlist_position}</span>;
      seatControls = [control('leave', 'seat', `Leave waitlist for ${title}`, 'Leave waitlist', 'btn-outline')];
    } else if (seats.left > 0) {
      seatControls = [control('reserve', 'seat', `Reserve seat for ${title}`, 'Reserve seat', 'btn-primary')];
    } else {
      seatControls = [control('join', 'seat', `Join waitlist for ${title}`, 'Join waitlist', 'btn-dark')];
    }
  }

  const saved = session.saved_by_me;
  return (
    <div className="seat-actions">
      <button
        type="button"
        data-slot="save"
        className={saved ? 'btn btn-save is-saved' : 'btn btn-save'}
        aria-label={saved ? `Saved ${title}` : `Save ${title}`}
        aria-disabled={pressed === 'save' || pressed === 'unsave' ? 'true' : undefined}
        onClick={press(saved ? 'unsave' : 'save')}
      >
        {saved ? <CheckIcon /> : <PlusIcon />}
        {saved ? 'Saved' : 'Save'}
      </button>
      {state}
      {seatControls}
      {refusal && (
        <p className={refusal.code === 'time_conflict' || refusal.code === 'session_full' ? 'refusal refusal-warn' : 'refusal'}>
          {refusal.conflict ? (
            <>
              You already hold a seat in "<Link to={`/sessions/${encodeURIComponent(refusal.conflict.id)}`}>{refusal.conflict.title}</Link>" at
              that time.
            </>
          ) : (
            refusalCopy(refusal.code)
          )}
        </p>
      )}
    </div>
  );
}

interface RowProps extends ActionsProps {
  onFollow?: (sessionId: string) => void;
}

export function SessionRow({ session, context, booking, viewer, onFollow }: RowProps) {
  const speakers = speakerLine(session);
  return (
    <li className="session-row" data-row={rowKey(context, session.id)}>
      <p className="row-time">{timeRange(session.start_local, session.end_local)}</p>
      <div className="row-main">
        <h3 className="row-title">
          <Link
            to={`/sessions/${encodeURIComponent(session.id)}`}
            data-title-link={session.id}
            onClick={() => onFollow?.(session.id)}
          >
            {session.title}
          </Link>
        </h3>
        {speakers && <p className="speaker-line">{speakers}</p>}
        <Pills session={session} />
        <SeatLine session={session} />
        <SeatActions session={session} context={context} booking={booking} viewer={viewer} />
      </div>
    </li>
  );
}
