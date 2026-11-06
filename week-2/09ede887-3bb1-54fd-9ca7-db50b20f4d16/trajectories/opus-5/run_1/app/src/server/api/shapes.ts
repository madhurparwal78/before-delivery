import type { Account } from '../db/accounts.js';
import type { HoldRow, OrganiserRow, RosterRow, Session, SpeakerDetail, StageRow } from '../db/reads.js';
import type { SeatCounts, ReservationRow, WaitlistRow } from '../db/booking.js';
import type { ContestState } from '../db/contest.js';
import type { Leader } from '../domain/leaderboard.js';
import { renderBio } from '../domain/bio.js';
import { formatLabel } from './versions.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function instant(value: Date): string {
  return value.toISOString();
}

export function accountV1(account: Account): Json {
  return { id: account.id, name: account.name, email: account.email, role: account.role };
}

export function authV1(token: string, account: Account): Json {
  return { token, account: accountV1(account) };
}

export function signedOut(): Json {
  return { signed_out: true };
}

export function stageV1(stage: StageRow): Json {
  return { slug: stage.slug, name: stage.name, description: stage.description };
}

function speakerRefs(session: Session): Json[] {
  return session.speakers.map((speaker) => ({ name: speaker.name, company: speaker.company }));
}

function seatsLeft(session: Session): number | null {
  return session.capacity === null ? null : session.capacity - session.reserved - session.held;
}

export function sessionV1(session: Session): Json {
  return {
    id: session.id,
    day: session.day,
    date: session.date,
    starts_at: session.start_local,
    ends_at: session.end_local,
    starts_at_utc: instant(session.start_instant),
    ends_at_utc: instant(session.end_instant),
    title: session.title,
    speakers: speakerRefs(session),
    stage: session.stage,
    stage_name: session.stage_name,
    location: session.location,
    format: session.format,
    format_label: formatLabel(session.format),
    description: session.description,
    capacity: session.capacity,
    seats_left: seatsLeft(session),
    waitlist_count: session.capacity === null ? null : session.waitlist_count,
    reserved_by_me: session.reserved_by_me,
    saved_by_me: session.saved_by_me,
    waitlist_position: session.waitlist_position,
  };
}

export function sessionV2(session: Session): Json {
  return {
    id: session.id,
    day: session.day,
    date: session.date,
    start_local: session.start_local,
    end_local: session.end_local,
    start_instant: instant(session.start_instant),
    end_instant: instant(session.end_instant),
    title: session.title,
    speakers: speakerRefs(session),
    stage: session.stage,
    stage_name: session.stage_name,
    location: session.location,
    format: session.format,
    format_label: formatLabel(session.format),
    description: session.description,
    seats:
      session.capacity === null
        ? null
        : {
            capacity: session.capacity,
            reserved: session.reserved,
            held: session.held,
            left: session.capacity - session.reserved - session.held,
          },
    waitlist_count: session.capacity === null ? null : session.waitlist_count,
    reserved_by_me: session.reserved_by_me,
    saved_by_me: session.saved_by_me,
    waitlist_position: session.waitlist_position,
    my_hold:
      session.my_hold_until === null
        ? null
        : {
            session_id: session.id,
            held_until: instant(session.my_hold_until),
            seconds_remaining: session.my_hold_seconds ?? 0,
          },
  };
}

export function holdV2(hold: HoldRow): Json {
  return {
    session_id: hold.session_id,
    held_until: instant(hold.held_until),
    seconds_remaining: hold.seconds_remaining,
  };
}

function reservation(row: ReservationRow): Json {
  return { id: row.id, session_id: row.sessionId, created_at: instant(row.createdAt) };
}

export function reservationCreatedV1(row: ReservationRow, seats: SeatCounts): Json {
  return {
    reservation: reservation(row),
    seats_left: (seats.capacity ?? 0) - seats.reserved - seats.held,
  };
}

export function reservationCreatedV2(row: ReservationRow, seats: SeatCounts): Json {
  return { reservation: reservation(row), seats: seatsV2(seats) };
}

export function seatsV2(seats: SeatCounts): Json {
  const capacity = seats.capacity ?? 0;
  return { capacity, reserved: seats.reserved, held: seats.held, left: capacity - seats.reserved - seats.held };
}

export function cancelledV1(seats: SeatCounts): Json {
  return { seats_left: (seats.capacity ?? 0) - seats.reserved - seats.held };
}

export function cancelledV2(seats: SeatCounts): Json {
  return { seats: seatsV2(seats) };
}

export function releasedV2(): Json {
  return { held: false };
}

function waitlist(row: WaitlistRow): Json {
  return { session_id: row.sessionId, position: row.position, created_at: instant(row.createdAt) };
}

export function waitlistJoined(row: WaitlistRow): Json {
  return { waitlist: waitlist(row) };
}

export function waitlistLeft(): Json {
  return { waitlisted: false };
}

export function savedShape(saved: boolean): Json {
  return { saved };
}

export function myAgendaV1(reserved: Session[], waitlisted: Session[], saved: Session[]): Json {
  return {
    reserved: reserved.map(sessionV1),
    waitlisted: waitlisted.map(sessionV1),
    saved: saved.map(sessionV1),
  };
}

export function myAgendaV2(reserved: Session[], held: Session[], waitlisted: Session[], saved: Session[]): Json {
  return {
    reserved: reserved.map(sessionV2),
    held: held.map(sessionV2),
    waitlisted: waitlisted.map(sessionV2),
    saved: saved.map(sessionV2),
  };
}

export function speakerV1(speaker: SpeakerDetail): Json {
  return { name: speaker.name, company: speaker.company, sessions: [...speaker.sessions] };
}

export function speakerV2(speaker: SpeakerDetail): Json {
  return {
    slug: speaker.slug,
    name: speaker.name,
    company: speaker.company,
    sessions: [...speaker.sessions],
    bio: speaker.bio,
    bio_html: renderBio(speaker.bio),
  };
}

export function organiserRowV1(row: OrganiserRow): Json {
  return {
    id: row.id,
    title: row.title,
    day: row.day,
    starts_at: row.start_local,
    ends_at: row.end_local,
    capacity: row.capacity,
    reserved: row.reserved + row.held,
    seats_left: row.capacity - row.reserved - row.held,
    waitlisted: row.waitlisted,
  };
}

export function organiserRowV2(row: OrganiserRow): Json {
  return {
    id: row.id,
    title: row.title,
    day: row.day,
    start_local: row.start_local,
    end_local: row.end_local,
    seats: {
      capacity: row.capacity,
      reserved: row.reserved,
      held: row.held,
      left: row.capacity - row.reserved - row.held,
    },
    waitlisted: row.waitlisted,
  };
}

export function rosterRow(row: RosterRow): Json {
  return { name: row.name, email: row.email, reserved_at: instant(row.reserved_at) };
}

function leaders(list: readonly Leader[]): Json[] {
  return list.map((leader) => ({
    rank: leader.rank,
    display_name: leader.displayName,
    value: leader.value,
    distance: leader.distance,
  }));
}

export function recordShape(state: ContestState): Json {
  return {
    status: state.status,
    closes_at: state.closesAt,
    guess_count: state.guessCount,
    my_guess:
      state.myGuess === null
        ? null
        : { value: state.myGuess.value, created_at: instant(state.myGuess.createdAt) },
    final_figure: state.finalFigure,
    revealed_at: state.revealedAt === null ? null : instant(state.revealedAt),
    leaderboard: leaders(state.leaderboard),
  };
}

export function guessCreated(guess: { readonly value: number; readonly createdAt: Date }): Json {
  return { guess: { value: guess.value, created_at: instant(guess.createdAt) } };
}

export function revealShape(state: ContestState): Json {
  return {
    status: state.status,
    final_figure: state.finalFigure,
    revealed_at: state.revealedAt === null ? null : instant(state.revealedAt),
    leaderboard: leaders(state.leaderboard),
  };
}
