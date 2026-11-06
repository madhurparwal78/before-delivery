import type * as V2 from '../shared/api';
import { formatLabel, type SessionRecord, type SpeakerRecord, type StageRecord } from './agenda';
import { renderBio } from './bio';
import type { AccountRecord } from './accounts';
import type { ContestView, GuessRecord, LeaderRecord } from './contest';
import type { SeatCounts } from './booking';
import type { OrganiserRecord, RosterRecord } from './organiser';

// Response bodies, spelled out field by field for each version. Neither version is ever built
// from the other's object.

export function account(row: AccountRecord): V2.Account {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function auth(token: string, row: AccountRecord): V2.Auth {
  return { token, account: account(row) };
}

export function stage(row: StageRecord): V2.Stage {
  return { slug: row.slug, name: row.name, description: row.description };
}

function speakerRef(ref: { name: string; company: string }): V2.SpeakerRef {
  return { name: ref.name, company: ref.company };
}

export function guess(row: GuessRecord): V2.Guess {
  return { value: row.value, created_at: row.created_at };
}

function leader(row: LeaderRecord): V2.Leader {
  return { rank: row.rank, display_name: row.display_name, value: row.value, distance: row.distance };
}

export function record(view: ContestView): V2.ContestRecord {
  return {
    status: view.status,
    closes_at: view.closes_at,
    guess_count: view.guess_count,
    my_guess: view.my_guess === null ? null : guess(view.my_guess),
    final_figure: view.final_figure,
    revealed_at: view.revealed_at,
    leaderboard: view.leaderboard.map(leader),
  };
}

export function reveal(view: ContestView): V2.Reveal {
  return {
    status: view.status,
    final_figure: view.final_figure,
    revealed_at: view.revealed_at,
    leaderboard: view.leaderboard.map(leader),
  };
}

export function rosterRow(row: RosterRecord): V2.RosterRow {
  return { name: row.name, email: row.email, reserved_at: row.reserved_at };
}

export function reservation(row: { id: number; session_id: string; created_at: string }): V2.Reservation {
  return { id: row.id, session_id: row.session_id, created_at: row.created_at };
}

export function waitlist(row: { session_id: string; position: number; created_at: string }): V2.Waitlist {
  return { session_id: row.session_id, position: row.position, created_at: row.created_at };
}

export const v1 = {
  session(row: SessionRecord) {
    const reservable = row.capacity !== null;
    return {
      id: row.id,
      day: row.day,
      date: row.date,
      starts_at: row.start_local,
      ends_at: row.end_local,
      starts_at_utc: row.start_instant,
      ends_at_utc: row.end_instant,
      title: row.title,
      speakers: row.speakers.map(speakerRef),
      stage: row.stage,
      stage_name: row.stage_name,
      location: row.location,
      format: row.format,
      format_label: formatLabel(row.format),
      description: row.description,
      capacity: row.capacity,
      seats_left: reservable ? row.seats_left : null,
      waitlist_count: reservable ? row.waitlisted : null,
      reserved_by_me: row.reserved_by_me,
      saved_by_me: row.saved_by_me,
      waitlist_position: row.waitlist_position,
    };
  },
  speaker(row: SpeakerRecord) {
    return { name: row.name, company: row.company, sessions: row.sessions };
  },
  reservationCreated(created: { id: number; session_id: string; created_at: string }, seats: SeatCounts) {
    return { reservation: reservation(created), seats_left: seats.seats_left };
  },
  cancelled(seats: SeatCounts) {
    return { seats_left: seats.seats_left };
  },
  myAgenda(groups: { reserved: SessionRecord[]; waitlisted: SessionRecord[]; saved: SessionRecord[] }) {
    return {
      reserved: groups.reserved.map(v1.session),
      waitlisted: groups.waitlisted.map(v1.session),
      saved: groups.saved.map(v1.session),
    };
  },
  organiserRow(row: OrganiserRecord) {
    return {
      id: row.id,
      title: row.title,
      day: row.day,
      starts_at: row.start_local,
      ends_at: row.end_local,
      capacity: row.capacity,
      reserved: row.reserved + row.held,
      seats_left: row.seats_left,
      waitlisted: row.waitlisted,
    };
  },
};

function seats(counts: SeatCounts): V2.Seats {
  return { capacity: counts.capacity, reserved: counts.reserved, held: counts.held, left: counts.seats_left };
}

export const v2 = {
  session(row: SessionRecord): V2.Session {
    return {
      id: row.id,
      day: row.day,
      date: row.date,
      start_local: row.start_local,
      end_local: row.end_local,
      start_instant: row.start_instant,
      end_instant: row.end_instant,
      title: row.title,
      speakers: row.speakers.map(speakerRef),
      stage: row.stage,
      stage_name: row.stage_name,
      location: row.location,
      format: row.format,
      format_label: formatLabel(row.format),
      description: row.description,
      seats:
        row.capacity === null
          ? null
          : { capacity: row.capacity, reserved: row.reserved, held: row.held, left: row.seats_left },
      waitlist_count: row.capacity === null ? null : row.waitlisted,
      reserved_by_me: row.reserved_by_me,
      saved_by_me: row.saved_by_me,
      waitlist_position: row.waitlist_position,
      my_hold:
        row.hold_until === null
          ? null
          : { session_id: row.id, held_until: row.hold_until, seconds_remaining: row.hold_seconds ?? 0 },
    };
  },
  speaker(row: SpeakerRecord): V2.Speaker {
    return {
      slug: row.slug,
      name: row.name,
      company: row.company,
      sessions: row.sessions,
      bio: row.bio,
      bio_html: renderBio(row.bio),
    };
  },
  hold(row: { session_id: string; held_until: string; seconds_remaining: number }): V2.Hold {
    return { session_id: row.session_id, held_until: row.held_until, seconds_remaining: row.seconds_remaining };
  },
  reservationCreated(created: { id: number; session_id: string; created_at: string }, counts: SeatCounts): V2.ReservationCreated {
    return { reservation: reservation(created), seats: seats(counts) };
  },
  cancelled(counts: SeatCounts): V2.Cancelled {
    return { seats: seats(counts) };
  },
  myAgenda(groups: { reserved: SessionRecord[]; held: SessionRecord[]; waitlisted: SessionRecord[]; saved: SessionRecord[] }): V2.MyAgenda {
    return {
      reserved: groups.reserved.map(v2.session),
      held: groups.held.map(v2.session),
      waitlisted: groups.waitlisted.map(v2.session),
      saved: groups.saved.map(v2.session),
    };
  },
  organiserRow(row: OrganiserRecord): V2.OrganiserRow {
    return {
      id: row.id,
      title: row.title,
      day: row.day,
      start_local: row.start_local,
      end_local: row.end_local,
      seats: seats(row),
      waitlisted: row.waitlisted,
    };
  },
};
