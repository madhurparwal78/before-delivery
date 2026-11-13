import type { Currency, Lang } from './i18n'

export type ReasonCode = 'release' | 'no_arrival' | 'no_departure' | 'min_stay' | 'max_stay' | 'stop_sell' | 'sold_out'
export interface Reason { code: ReasonCode; date?: string; n?: number }

export type Plan = 'refundable' | 'nonrefundable'
export type NightState = 'base' | 'discount' | 'held' | 'closed'

export interface PolicyTier { days_before: number; hour: number; refund_pct: number }

export interface Line { key: string; minor: number }
export interface QuoteRoomNight { date: string; lines: Line[]; total_minor: number; taxable_minor: number }
export interface QuoteRoom { room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[]; nights: QuoteRoomNight[]; total_minor: number }
export interface QuoteNight {
  date: string; total_minor: number; taxable_minor: number; converted_minor: number; converted_taxable_minor: number
  state: NightState; lines: Line[]
}
export interface Quote {
  id: string | null; property: string; in: string; out: string; nights_count: number; currency: Currency; tier: string
  rates_ppm: Record<Currency, number>; rooms: QuoteRoom[]; nights: QuoteNight[]; total_minor: number; taxable_minor: number
  converted_total_minor: number; converted_taxable_minor: number; expires_at: string | null; hold_id: string | null
}

export type Advice = { code: 'capacity'; n: number; m: number } | { code: 'adult' } | { code: 'left'; n: number; room_type: string }

export interface RoomChoiceRoom { room_type: string; adults: number; ages: number[] }
export interface Recommendation { rooms: RoomChoiceRoom[]; total_minor: number }

export interface Me {
  user: { username: string; role: 'guest' | 'manager' | 'operator'; manages: string[] } | null
  lang: Lang; cur: Currency; tier: string; completed_stays: number; perks: string[]
}

export interface SearchNotice { key: string; name?: string; date?: string; n?: number; value?: string }
export interface SearchResult {
  code: string; name: string; stars: number; score: number; distance_km: number; x: number; y: number; total_minor: number
  avg_night_minor: number; display_minor: number; display_currency: Currency; refundable: boolean; rank: number
}
export interface SearchResponse {
  canonical: string; notices: SearchNotice[]; count: number; results: SearchResult[]
  counts: { stars: Record<string, number>; amen: Record<string, number>; free: number }
  histogram: { from_minor: number; to_minor: number | null; count: number }[]
  pins: { code: string; name: string; x: number; y: number; score: number; display_minor: number }[]
  next_cursor: string | null
}

export interface DestinationRow { code: string; name: string; zone: string; cx: number; cy: number; property_count: number }
export interface DateDay { date: string; available: boolean; from_minor: number | null; min_stay: number | null; reason: Reason | null; after_start: 'before' | 'short' | null }

export interface PropertyView {
  code: string; name: string; zone: string; stars: number; amenities: string[]; score: number; distance_km: number
  pictures: string[]; policy: PolicyTier[]
  room_types: { code: string; name: string; max_adults: number; max_guests: number; left: number }[]
  recommendation: Recommendation | null
}

export interface LedgerEntry { id: number; pair: number; kind: 'charge' | 'refund' | 'change'; account: 'guest' | 'property'; debit_minor: number; credit_minor: number; at: string }
export interface CancellationTier { kind: 'free' | 'partial' | 'none'; refund_pct: number; deadline_utc: string; deadline_local: string }
export interface BookingRoom {
  n: number; room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[]; state: string
  paid_minor: number; refunded_minor: number; nights: QuoteRoomNight[]
}
export interface Booking {
  code: string; version: number; state: string; property: { code: string; name: string; zone: string }; in: string; out: string
  given_name: string; surname: string; card_last4: string; quote_currency: Currency; rooms: BookingRoom[]
  total_minor: number; paid_minor: number; refunded_minor: number
  cancellation: { tiers: CancellationTier[]; status: { kind: CancellationTier['kind']; refund_pct: number; until_utc: string | null } }
  no_show_open: boolean; ledger: LedgerEntry[]; balance_minor: number
  approx_minor: number; nights: QuoteNight[]
}

export interface CalendarCell {
  room_type: string; date: string; rate_minor: number; allotment: number; left: number; min_stay: number; max_stay: number
  closed_to_arrival: boolean; closed_to_departure: boolean; stop_sell: boolean; release_days: number
}
