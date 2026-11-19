import { Db } from '../db';
import { daysBetween, isPlainDate, PlainDate } from '../../shared/dates';
import { MAX_GUESTS, MAX_STAY_NIGHTS, MIN_GUESTS } from '../domain/pricing';
import { validationTexts } from '../http/errors';
import { Hotel, listRatePlans, listRooms } from '../repo/hotels';
import { isEmail } from './support';

export interface StayDraft {
  arrival: PlainDate | null;
  departure: PlainDate | null;
  guests: number | null;
  roomId: string | null;
  ratePlanId: string | null;
}

export interface GuestDraft {
  name: string;
  email: string;
  phone: string;
}

export function readGuestDraft(body: Record<string, unknown>): GuestDraft | null {
  const guest = body.guest;
  if (guest === null || typeof guest !== 'object' || Array.isArray(guest)) return null;
  const record = guest as Record<string, unknown>;
  return {
    name: typeof record.name === 'string' ? record.name.trim() : '',
    email: typeof record.email === 'string' ? record.email.trim() : '',
    phone: typeof record.phone === 'string' ? record.phone.trim() : '',
  };
}

export function checkGuestDraft(guest: GuestDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (guest.name === '') errors['guest.name'] = validationTexts.guestName;
  if (!isEmail(guest.email)) errors['guest.email'] = validationTexts.guestEmail;
  return errors;
}

export interface DateCheckOptions {
  /** An in-house stay keeps its arrival and may depart on, but not before, the business date. */
  inHouse: boolean;
}

export function checkDates(
  hotel: Hotel,
  arrival: unknown,
  departure: unknown,
  options: DateCheckOptions,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isPlainDate(arrival)) {
    errors.arrival = validationTexts.arrivalBeforeBusinessDate;
  } else if (!options.inHouse && arrival < hotel.businessDate) {
    errors.arrival = validationTexts.arrivalBeforeBusinessDate;
  }
  if (!isPlainDate(departure)) {
    errors.departure = validationTexts.departureAfterArrival;
    return errors;
  }
  if (!isPlainDate(arrival)) return errors;
  if (departure <= arrival) {
    errors.departure = validationTexts.departureAfterArrival;
    return errors;
  }
  if (options.inHouse && departure < hotel.businessDate) {
    errors.departure = validationTexts.departureBeforeBusinessDate;
    return errors;
  }
  if (daysBetween(arrival, departure) > MAX_STAY_NIGHTS) {
    errors.departure = validationTexts.stayTooLong;
  }
  return errors;
}

export function checkGuestCount(guests: unknown): Record<string, string> {
  if (
    typeof guests !== 'number' ||
    !Number.isInteger(guests) ||
    guests < MIN_GUESTS ||
    guests > MAX_GUESTS
  ) {
    return { guests: validationTexts.guestsRange };
  }
  return {};
}

export async function checkRoom(
  db: Db,
  hotel: Hotel,
  roomId: unknown,
): Promise<Record<string, string>> {
  if (typeof roomId !== 'string' || roomId === '') return { roomId: validationTexts.chooseRoom };
  const rooms = await listRooms(db, hotel.id);
  return rooms.some((room) => room.id === roomId) ? {} : { roomId: validationTexts.chooseRoom };
}

export async function checkRatePlan(
  db: Db,
  hotel: Hotel,
  ratePlanId: unknown,
): Promise<Record<string, string>> {
  if (typeof ratePlanId !== 'string' || ratePlanId === '') {
    return { ratePlanId: validationTexts.chooseRatePlan };
  }
  const plans = await listRatePlans(db, hotel.id);
  return plans.some((plan) => plan.id === ratePlanId)
    ? {}
    : { ratePlanId: validationTexts.chooseRatePlan };
}
