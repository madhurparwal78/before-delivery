import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './database';
import type { Config } from '../config';
import type { KillBillClient, KbItem } from './killbill';
import type { OutboxService } from './outbox';
import { ApiError } from '../http/errors';
import {
  priceBreakdown, costSplit, farePrices, tierPrices,
  type Fare, type Tier, type Locale, type PriceBreakdown, type PayerShare,
  upliftPresets, upliftMinCents, upliftMaxCents, payerMin, payerMax, groupHoldMin, groupHoldMax,
} from '../domain/model';
import { seatSort } from '../domain/seats';
import { iso } from '../time';
import { bookingRef, ticketCode, sha256Hex, capabilityToken } from '../domain/ids';
import {
  getHoldRaw, expireHoldIfNeeded, holdView,
  type HoldRow, type HoldView, type BookingView, type QuoteView,
} from './booking';
import { bookingConfirmationEmail, emailText, emailHtml } from '../mail/templates';

export interface FareAssignment { seat: string; fare: Fare }

/** The one default-fare rule, in seat order. */
export function defaultFares(seats: string[], isMember: boolean, memberTier: Tier | null): FareAssignment[] {
  if (!isMember || !memberTier) {
    return seatSort(seats).map(seat => ({ seat, fare: 'regular' as Fare }));
  }
  const allowance = tierPrices[memberTier].guestAllowance;
  return seatSort(seats).map((seat, i) => ({
    seat,
    fare: (i === 0 ? 'member' : (i - 1 < allowance ? 'member-guest' : 'regular')) as Fare,
  }));
}

/** The one fare-rules check: group only in group holds, member allowances per tier. */
export function fareRuleErrors(
  assignments: FareAssignment[],
  isMember: boolean,
  memberTier: Tier | null,
  group: boolean,
  locale: Locale,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const fareMsg = locale === 'en'
    ? "This fare isn't available for this seat."
    : 'Ce tarif n\'est pas offert pour cette place.';
  if (group) {
    for (const a of assignments) {
      if (a.fare !== 'group') fields[`fares.${a.seat}`] = fareMsg;
    }
    return fields;
  }
  const allowance = isMember && memberTier ? tierPrices[memberTier].guestAllowance : 0;
  const ordered = seatSort(assignments.map(a => a.seat))
    .map(seat => assignments.find(a => a.seat === seat) as FareAssignment);
  let memberCount = 0;
  let guestCount = 0;
  for (const a of ordered) {
    if (a.fare === 'member') {
      memberCount += 1;
      if (!isMember || memberCount > 1) fields[`fares.${a.seat}`] = fareMsg;
    } else if (a.fare === 'member-guest') {
      guestCount += 1;
      if (!isMember || guestCount > allowance) fields[`fares.${a.seat}`] = fareMsg;
    } else if (a.fare === 'group') {
      fields[`fares.${a.seat}`] = fareMsg;
    }
  }
  return fields;
}

/** The one uplift rule: 0, a preset, or a custom whole amount in the published range. */
export function upliftError(upliftCents: number, locale: Locale): string | null {
  if (upliftCents === 0) return null;
  if (upliftPresets.includes(upliftCents)) return null;
  if (Number.isInteger(upliftCents) && upliftCents >= upliftMinCents && upliftCents <= upliftMaxCents) return null;
  return locale === 'en'
    ? 'Enter an uplift between $1.00 and $500.00.'
    : 'Entrez une contribution entre 1,00 $ et 500,00 $.';
}

export function computeQuote(
  assignments: FareAssignment[],
  upliftCents: number,
  creditBalanceCents: number,
  stepupVerified: boolean,
): QuoteView {
  const breakdown = priceBreakdown(assignments, upliftCents);
  const creditApplied = Math.min(Math.max(creditBalanceCents, 0), breakdown.total_cents);
  return {
    ...breakdown,
    credit_applied_cents: creditApplied,
    pay_now_cents: breakdown.total_cents - creditApplied,
    stepup_required: creditApplied > 0 && !stepupVerified,
  };
}

export interface QuoteContext {
  isMember: boolean;
  memberTier: Tier | null;
  creditBalanceCents: number;
  stepupVerified: boolean;
}

export async function holdForOwner(
  holdUuid: string,
  sessionToken: string,
): Promise<{ row: HoldRow; seats: string[] }> {
  const found = await getHoldRaw(holdUuid);
  if (!found) throw new ApiError('not_found');
  const owned = found.row.session_token === sessionToken;
  if (!owned) throw new ApiError('not_found');
  return found;
}

export interface QuoteResult {
  view: QuoteView;
  assignments: FareAssignment[];
  row: HoldRow;
  seats: string[];
}

export async function quoteHold(
  holdUuid: string,
  sessionToken: string,
  ctx: QuoteContext,
  fares: Record<string, string> | null,
  upliftCents: number,
  locale: Locale,
): Promise<QuoteResult> {
  const found = await holdForOwner(holdUuid, sessionToken);
  const row = await expireHoldIfNeeded(found.row);
  if (row.state === 'expired') throw new ApiError('hold_expired');
  if (row.state === 'paid') throw new ApiError('hold_already_paid');
  const seats = found.seats;
  const faresGiven = fares !== null && Object.keys(fares).length > 0;
  const assignments = faresGiven
    ? seatSort(seats).map(seat => ({ seat, fare: (fares as Record<string, string>)[seat] as Fare }))
    : row.group_booking
      ? seatSort(seats).map(seat => ({ seat, fare: 'group' as Fare }))
      : defaultFares(seats, ctx.isMember, ctx.memberTier);
  const fareFields = fareRuleErrors(assignments, ctx.isMember, ctx.memberTier, row.group_booking, locale);
  const upliftMsg = upliftError(upliftCents, locale);
  const fields: Record<string, string> = { ...fareFields };
  if (upliftMsg) fields.uplift_cents = upliftMsg;
  if (Object.keys(fields).length > 0) throw new ApiError('validation', { fields });
  const view = computeQuote(assignments, upliftCents, ctx.creditBalanceCents, ctx.stepupVerified);
  await query('UPDATE holds SET last_quote = $2 WHERE id = $1', [holdUuid, JSON.stringify(view)]);
  return { view, assignments, row, seats };
}
