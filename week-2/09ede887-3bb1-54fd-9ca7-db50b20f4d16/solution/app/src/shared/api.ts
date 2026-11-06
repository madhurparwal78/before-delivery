// The v2 JSON contract, shared by the server's v2 serialisers and the browser.

type Role = 'attendee' | 'organiser';

export interface Account {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Auth {
  token: string;
  account: Account;
}

export interface Stage {
  slug: string;
  name: string;
  description: string;
}

export interface SpeakerRef {
  name: string;
  company: string;
}

export interface Seats {
  capacity: number;
  reserved: number;
  held: number;
  left: number;
}

export interface Hold {
  session_id: string;
  held_until: string;
  seconds_remaining: number;
}

export interface Session {
  id: string;
  day: number;
  date: string;
  start_local: string;
  end_local: string;
  start_instant: string;
  end_instant: string;
  title: string;
  speakers: SpeakerRef[];
  stage: string | null;
  stage_name: string | null;
  location: string | null;
  format: string | null;
  format_label: string | null;
  description: string;
  seats: Seats | null;
  waitlist_count: number | null;
  reserved_by_me: boolean;
  saved_by_me: boolean;
  waitlist_position: number | null;
  my_hold: Hold | null;
}

export interface Speaker {
  slug: string;
  name: string;
  company: string;
  sessions: string[];
  bio: string;
  bio_html: string;
}

export interface Reservation {
  id: number;
  session_id: string;
  created_at: string;
}

export interface ReservationCreated {
  reservation: Reservation;
  seats: Seats;
}

export interface Cancelled {
  seats: Seats;
}

export interface Waitlist {
  session_id: string;
  position: number;
  created_at: string;
}

export interface WaitlistJoined {
  waitlist: Waitlist;
}

export interface MyAgenda {
  reserved: Session[];
  held: Session[];
  waitlisted: Session[];
  saved: Session[];
}

export interface OrganiserRow {
  id: string;
  title: string;
  day: number;
  start_local: string;
  end_local: string;
  seats: Seats;
  waitlisted: number;
}

export interface RosterRow {
  name: string;
  email: string;
  reserved_at: string;
}

export type ContestStatus = 'open' | 'closed' | 'revealed';

export interface Guess {
  value: number;
  created_at: string;
}

export interface Leader {
  rank: number;
  display_name: string;
  value: number;
  distance: number;
}

export interface ContestRecord {
  status: ContestStatus;
  closes_at: string;
  guess_count: number;
  my_guess: Guess | null;
  final_figure: number | null;
  revealed_at: string | null;
  leaderboard: Leader[];
}

export interface Reveal {
  status: ContestStatus;
  final_figure: number | null;
  revealed_at: string | null;
  leaderboard: Leader[];
}

export interface ErrorDetail {
  code: string;
  message: string;
  fields?: Record<string, string>;
  conflicts_with?: string;
  reserved?: number;
}
