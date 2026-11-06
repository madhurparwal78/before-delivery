import type { Base } from '../shared/bases.js';

/** A charter hold. */
export interface Hold {
  id: string;
  yachtSlug: string;
  weekStart: string;
  weekEnd: string;
  clientName: string;
  placedBy: { kind: 'member' | 'broker'; name: string };
  status: 'waiting' | 'live' | 'lapsed' | 'released' | 'charter';
  position: number | null;
  placedAt: string;
  liveSince: string | null;
  lapsesAt: string | null;
  charterId: string | null;
}

export interface YachtProfile {
  slug: string;
  name: string;
  base: Base;
  status: 'on_sale' | 'withdrawn';
  cabins: number;
  lengthM: string;
  beamM: string;
  draftM: string;
  batteryKwh: string;
  hotelKw: string;
  solarKw: string;
  dragKwPerKnCubed: string;
  shorePowerKw: number;
  rates: { lowMinor: number; shoulderMinor: number; highMinor: number };
  currency: 'EUR';
  crew: Array<{ id: string; name: string; position: string }>;
}

export interface Week {
  weekStart: string;
  weekEnd: string;
  status: 'free' | 'held' | 'booked';
  season: 'low' | 'shoulder' | 'high';
  weeklyRateMinor: number;
  currency: 'EUR';
  liveHoldId: string | null;
  waitingCount: number;
}

export type Season = 'low' | 'shoulder' | 'high';

export interface CharterLine {
  kind: 'charter_fee' | 'provisioning_allowance' | 'vat';
  label: string;
  eurMinor: number;
  amountMinor: number;
}

export interface Charter {
  id: string;
  holdId: string | null;
  yachtSlug: string;
  weekStart: string;
  weekEnd: string;
  clientName: string;
  clientEmail: string;
  currency: string;
  season: Season;
  depositDate: string;
  exchangeTableId: string | null;
  rate: string;
  lines: CharterLine[];
  totalEurMinor: number;
  totalMinor: number;
  invoiceStatus: 'invoiced' | 'not_invoiced';
  killbillInvoiceId: string | null;
  invoicedAt: string | null;
  status: 'open' | 'closed';
  closedAt: string | null;
  erasesAt: string | null;
}

export type RotaRule = 'min_rest_24h' | 'min_rest_168h' | 'rest_periods_24h' | 'max_gap_14h';

export const ROTA_RULE_TEXT: Record<RotaRule, string> = {
  max_gap_14h: 'no more than 14 hours between rest periods',
  min_rest_24h: 'at least 10 hours of rest in any 24 hours',
  min_rest_168h: 'at least 77 hours of rest in any 7 days',
  rest_periods_24h: 'rest in no more than two periods, one of at least 6 hours',
};
