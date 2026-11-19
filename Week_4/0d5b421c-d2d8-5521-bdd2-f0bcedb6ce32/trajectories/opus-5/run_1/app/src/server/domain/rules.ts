import { randomBytes } from 'node:crypto';
import type { SlotReason } from '../../shared/types';
import {
  addDaysToDate,
  addMinutes,
  daysBetweenDates,
  lisbonDate,
  lisbonInstant,
  lisbonTime,
} from '../time';

export const BOOKING_LEAD_MINUTES = 60;
export const BOOKING_HORIZON_DAYS = 30;
export const RESET_MINUTES = 15;
export const DEPOSIT_CENTS_PER_COVER = 1500;
export const DEPOSIT_MIN_PARTY = 5;
export const DEPOSIT_ROOMS = ['chefs-counter'] as const;
export const REFUND_CUTOFF_HOURS = 24;
export const NO_SHOW_AFTER_MINUTES = 15;
export const HOST_SESSION_HOURS = 12;
export const SLOT_MINUTES = 15;

export const TURN_MINUTES: Record<string, number> = {
  '1-2': 90,
  '3-4': 105,
  '5-6': 120,
  '7-8': 150,
};

function buildSlotTimes(): string[] {
  const times: string[] = [];
  const first = 18 * 60;
  const last = 22 * 60;
  for (let minutes = first; minutes <= last; minutes += SLOT_MINUTES) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    times.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
  return times;
}

export const SLOT_TIMES: readonly string[] = buildSlotTimes();

export function isSlotTime(value: string): boolean {
  return SLOT_TIMES.includes(value);
}

export function turnMinutes(partySize: number): number {
  if (partySize <= 2) return 90;
  if (partySize <= 4) return 105;
  if (partySize <= 6) return 120;
  return 150;
}

export interface TurnWindow {
  start: Date;
  end: Date;
}

/** A party occupies its table from its start instant for its turn time plus the reset. */
export function turnWindow(partySize: number, startsAt: Date): TurnWindow {
  return {
    start: startsAt,
    end: addMinutes(startsAt, turnMinutes(partySize) + RESET_MINUTES),
  };
}

/** Every quarter-hour instant from the window's start up to, but not including, its end. */
export function coveredSlots(window: TurnWindow): Date[] {
  const instants: Date[] = [];
  for (
    let instant = window.start;
    instant.getTime() < window.end.getTime();
    instant = addMinutes(instant, SLOT_MINUTES)
  ) {
    instants.push(instant);
  }
  return instants;
}

export function windowsConflict(a: TurnWindow, b: TurnWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export function slotStartsAt(date: string, time: string): Date {
  return lisbonInstant(date, time);
}

/**
 * The published edges are whole seconds: exactly 60 minutes of lead and exactly 24 hours before
 * the slot both count, so every comparison judges the server's now to the second.
 */
function wholeSeconds(instant: Date): number {
  return Math.floor(instant.getTime() / 1000) * 1000;
}

/** Why a slot cannot be booked, or null when it can. */
export function slotReason(date: string, time: string, now: Date): SlotReason {
  const today = lisbonDate(now);
  const offset = daysBetweenDates(today, date);
  if (offset < 0) return 'past';
  if (offset > BOOKING_HORIZON_DAYS) return 'beyond_horizon';
  const startsAt = slotStartsAt(date, time);
  const leadMs = BOOKING_LEAD_MINUTES * 60000;
  const difference = startsAt.getTime() - wholeSeconds(now);
  if (difference <= 0) return 'past';
  if (difference < leadMs) return 'too_late';
  return null;
}

export function isBookable(date: string, time: string, now: Date): boolean {
  return slotReason(date, time, now) === null;
}

export function isDateWithinHorizon(date: string, now: Date): boolean {
  const offset = daysBetweenDates(lisbonDate(now), date);
  return offset >= 0 && offset <= BOOKING_HORIZON_DAYS;
}

export function horizonDates(now: Date): { earliest: string; latest: string } {
  const today = lisbonDate(now);
  return {
    earliest: today,
    latest: addDaysToDate(today, BOOKING_HORIZON_DAYS),
  };
}

/** The deposit for an online or waitlist booking, in integer cents. */
export function depositCents(partySize: number, roomId: string): number {
  const applies =
    partySize >= DEPOSIT_MIN_PARTY || DEPOSIT_ROOMS.includes(roomId as 'chefs-counter');
  return applies ? DEPOSIT_CENTS_PER_COVER * partySize : 0;
}

export function refundCutoff(startsAt: Date): Date {
  return new Date(startsAt.getTime() - REFUND_CUTOFF_HOURS * 3600000);
}

export function refundsIfCancelledAt(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - wholeSeconds(now) >= REFUND_CUTOFF_HOURS * 3600000;
}

/** The host can mark a no-show only from 15 minutes after the slot starts. */
export function noShowAllowed(startsAt: Date, now: Date): boolean {
  return wholeSeconds(now) >= addMinutes(startsAt, NO_SHOW_AFTER_MINUTES).getTime();
}

export function hostSessionEnd(signedInAt: Date): Date {
  return new Date(wholeSeconds(signedInAt) + HOST_SESSION_HOURS * 3600000);
}

/** The current slot: Lisbon time rounded down to the quarter hour, kept inside service. */
export function currentSlot(now: Date): { date: string; time: string } {
  const date = lisbonDate(now);
  const wall = lisbonTime(now);
  const [hour, minute] = wall.split(':').map(Number) as [number, number];
  const minutes = hour * 60 + minute;
  const first = 18 * 60;
  const last = 22 * 60;
  const rounded = Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES;
  const clamped = Math.min(Math.max(rounded, first), last);
  const slotHour = Math.floor(clamped / 60);
  const slotMinute = clamped % 60;
  return {
    date,
    time: `${String(slotHour).padStart(2, '0')}:${String(slotMinute).padStart(2, '0')}`,
  };
}

const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function newBookingReference(): string {
  const bytes = randomBytes(6);
  let suffix = '';
  for (const byte of bytes) {
    suffix += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return `SS-${suffix}`;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}
