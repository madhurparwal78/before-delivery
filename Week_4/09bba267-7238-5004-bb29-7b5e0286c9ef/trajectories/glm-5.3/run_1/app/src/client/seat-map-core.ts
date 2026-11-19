import type { Cart, Seat } from '../shared/api-types';
import { api } from './api';
import { announce } from './live';

export const SECTIONS = [
  { code: 'ST', name: 'Stalls', rows: 'ABCDEFGHIJKLMNOP'.split('') },
  { code: 'CI', name: 'Circle', rows: 'ABCDEFGH'.split('') },
  { code: 'BA', name: 'Balcony', rows: 'ABCDEF'.split('') },
] as const;

export type SectionCode = (typeof SECTIONS)[number]['code'];

export function seatLabelOf(seatId: string): string {
  const [sectionCode, row, number] = seatId.split('-');
  const name = SECTIONS.find((s) => s.code === sectionCode)?.name ?? sectionCode;
  return `${name} row ${row} seat ${number}`;
}

export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-' : ''}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function seatStateWord(seat: Seat): string {
  if (seat.state === 'on_sale') return 'On sale';
  if (seat.state === 'not_on_sale') return 'Not on sale';
  if (seat.state === 'held') return seat.mine ? 'Held by you' : 'Taken';
  if (seat.state === 'sold') return seat.mine ? 'Your ticket' : 'Taken';
  if (seat.state === 'offered') return seat.mine ? 'Offered to you' : 'Taken';
  return 'Not on sale';
}

export function seatWedgeState(seat: Seat, selected: boolean): string {
  if (seat.state === 'not_on_sale') return 'not_on_sale';
  if (selected) return 'selected';
  if (seat.state === 'on_sale') return 'on_sale';
  if (seat.state === 'held') return seat.mine ? 'held_by_you' : 'taken';
  if (seat.state === 'sold') return seat.mine ? 'yours' : 'taken';
  if (seat.state === 'offered') return seat.mine ? 'offered_to_you' : 'taken';
  return 'not_on_sale';
}

export type SeatMapAddress = {
  performanceId: string;
  section: SectionCode;
  seat: string;
  tier: string;
  exchangeTicketId?: string;
};

export function parseAddress(path: string): SeatMapAddress | null {
  const match = /^\/p\/([^/?]+)(\?.*)?$/.exec(path);
  if (!match) return null;
  const params = new URLSearchParams(match[2] ?? '');
  const sectionParam = params.get('section');
  const section = (SECTIONS.find((s) => s.code === sectionParam)?.code ?? 'ST') as SectionCode;
  const seatParam = params.get('seat');
  const seat = seatParam && seatParam.startsWith(`${section}-`) ? seatParam : `${section}-A-15`;
  return {
    performanceId: match[1],
    section,
    seat,
    tier: params.get('tier') ?? 'all',
    exchangeTicketId: params.get('exchange') ?? undefined,
  };
}

export function addressToPath(address: SeatMapAddress): string {
  const params = new URLSearchParams();
  params.set('section', address.section);
  params.set('seat', address.seat);
  params.set('tier', address.tier);
  if (address.exchangeTicketId) params.set('exchange', address.exchangeTicketId);
  return `/p/${address.performanceId}?${params.toString()}`;
}

export function seatSelectable(seat: Seat, chosenTier: string): boolean {
  if (seat.state !== 'on_sale' || !seat.tierId) return false;
  if (chosenTier !== 'all' && seat.tierId !== chosenTier) return false;
  return true;
}

export type HoldOutcome =
  | { kind: 'all-held'; held: string[] }
  | { kind: 'some-held'; held: string[]; taken: string[] }
  | { kind: 'none-held'; taken: string[] }
  | { kind: 'sales-closed' }
  | { kind: 'invalid'; message: string };

export async function requestHold(performanceId: string, seatIds: string[]): Promise<{ outcome: HoldOutcome; cart: Cart | null }> {
  const result = await api<{ cart: Cart; held: string[]; taken: string[] }>(`/api/performances/${performanceId}/holds`, {
    method: 'POST',
    body: { seatIds },
  });
  if (result.ok) {
    const { held, taken } = result.value;
    if (taken.length === 0) return { outcome: { kind: 'all-held', held }, cart: result.value.cart };
    if (held.length > 0) return { outcome: { kind: 'some-held', held, taken }, cart: result.value.cart };
    return { outcome: { kind: 'none-held', taken }, cart: result.value.cart };
  }
  if (result.error === 'sales_closed') return { outcome: { kind: 'sales-closed' }, cart: null };
  if (result.fields?.seatIds) return { outcome: { kind: 'invalid', message: result.fields.seatIds }, cart: null };
  if (result.error === 'seats_taken') {
    const body = result.body;
    const taken = Array.isArray(body?.taken) ? (body.taken as string[]) : [];
    return { outcome: { kind: 'none-held', taken }, cart: null };
  }
  return { outcome: { kind: 'invalid', message: 'Something went wrong.' }, cart: null };
}

export function announceHold(outcome: HoldOutcome): void {
  if (outcome.kind === 'all-held') {
    announce(`Held ${outcome.held.map(seatLabelOf).join(', ')}.`);
    return;
  }
  if (outcome.kind === 'some-held') {
    announce(
      `Held ${outcome.held.map(seatLabelOf).join(', ')}. Taken by another buyer: ${outcome.taken.map(seatLabelOf).join(', ')}.`,
    );
    return;
  }
  if (outcome.kind === 'none-held') {
    announce(`Taken by another buyer: ${outcome.taken.map(seatLabelOf).join(', ')}.`);
    return;
  }
  if (outcome.kind === 'sales-closed') {
    announce('Sales for this performance have closed.');
    return;
  }
  announce(outcome.message);
}
