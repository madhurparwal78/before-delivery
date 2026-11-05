import { api } from "./api.js";

export interface Account {
  id: string;
  name: string;
  email: string;
  role: "practitioner" | "clinic" | "registrar" | "director" | "frontdesk";
  clinic_name?: string | null;
}

export interface Reservation {
  id: string;
  bench: string;
  tier: "bench" | "atelier";
  state: string;
  group_id: string | null;
  buyer: { name: string; kind: string };
  attendee: { name: string; email: string; accepted: boolean } | null;
  price_cents: number;
  paid_cents: number;
  balance_cents: number;
  refund_due_cents: number | null;
  hold: { expires_at: string; seconds_remaining: number; duration_seconds: number } | null;
  payment_pending: string | null;
  licence_status: string;
  passport_status: string;
  checked_in: { day1: boolean; day2: boolean };
  documents: string[];
}

export interface BenchState {
  server_time: string;
  venue_date: string;
  deposits_open: boolean;
  seats_total: number;
  seats_remaining: number;
  held: number;
  sold: number;
  tiers: {
    bench: { remaining: number };
    atelier: { remaining: number; cap: number; active: number; sold_out: boolean };
  };
  benches: { label: string; row: string; number: number; tier: string; state: string }[];
}

export interface Me {
  account: Account;
  reservations: Reservation[];
  groups: { id: string; state: string }[];
  waitlist: { tier: string; position: number } | null;
  offers: { id: string; bench: string; tier: string; state: string; seconds_remaining: number }[];
  venue_date: string;
  deposits_open: boolean;
  server_time: string;
}

export interface Content {
  sessions: Session[];
  hospitality: Evening[];
  hotels: Hotel[];
  faq: FaqEntry[];
}

export interface Session {
  id: string;
  number: number;
  day: number;
  title: string;
  format: "lecture" | "hands-on";
  minutes: number;
  outcomes: string;
}

export interface Evening {
  id: string;
  title: string;
  day: number;
  tier: "all" | "atelier";
  gated: boolean;
  starts_at?: string;
  venue?: string;
  description?: string;
}

export interface Hotel {
  id: string;
  name: string;
  distance: string;
  rate: string;
  map_url: string;
}

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  sort: number;
}

/** The app state, refreshed from the server on every poll. */
export const state: {
  me: Me | null;
  benches: BenchState | null;
  content: Content | null;
  contentDown: boolean;
  billingDown: boolean;
} = {
  me: null,
  benches: null,
  content: null,
  contentDown: false,
  billingDown: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(): void {
  for (const fn of listeners) fn();
}

export async function refreshMe(): Promise<void> {
  try {
    state.me = await api<Me>("/api/me");
  } catch (e) {
    if (e instanceof Error && "status" in e && (e as { status: number }).status === 401) {
      state.me = null;
    } else if ((e as { status?: number }).status === 401) {
      state.me = null;
    }
  }
}

export async function refreshBenches(): Promise<void> {
  try {
    state.benches = await api<BenchState>("/api/benches");
  } catch {
    /* keep the last known state */
  }
}

export async function refreshContent(): Promise<void> {
  try {
    state.content = await api<Content>("/api/content");
    state.contentDown = false;
  } catch {
    state.contentDown = true;
  }
}
