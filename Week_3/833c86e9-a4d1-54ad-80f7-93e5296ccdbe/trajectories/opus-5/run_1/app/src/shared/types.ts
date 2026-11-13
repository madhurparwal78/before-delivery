export type Lang = 'en' | 'de' | 'ar';
export type Cur = 'EUR' | 'USD' | 'JPY' | 'KWD';

export const LANGS: Lang[] = ['en', 'de', 'ar'];
export const CURS: Cur[] = ['EUR', 'USD', 'JPY', 'KWD'];

export const CURRENCY_DECIMALS: Record<Cur, number> = { EUR: 2, USD: 2, JPY: 0, KWD: 3 };

export type CurrencyTable = Record<Cur, number>;

export type PlanCode = 'refundable' | 'nonrefundable';

export type PriceLineKey =
  | 'plan_rate'
  | 'occupancy'
  | 'children'
  | 'length_of_stay'
  | 'early_booking'
  | 'last_minute'
  | 'loyalty'
  | 'breakfast'
  | 'vat'
  | 'city_tax'
  | 'tourism_levy'
  | 'night_total';

export const PRICE_LINE_ORDER: PriceLineKey[] = [
  'plan_rate',
  'occupancy',
  'children',
  'length_of_stay',
  'early_booking',
  'last_minute',
  'loyalty',
  'breakfast',
  'vat',
  'city_tax',
  'tourism_levy',
  'night_total',
];

export type NightState = 'base' | 'discount' | 'held' | 'closed';

export type ReasonCode =
  | 'release'
  | 'no_arrival'
  | 'no_departure'
  | 'min_stay'
  | 'max_stay'
  | 'stop_sell'
  | 'sold_out';

export interface Reason {
  code: ReasonCode;
  date?: string;
  n?: number;
}

export type TierName = 'Wren' | 'Heron' | 'Kestrel';

export const AMENITIES = ['pool', 'parking', 'wifi', 'spa', 'pets'] as const;
export type Amenity = (typeof AMENITIES)[number];

export type SortKey = 'rank' | 'price_asc' | 'price_desc' | 'score_desc' | 'distance_asc';
export const SORTS: SortKey[] = ['rank', 'price_asc', 'price_desc', 'score_desc', 'distance_asc'];

export type DisplayMode = 'total' | 'night';

export interface PriceLine {
  key: PriceLineKey;
  minor: number;
}

export interface QuoteNightRoom {
  date: string;
  lines: PriceLine[];
  total_minor: number;
  taxable_minor: number;
}

export interface QuoteRoom {
  room_type: string;
  plan: PlanCode;
  breakfast: boolean;
  adults: number;
  ages: number[];
  nights: QuoteNightRoom[];
  total_minor: number;
}

export interface QuoteNight {
  date: string;
  total_minor: number;
  taxable_minor: number;
  converted_minor: number;
  converted_taxable_minor: number;
  lines?: PriceLine[];
  state: NightState;
}

export interface Quote {
  id: string;
  property: string;
  in: string;
  out: string;
  nights_count: number;
  currency: Cur;
  tier: TierName;
  rates_ppm: CurrencyTable;
  rooms: QuoteRoom[];
  nights: QuoteNight[];
  total_minor: number;
  taxable_minor: number;
  converted_total_minor: number;
  converted_taxable_minor: number;
  expires_at: string;
  hold_id: string | null;
  hold_expires_at: string | null;
}

export interface LedgerEntry {
  id: number;
  pair: number;
  kind: 'charge' | 'refund' | 'change';
  account: 'guest' | 'property';
  debit_minor: number;
  credit_minor: number;
  at: string;
}

export interface CancellationTier {
  refund_pct: number;
  deadline_utc: string;
  deadline_local: string;
}

export interface BookingRoom {
  n: number;
  room_type: string;
  plan: PlanCode;
  breakfast: boolean;
  adults: number;
  ages: number[];
  state: string;
  paid_minor: number;
  refunded_minor: number;
  nights: QuoteNightRoom[];
}

export interface Booking {
  code: string;
  version: number;
  state: string;
  property: { code: string; name: string; zone: string };
  in: string;
  out: string;
  given_name: string;
  surname: string;
  card_last4: string;
  quote_currency: Cur;
  rooms: BookingRoom[];
  total_minor: number;
  paid_minor: number;
  refunded_minor: number;
  converted_total_minor: number;
  cancellation: {
    tiers: CancellationTier[];
    status: {
      kind: 'free' | 'partial' | 'none';
      refund_pct: number;
      until_utc: string | null;
    };
  };
  no_show_open: boolean;
  ledger: LedgerEntry[];
  balance_minor: number;
}

export interface SearchResult {
  code: string;
  name: string;
  stars: number;
  score: number;
  distance_km: number;
  x: number;
  y: number;
  total_minor: number;
  avg_night_minor: number;
  display_minor: number;
  display_currency: Cur;
  refundable: boolean;
  rank: number;
}

export interface SearchNotice {
  key: string;
  name?: string;
  date?: string;
  n?: number;
  value?: string;
}

export interface SearchResponse {
  canonical: string;
  notices: SearchNotice[];
  count: number;
  results: SearchResult[];
  counts: {
    stars: Record<string, number>;
    amen: Record<string, number>;
    free: number;
  };
  histogram: { from_minor: number; count: number }[];
  pins: { code: string; name: string; x: number; y: number; score: number; display_minor: number }[];
  next_cursor: string | null;
}

export interface DayInfo {
  date: string;
  available: boolean;
  from_minor: number | null;
  min_stay: number;
  reason: Reason | null;
  after_start: 'before' | 'short' | null;
}
