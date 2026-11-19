import { randomUUID } from 'node:crypto';
import { Db, one, rows } from '../db';
import { addDays, daysBetween, dateRange, PlainDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import { freeCancellationDeadline } from '../domain/clock';
import { completeNight, priceRoomNights, RatePlanPrices, TaxRateInForce } from '../domain/pricing';
import { StayStatus } from '../domain/stayState';
import { Hotel, hotelNow, listTaxRates, loadRatePlan } from './hotels';
import { FolioView, listFolios } from './folios';

export interface SegmentView {
  roomId: string;
  roomNumber: string;
  firstNight: PlainDate;
  nights: number;
}

export interface NightView {
  date: PlainDate;
  roomNumber: string;
  roomCents: number;
  taxCents: number;
  cityTaxCents: number;
  totalCents: number;
  posted: boolean;
}

export interface CancellationView {
  state: 'free' | 'late';
  feeCents: number;
  text: string;
}

export interface StayRecord {
  id: string;
  hotelId: string;
  guestId: string;
  ratePlanId: string;
  guests: number;
  arrival: PlainDate;
  departure: PlainDate;
  status: StayStatus;
  version: number;
  checkedInOnline: boolean;
  onlineFullName: string | null;
  onlinePhone: string | null;
  checkinLinkState: 'not_sent' | 'sent' | 'ended';
  checkInNight: PlainDate | null;
  idPhoto: 'none' | 'received';
}

export interface GuestSummary {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface StayView {
  id: string;
  version: number;
  status: StayStatus;
  guest: GuestSummary;
  ratePlanId: string;
  guests: number;
  arrival: PlainDate;
  departure: PlainDate;
  segments: SegmentView[];
  checkedInOnline: boolean;
  onlineCheckIn: { fullName: string; phone: string } | null;
  checkinLinkState: 'not_sent' | 'sent' | 'ended';
  checkInNight: PlainDate | null;
  idPhoto: 'none' | 'received';
  nightly: NightView[];
  totalCents: number;
  cancellation: CancellationView | null;
  folios: FolioView[];
}

interface StayRow {
  id: string;
  hotel_id: string;
  guest_id: string;
  rate_plan_id: string;
  guests: number;
  arrival: string;
  departure: string;
  status: string;
  version: number;
  checked_in_online: boolean;
  online_full_name: string | null;
  online_phone: string | null;
  checkin_link_state: string;
  check_in_night: string | null;
  id_photo: string;
}

function toRecord(row: StayRow): StayRecord {
  return {
    id: row.id,
    hotelId: row.hotel_id,
    guestId: row.guest_id,
    ratePlanId: row.rate_plan_id,
    guests: row.guests,
    arrival: row.arrival,
    departure: row.departure,
    status: row.status as StayStatus,
    version: row.version,
    checkedInOnline: row.checked_in_online,
    onlineFullName: row.online_full_name,
    onlinePhone: row.online_phone,
    checkinLinkState: row.checkin_link_state as StayRecord['checkinLinkState'],
    checkInNight: row.check_in_night,
    idPhoto: row.id_photo as 'none' | 'received',
  };
}

const STAY_COLUMNS = `id, hotel_id, guest_id, rate_plan_id, guests, arrival, departure, status,
  version, checked_in_online, online_full_name, online_phone, checkin_link_state,
  check_in_night, id_photo`;

export async function loadStayRecord(
  db: Db,
  hotelId: string,
  stayId: string,
): Promise<StayRecord | null> {
  const row = await one<StayRow>(
    db,
    `select ${STAY_COLUMNS} from stays where hotel_id = $1 and id = $2`,
    [hotelId, stayId],
  );
  return row ? toRecord(row) : null;
}

export async function loadStayRecordById(db: Db, stayId: string): Promise<StayRecord | null> {
  const row = await one<StayRow>(db, `select ${STAY_COLUMNS} from stays where id = $1`, [stayId]);
  return row ? toRecord(row) : null;
}

export async function segmentsOf(db: Db, stayId: string): Promise<SegmentView[]> {
  return (
    await rows<{ room_id: string; number: string; first_night: string; nights: number }>(
      db,
      `select sg.room_id, r.number, sg.first_night, sg.nights
         from stay_segments sg join rooms r on r.id = sg.room_id
        where sg.stay_id = $1 order by sg.first_night`,
      [stayId],
    )
  ).map((row) => ({
    roomId: row.room_id,
    roomNumber: row.number,
    firstNight: row.first_night,
    nights: row.nights,
  }));
}

export function roomForNight(segments: SegmentView[], date: PlainDate): SegmentView | null {
  return (
    segments.find(
      (segment) => segment.firstNight <= date && date < addDays(segment.firstNight, segment.nights),
    ) ?? null
  );
}

export async function replaceSegments(
  db: Db,
  stayId: string,
  segments: Array<{ roomId: string; firstNight: PlainDate; nights: number }>,
): Promise<void> {
  await db.query('delete from stay_segments where stay_id = $1', [stayId]);
  for (const segment of segments) {
    await db.query(
      'insert into stay_segments (id, stay_id, room_id, first_night, nights) values ($1,$2,$3,$4,$5)',
      [randomUUID(), stayId, segment.roomId, segment.firstNight, segment.nights],
    );
  }
}

export interface StoredNight {
  date: PlainDate;
  roomCents: number;
  posted: boolean;
  postedTaxCents: number | null;
  postedCityTaxCents: number | null;
}

export async function storedNights(db: Db, stayId: string): Promise<StoredNight[]> {
  return (
    await rows<{
      date: string;
      room_cents: number;
      posted: boolean;
      posted_tax_cents: number | null;
      posted_city_tax_cents: number | null;
    }>(
      db,
      `select date, room_cents, posted, posted_tax_cents, posted_city_tax_cents
         from stay_nights where stay_id = $1 order by date`,
      [stayId],
    )
  ).map((row) => ({
    date: row.date,
    roomCents: row.room_cents,
    posted: row.posted,
    postedTaxCents: row.posted_tax_cents,
    postedCityTaxCents: row.posted_city_tax_cents,
  }));
}

/**
 * Writes the room amount for every night of the stay, leaving posted nights untouched.
 * Room amounts are fixed when written and only an unposted night is ever repriced.
 */
export async function writeRoomNights(
  db: Db,
  stayId: string,
  plan: RatePlanPrices,
  arrival: PlainDate,
  departure: PlainDate,
  guests: number,
): Promise<void> {
  const totalNights = daysBetween(arrival, departure);
  const priced = priceRoomNights(plan, arrival, totalNights, guests);
  await db.query(
    'delete from stay_nights where stay_id = $1 and posted = false and not (date = any($2::date[]))',
    [stayId, priced.map((night) => night.date)],
  );
  for (const night of priced) {
    await db.query(
      `insert into stay_nights (stay_id, date, room_cents, posted) values ($1,$2,$3,false)
       on conflict (stay_id, date) do update set room_cents = excluded.room_cents
       where stay_nights.posted = false`,
      [stayId, night.date, night.roomCents],
    );
  }
}

export function completeNights(
  stored: StoredNight[],
  segments: SegmentView[],
  guests: number,
  taxRates: TaxRateInForce[],
): NightView[] {
  return stored.map((night) => {
    const segment = roomForNight(segments, night.date);
    const roomNumber = segment ? segment.roomNumber : '';
    if (night.posted) {
      const taxCents = night.postedTaxCents ?? 0;
      const cityTaxCents = night.postedCityTaxCents ?? 0;
      return {
        date: night.date,
        roomNumber,
        roomCents: night.roomCents,
        taxCents,
        cityTaxCents,
        totalCents: night.roomCents + taxCents + cityTaxCents,
        posted: true,
      };
    }
    const priced = completeNight(night.roomCents, night.date, guests, taxRates);
    return {
      date: night.date,
      roomNumber,
      roomCents: priced.roomCents,
      taxCents: priced.taxCents,
      cityTaxCents: priced.cityTaxCents,
      totalCents: priced.totalCents,
      posted: false,
    };
  });
}

const cancellationTexts = {
  free: (deadlineDate: PlainDate): string => `Free cancellation until ${deadlineDate} 18:00`,
  late: (feeCents: number): string => `Late cancellation fee: ${formatMoney(feeCents)}`,
} as const;

/** The free or late state and fee, read from the hotel's clock. */
export function cancellationFor(
  hotel: Hotel,
  status: StayStatus,
  arrival: PlainDate,
  nightly: NightView[],
): CancellationView | null {
  if (status !== 'booked') return null;
  const deadline = freeCancellationDeadline(hotel.timeZone, arrival);
  if (hotelNow(hotel).getTime() < deadline.getTime()) {
    return { state: 'free', feeCents: 0, text: cancellationTexts.free(addDays(arrival, -1)) };
  }
  const feeCents = nightly.length > 0 ? nightly[0].totalCents : 0;
  return { state: 'late', feeCents, text: cancellationTexts.late(feeCents) };
}

export async function loadStayView(
  db: Db,
  hotel: Hotel,
  stayId: string,
): Promise<StayView | null> {
  const record = await loadStayRecord(db, hotel.id, stayId);
  if (!record) return null;
  return buildStayView(db, hotel, record);
}

export async function buildStayView(db: Db, hotel: Hotel, record: StayRecord): Promise<StayView> {
  const guest = await one<{ id: string; name: string; email: string; phone: string }>(
    db,
    'select id, name, email, phone from guests where id = $1',
    [record.guestId],
  );
  const segments = await segmentsOf(db, record.id);
  const stored = await storedNights(db, record.id);
  const taxRates = await listTaxRates(db, hotel.id);
  const nightly = completeNights(stored, segments, record.guests, taxRates);
  const folios = await listFolios(db, record.id);
  return {
    id: record.id,
    version: record.version,
    status: record.status,
    guest: guest ?? { id: record.guestId, name: '', email: '', phone: '' },
    ratePlanId: record.ratePlanId,
    guests: record.guests,
    arrival: record.arrival,
    departure: record.departure,
    segments,
    checkedInOnline: record.checkedInOnline,
    onlineCheckIn:
      record.onlineFullName === null
        ? null
        : { fullName: record.onlineFullName, phone: record.onlinePhone ?? '' },
    checkinLinkState: record.checkinLinkState,
    checkInNight: record.checkInNight,
    idPhoto: record.idPhoto,
    nightly,
    totalCents: nightly.reduce((total, night) => total + night.totalCents, 0),
    cancellation: cancellationFor(hotel, record.status, record.arrival, nightly),
    folios,
  };
}

/** The first of `dates` already held on the room by another stay, or null when all are free. */
export async function firstHeldNight(
  db: Db,
  roomId: string,
  dates: PlainDate[],
  excludeStayId: string | null,
): Promise<PlainDate | null> {
  if (dates.length === 0) return null;
  const row = await one<{ date: string }>(
    db,
    `select d::date as date from unnest($1::date[]) as d
      where exists (
        select 1 from stay_segments sg join stays s on s.id = sg.stay_id
         where sg.room_id = $2
           and s.status in ('booked','in_house','checked_out')
           and ($3::text is null or s.id <> $3)
           and sg.first_night <= d::date
           and d::date < sg.first_night + sg.nights
      )
      order by d limit 1`,
    [dates, roomId, excludeStayId],
  );
  return row ? row.date : null;
}

/** Serialises competing creates and moves on the same rooms. */
export async function lockRooms(db: Db, roomIds: string[]): Promise<void> {
  const unique = [...new Set(roomIds)].sort();
  if (unique.length === 0) return;
  await db.query('select id from rooms where id = any($1::text[]) order by id for update', [unique]);
}

export async function bumpVersion(db: Db, stayId: string): Promise<number> {
  const row = await one<{ version: number }>(
    db,
    'update stays set version = version + 1 where id = $1 returning version',
    [stayId],
  );
  return row ? row.version : 1;
}

export async function ratePlanFor(db: Db, hotel: Hotel, planId: string): Promise<RatePlanPrices | null> {
  const plan = await loadRatePlan(db, hotel.id, planId);
  return plan ? { weeknightCents: plan.weeknightCents, weekendCents: plan.weekendCents } : null;
}
