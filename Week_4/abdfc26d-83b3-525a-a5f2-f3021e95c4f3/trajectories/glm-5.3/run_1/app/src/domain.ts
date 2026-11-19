import { createHash } from 'node:crypto';
import type { OrderState, PieceState, Render, RenderFailure, Easing } from './types.js';

export const EASINGS: Easing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

export const EASING_LABELS: Record<Easing, string> = {
  'linear': 'Linear',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in-out'
};

export const EASING_FROM_LABEL: Record<string, Easing> = {
  'Linear': 'linear',
  'Ease in': 'ease-in',
  'Ease out': 'ease-out',
  'Ease in-out': 'ease-in-out'
};

export function isEasing(raw: unknown): raw is Easing {
  return typeof raw === 'string' && EASINGS.includes(raw as Easing);
}

// ---------------------------------------------------------------- piece states

export const PIECE_STATES: PieceState[] = ['draft', 'published', 'withdrawn'];

export function canPublishPiece(state: PieceState): boolean { return state === 'draft'; }
export function canWithdrawPiece(state: PieceState): boolean { return state === 'published'; }
export function isWorkingState(state: PieceState): boolean { return state === 'draft'; }

// ---------------------------------------------------------------- render cost

export function renderCost(resolution: '720p' | '1080p', duration_s: number): number {
  return duration_s * (resolution === '1080p' ? 2 : 1);
}

export const MAX_RENDER_ATTEMPTS = 3;

export const RENDER_TERMINAL: readonly string[] = ['ready', 'credits_released'];

export function renderEndedInError(render: { history: { state: string }[]; failure_reason: RenderFailure | null }): boolean {
  if (render.failure_reason !== null && render.failure_reason !== 'cancelled') return true;
  return render.history.some((event) => event.state === 'failed' || event.state === 'timed_out');
}

export function renderActive(render: Render): boolean {
  return render.state === 'accepted' || render.state === 'queued' || render.state === 'rendering' || render.state === 'stored';
}

// ---------------------------------------------------------------- hold timing

export function secondsLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

export function holdExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

// ---------------------------------------------------------------- seeds

export function editionSeedHash(slug: string, n: number): string {
  return createHash('sha256').update(`${slug}:${n}`, 'utf8').digest('hex').slice(0, 16);
}

export function editionSeedUnit(hash: string): number {
  const head = Number.parseInt(hash.slice(0, 8), 16);
  return head / 4294967295;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------- VAT

export const VAT_RATES: Record<string, number> = {
  US: 0, GB: 20, DE: 19, FR: 20, NL: 21, IE: 23, SE: 25
};

export const VAT_COUNTRY_OPTIONS: { label: string; value: string }[] = [
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'GB' },
  { label: 'Germany', value: 'DE' },
  { label: 'France', value: 'FR' },
  { label: 'Netherlands', value: 'NL' },
  { label: 'Ireland', value: 'IE' },
  { label: 'Sweden', value: 'SE' },
  { label: 'Other country', value: 'OTHER' }
];

export function vatSupported(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(VAT_RATES, code);
}

export function vatRate(code: string): number {
  return VAT_RATES[code] ?? 0;
}

/** VAT = net × rate, rounded half up to the cent. */
export function vatOf(netCents: number, ratePercent: number): number {
  return Math.floor((netCents * ratePercent) / 100 + 0.5);
}

export function grossOf(netCents: number, vatCents: number): number {
  return netCents + vatCents;
}

// ---------------------------------------------------------------- splits

export type SplitParty = 'creator' | 'remixer' | 'royalty' | 'platform';

export const PLATFORM_FEE_NUMERATOR = 10; // exactly 10% of net
export const ROYALTY_NUMERATOR = 15; // exactly 15% of net

export type SplitInput = { net_cents: number; is_remix: boolean; creator: string; remixer: string | null };

export function saleShares(netCents: number, isRemix: boolean): { party: SplitParty; amount_cents: number }[] {
  // Each share floors from its exact percentage; the leftover cents (net minus
  // the floored sum) go one each to the largest fractional remainders; ties go
  // creator first, then remixer, then platform.
  const platformWeight = PLATFORM_FEE_NUMERATOR;
  const royaltyWeight = isRemix ? ROYALTY_NUMERATOR : 0;
  const creatorWeight = isRemix ? 0 : 100 - PLATFORM_FEE_NUMERATOR;
  const remixerWeight = isRemix ? 100 - PLATFORM_FEE_NUMERATOR - ROYALTY_NUMERATOR : 0;
  const parts: { party: SplitParty; amount_cents: number; weight: number }[] = [];
  if (isRemix) {
    parts.push({ party: 'royalty', amount_cents: Math.floor(netCents * royaltyWeight / 100), weight: royaltyWeight });
    parts.push({ party: 'remixer', amount_cents: Math.floor(netCents * remixerWeight / 100), weight: remixerWeight });
    parts.push({ party: 'platform', amount_cents: Math.floor(netCents * platformWeight / 100), weight: platformWeight });
  } else {
    parts.push({ party: 'creator', amount_cents: Math.floor(netCents * creatorWeight / 100), weight: creatorWeight });
    parts.push({ party: 'platform', amount_cents: Math.floor(netCents * platformWeight / 100), weight: platformWeight });
  }
  const flooredSum = parts.reduce((sum, part) => sum + part.amount_cents, 0);
  const leftover = netCents - flooredSum;
  const sorted = parts
    .map((part, index) => {
      const exact = (netCents * part.weight) / 100;
      return { index, party: part.party, remainder: exact - Math.floor(exact) };
    })
    .sort((a, b) => b.remainder - a.remainder || tieParty(a.party) - tieParty(b.party) || a.index - b.index);
  const out = parts.map((part) => ({ party: part.party, amount_cents: part.amount_cents }));
  let assigned = 0;
  for (const entry of sorted) {
    if (assigned >= leftover) break;
    out[entry.index] = { party: entry.party, amount_cents: out[entry.index].amount_cents + 1 };
    assigned += 1;
  }
  return out;
}

// ---------------------------------------------------------------- refunds

export function refundAllocation(netCents: number, original: { party: SplitParty; amount_cents: number }[]): { party: SplitParty; amount_cents: number }[] {
  const total = original.reduce((sum, row) => sum + row.amount_cents, 0);
  const floored = original.map((row) => ({ party: row.party, amount_cents: Math.floor(netCents * row.amount_cents / total) }));
  const leftoverCount = netCents - floored.reduce((sum, row) => sum + row.amount_cents, 0);
  const sorted = floored
    .map((row, index) => {
      const exact = (netCents * original[index].amount_cents) / total;
      return { index, party: row.party, remainder: exact - Math.floor(exact) };
    })
    .sort((a, b) => b.remainder - a.remainder || tieParty(a.party) - tieParty(b.party) || a.index - b.index);
  const out = floored.map((row) => ({ ...row }));
  let remaining = leftoverCount;
  for (const entry of sorted) {
    if (remaining === 0) break;
    out[entry.index] = { party: entry.party, amount_cents: out[entry.index].amount_cents + 1 };
    remaining -= 1;
  }
  return out;
}

function tieParty(party: string): number {
  if (party === 'creator' || party === 'royalty') return 0;
  if (party === 'remixer') return 1;
  return 2;
}


// ---------------------------------------------------------------- invoice numbers

export function invoiceNumber(year: number, seq: number): string {
  return `PY-${year}-${String(seq).padStart(6, '0')}`;
}

export function creditNoteNumber(year: number, seq: number): string {
  return `PY-CN-${year}-${String(seq).padStart(6, '0')}`;
}

// ---------------------------------------------------------------- order states

export const ORDER_STATE_FLOW: ReadonlySet<OrderState> = new Set(['held', 'paying', 'failed', 'expired', 'paid', 'invoiced', 'receipted', 'refunded']);

export const ORDER_LEGAL_MOVES: Readonly<Record<string, OrderState[]>> = {
  held: ['paying', 'expired'],
  paying: ['paid', 'failed'],
  paid: ['invoiced'],
  invoiced: ['receipted'],
  receipted: ['refunded'],
  failed: [],
  expired: [],
  refunded: []
};

export function orderMoveLegal(from: OrderState, to: OrderState): boolean {
  return (ORDER_LEGAL_MOVES[from] ?? []).includes(to);
}

// ---------------------------------------------------------------- email addresses

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- statements

export function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function periodKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodCloseDate(period: string): Date {
  const [year, month] = period.split('-').map((p) => Number(p));
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
}
