import type { LoadStatus, Outcome, PieceStatus } from '../shared/labels.ts';

export interface Ticket {
  readonly id: string;
  readonly title: string;
  readonly status: PieceStatus;
  readonly clay_body: string;
  readonly length_in: number;
  readonly width_in: number;
  readonly height_in: number;
  readonly photo_url: string | null;
  readonly owner_handle: string;
  readonly waiting_since: string | null;
}

export interface Charge {
  readonly id: string;
  readonly piece_id: string;
  readonly piece_title: string;
  readonly firing: 'bisque' | 'glaze' | 'storage';
  readonly storage_day: string | null;
  readonly cubic_inches: number | null;
  readonly rate_cents: number;
  readonly fee_cents: number;
  readonly status: 'pending' | 'settled' | 'refund_pending' | 'refunded';
  readonly funding: 'credit' | 'card' | null;
  readonly created_at: string;
  readonly settled_at: string | null;
  readonly refunded_at: string | null;
}

export interface Quote {
  readonly quoted_at: string;
  readonly rates_effective_from: string;
  readonly membership: 'member' | 'drop_off';
  readonly bisque: { rate_cents: number; fee_cents: number };
  readonly glaze: { rate_cents: number; fee_cents: number };
}

export interface Passport extends Ticket {
  readonly rounded: { length_in: number; width_in: number; height_in: number };
  readonly cubic_inches: number;
  readonly quote: Quote;
  readonly location: { load_id: string; kiln_name: string; deck: number } | null;
  readonly outcomes: { bisque: Outcome | null; glaze: Outcome | null };
  readonly charges: readonly Charge[];
  readonly history: readonly { status: PieceStatus; at: string }[];
  readonly pickup_deadline: string | null;
}

export interface Deck {
  readonly number: number;
  readonly post_height_in: number;
  readonly deck_height_in: number;
  readonly footprint_sq_in: number;
  readonly footprint_pct: number;
  readonly pieces: readonly Ticket[];
}

export interface Load {
  readonly id: string;
  readonly kiln: {
    id: string;
    name: string;
    stack_height_in: number;
    shelf_area_sq_in: number;
  };
  readonly firing: 'bisque' | 'glaze';
  readonly status: LoadStatus;
  readonly headroom_in: number;
  readonly value_cents: number;
  readonly decks: readonly Deck[];
  readonly created_at: string;
  readonly unloaded_at: string | null;
}

export interface Entry {
  readonly id: string;
  readonly movement_id: string;
  readonly account: string;
  readonly amount_cents: number;
  readonly kind: string;
  readonly charge_id: string | null;
  readonly created_at: string;
}

export interface CreditView {
  readonly balance_cents: number;
  readonly card_status: 'none' | 'on_file';
  readonly entries: readonly Entry[];
}

export interface Pack {
  readonly id: string;
  readonly name: string;
  readonly amount_cents: number;
}

export interface Kiln {
  readonly id: string;
  readonly name: string;
  readonly stack_height_in: number;
  readonly shelf_area_sq_in: number;
}

export interface ClayBody {
  readonly id: string;
  readonly name: string;
}

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly email: string;
  readonly membership: 'member' | 'drop_off';
  readonly card_status: 'none' | 'on_file';
  readonly active: boolean;
  readonly balance_cents: number;
}

export interface MemberDetail extends Member {
  readonly entries: readonly Entry[];
  readonly charges: readonly Charge[];
}

export interface Dashboard {
  readonly today: string;
  readonly counts: Record<string, number>;
  readonly longest_waiting: readonly {
    id: string;
    title: string;
    owner_handle: string;
    status: PieceStatus;
    days_waiting: number;
  }[];
  readonly pending_charges: number;
  readonly month_revenue_cents: number;
}

export interface Revenue {
  readonly month: string;
  readonly closed_at: string | null;
  readonly fees_cents: number;
  readonly refunds_cents: number;
  readonly net_cents: number;
  readonly charge_count: number;
}

export interface FiringLog {
  readonly date: string;
  readonly time_zone: string;
  readonly firings: readonly {
    load_id: string;
    kiln_name: string;
    firing: 'bisque' | 'glaze';
    unloaded_at: string;
    piece_count: number;
    value_cents: number;
  }[];
}

export interface RateSchedule {
  readonly id: string;
  readonly effective_from: string;
  readonly member_bisque_cents: number;
  readonly member_glaze_cents: number;
  readonly dropoff_bisque_cents: number;
  readonly dropoff_glaze_cents: number;
}
