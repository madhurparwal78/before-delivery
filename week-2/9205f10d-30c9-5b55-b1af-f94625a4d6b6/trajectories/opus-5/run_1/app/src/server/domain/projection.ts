import type { RequestView, Seat, SeatInterpreter } from '../../shared/types.js';
import type { Actor } from '../http/context.js';
import type { HistoryRow, InterpreterRow, LoadedRequest, SeatRow } from '../store/requests.js';
import { agencyDateOf, toAgencyIso } from './agency-time.js';
import { credentialBadges } from './eligibility.js';
import { freeCancelUntil } from './cutoff.js';

const CLAIMABLE_STATUSES = ['submitted', 'half-staffed'] as const;

export function endsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

export function holdsConfirmedSeat(seats: readonly SeatRow[], personId: string): boolean {
  return seats.some((seat) => seat.status === 'confirmed' && seat.interpreter_id === personId);
}

/** The one read-visibility rule for a request. */
export function mayReadRequest(actor: Actor, loaded: LoadedRequest): boolean {
  switch (actor.role) {
    case 'coordinator':
    case 'billing_admin':
      return true;
    case 'client_scheduler':
      return actor.organisation !== null && actor.organisation.id === loaded.row.organisation_id;
    case 'interpreter':
      return (
        holdsConfirmedSeat(loaded.seats, actor.id) ||
        (CLAIMABLE_STATUSES as readonly string[]).includes(loaded.row.status)
      );
  }
}

function seesPrivateDetails(actor: Actor, loaded: LoadedRequest): boolean {
  switch (actor.role) {
    case 'coordinator':
    case 'billing_admin':
      return true;
    case 'client_scheduler':
      return actor.organisation !== null && actor.organisation.id === loaded.row.organisation_id;
    case 'interpreter':
      return holdsConfirmedSeat(loaded.seats, actor.id);
  }
}

function projectSeatInterpreter(
  actor: Actor,
  interpreter: InterpreterRow,
  today: string,
  teammate: boolean,
): SeatInterpreter | null {
  const credentials = credentialBadges(interpreter.credentials, today);
  switch (actor.role) {
    case 'coordinator':
    case 'billing_admin':
      return {
        id: interpreter.id,
        display_name: interpreter.display_name,
        full_name: interpreter.full_name,
        email: interpreter.email,
        phone: interpreter.phone,
        home_area: interpreter.home_area,
        pay_rate: interpreter.pay_rate,
        credentials,
      };
    case 'client_scheduler':
      return { display_name: interpreter.display_name, credentials };
    case 'interpreter':
      return teammate
        ? { display_name: interpreter.display_name, credentials, phone: interpreter.phone }
        : null;
  }
}

export function projectSeats(actor: Actor, loaded: LoadedRequest, today: string): Seat[] {
  const teammate = actor.role === 'interpreter' && holdsConfirmedSeat(loaded.seats, actor.id);
  return [...loaded.seats]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((seat) => {
      const interpreter =
        seat.status === 'confirmed' && seat.interpreter_id !== null
          ? loaded.interpreters.get(seat.interpreter_id)
          : undefined;
      return {
        id: seat.id,
        label: seat.label,
        status: seat.status,
        interpreter: interpreter
          ? projectSeatInterpreter(actor, interpreter, today, teammate)
          : null,
      };
    });
}

/** The one place that decides which request fields each role receives. */
export function projectRequest(
  actor: Actor,
  loaded: LoadedRequest,
  history: HistoryRow[] | null,
  now: Date,
): RequestView {
  const today = agencyDateOf(now);
  const { row } = loaded;
  const base: RequestView = {
    id: row.id,
    reference: row.reference,
    setting: row.setting,
    required_credential: row.required_credential,
    starts_at: toAgencyIso(row.starts_at),
    ends_at: toAgencyIso(endsAt(row.starts_at, row.duration_minutes)),
    duration_minutes: row.duration_minutes,
    city: row.city,
    status: row.status,
    team_size: row.team_size,
    rotation_minutes: row.rotation_minutes,
    seats: projectSeats(actor, loaded, today),
  };

  const privateDetails = seesPrivateDetails(actor, loaded);
  if (actor.role === 'interpreter') {
    if (privateDetails) {
      base.consumer_name = row.consumer_name;
      base.location_address = row.location_address;
      base.notes = row.notes;
    }
    return base;
  }

  base.organisation = {
    id: row.organisation_id,
    name: row.organisation_name,
    code: row.organisation_code,
  };
  base.free_cancel_until = toAgencyIso(freeCancelUntil(row.starts_at));
  base.consumer_name = row.consumer_name;
  base.location_address = row.location_address;
  base.notes = row.notes;
  base.hourly_rate = row.hourly_rate;
  base.actual_minutes = row.actual_minutes;

  if (actor.role === 'coordinator' || actor.role === 'billing_admin') {
    base.team_reason = row.team_reason;
    base.history =
      history === null
        ? []
        : history.map((entry) => ({
            at: toAgencyIso(entry.at),
            actor: entry.actor,
            action: entry.action,
            detail: entry.detail,
          }));
  }
  return base;
}
