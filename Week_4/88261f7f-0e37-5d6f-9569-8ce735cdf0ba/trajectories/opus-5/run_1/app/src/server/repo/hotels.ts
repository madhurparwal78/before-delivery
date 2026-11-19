import { Db, one, rows } from '../db';
import { PlainDate } from '../../shared/dates';
import { nightOf } from '../domain/clock';
import { RoomStatus } from '../../shared/roomStatus';
import { TaxRateInForce } from '../domain/pricing';

export interface Hotel {
  id: string;
  name: string;
  timeZone: string;
  businessDate: PlainDate;
  clockNow: Date | null;
}

interface HotelRow {
  id: string;
  name: string;
  time_zone: string;
  business_date: string;
  clock_now: Date | null;
}

function toHotel(row: HotelRow): Hotel {
  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    businessDate: row.business_date,
    clockNow: row.clock_now,
  };
}

export async function loadHotel(db: Db, hotelId: string): Promise<Hotel | null> {
  const row = await one<HotelRow>(
    db,
    'select id, name, time_zone, business_date, clock_now from hotels where id = $1',
    [hotelId],
  );
  return row ? toHotel(row) : null;
}

/** The hotel's clock: the instant set for grading when there is one, otherwise real time. */
export function hotelNow(hotel: Hotel): Date {
  return hotel.clockNow ?? new Date();
}

/** The night the hotel's clock is in right now, by the 04:00 moment rule. */
export function currentNight(hotel: Hotel): PlainDate {
  return nightOf(hotel.timeZone, hotelNow(hotel));
}

export interface Room {
  id: string;
  number: string;
  type: string;
  status: RoomStatus;
}

interface RoomRow {
  id: string;
  number: string;
  type: string;
  status: string;
}

/** Room numbers sort by their numeric part first, so 2 comes before 101. */
export function roomSortKey(number: string): string {
  const digits = number.replace(/\D/g, '');
  return `${digits.padStart(12, '0')}|${number}`;
}

export async function listRooms(db: Db, hotelId: string): Promise<Room[]> {
  const found = await rows<RoomRow>(
    db,
    'select id, number, type, status from rooms where hotel_id = $1 order by sort_key',
    [hotelId],
  );
  return found.map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type,
    status: row.status as RoomStatus,
  }));
}

export async function loadRoom(db: Db, hotelId: string, roomId: string): Promise<Room | null> {
  const row = await one<RoomRow>(
    db,
    'select id, number, type, status from rooms where hotel_id = $1 and id = $2',
    [hotelId, roomId],
  );
  return row
    ? { id: row.id, number: row.number, type: row.type, status: row.status as RoomStatus }
    : null;
}

export async function setRoomStatus(db: Db, roomId: string, status: RoomStatus): Promise<void> {
  await db.query('update rooms set status = $2 where id = $1', [roomId, status]);
}

export interface RatePlan {
  id: string;
  name: string;
  weeknightCents: number;
  weekendCents: number;
}

interface RatePlanRow {
  id: string;
  name: string;
  weeknight_cents: number;
  weekend_cents: number;
}

export async function listRatePlans(db: Db, hotelId: string): Promise<RatePlan[]> {
  const found = await rows<RatePlanRow>(
    db,
    'select id, name, weeknight_cents, weekend_cents from rate_plans where hotel_id = $1 order by ord',
    [hotelId],
  );
  return found.map((row) => ({
    id: row.id,
    name: row.name,
    weeknightCents: row.weeknight_cents,
    weekendCents: row.weekend_cents,
  }));
}

export async function loadRatePlan(db: Db, hotelId: string, planId: string): Promise<RatePlan | null> {
  const plans = await listRatePlans(db, hotelId);
  return plans.find((plan) => plan.id === planId) ?? null;
}

export interface TaxRate extends TaxRateInForce {
  id: string;
}

interface TaxRateRow {
  id: string;
  percent: string;
  start_date: string | null;
}

export async function listTaxRates(db: Db, hotelId: string): Promise<TaxRate[]> {
  const found = await rows<TaxRateRow>(
    db,
    `select id, percent, start_date from tax_rates where hotel_id = $1
      order by start_date nulls first`,
    [hotelId],
  );
  return found.map((row) => ({ id: row.id, percent: row.percent, startDate: row.start_date }));
}

export async function freeRoomCount(db: Db, hotelId: string, date: PlainDate): Promise<number> {
  const row = await one<{ count: number }>(
    db,
    `select count(*)::int as count from rooms r
      where r.hotel_id = $1
        and r.status <> 'out_of_order'
        and not exists (
          select 1 from stay_segments sg
            join stays s on s.id = sg.stay_id
           where sg.room_id = r.id
             and s.status in ('booked','in_house','checked_out')
             and sg.first_night <= $2::date
             and $2::date < sg.first_night + sg.nights
        )`,
    [hotelId, date],
  );
  return row ? row.count : 0;
}
