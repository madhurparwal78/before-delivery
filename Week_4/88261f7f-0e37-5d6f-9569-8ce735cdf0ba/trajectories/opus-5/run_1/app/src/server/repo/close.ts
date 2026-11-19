import { Db, one, rows } from '../db';
import { addDays, PlainDate } from '../../shared/dates';
import { formatMoney } from '../../shared/money';
import { Figures, figuresFrom } from '../domain/reports';
import { errorTexts } from '../http/errors';
import { Hotel, listTaxRates } from './hotels';
import {
  completeNights,
  loadStayRecordById,
  roomForNight,
  segmentsOf,
  storedNights,
} from './stays';
import { entryDescriptions, firstOpenFolio, insertEntry } from './folios';
import { endLink } from './checkinLinks';
import { nightTally } from './reports';

export interface CloseRowView {
  roomId: string;
  roomNumber: string;
  stayId: string;
  postedCents: number;
}

export interface CloseResult {
  businessDate: PlainDate;
  newBusinessDate: PlainDate;
  roomsCharged: number;
  noShows: number;
  figures: Figures;
  rows: CloseRowView[];
}

export interface Blocker {
  roomId: string;
  roomNumber: string;
  text: string;
}

export async function isClosed(db: Db, hotelId: string, date: PlainDate): Promise<boolean> {
  const row = await one<{ date: string }>(
    db,
    'select date from closed_days where hotel_id = $1 and date = $2',
    [hotelId, date],
  );
  return row !== null;
}

/** A stay departing on or before the business date still in house stops the close. */
export async function blockersFor(
  db: Db,
  hotelId: string,
  businessDate: PlainDate,
): Promise<Blocker[]> {
  const found = await rows<{ room_id: string; number: string }>(
    db,
    `select distinct r.id as room_id, r.number, r.sort_key
       from stays s
       join stay_segments sg on sg.stay_id = s.id
       join rooms r on r.id = sg.room_id
      where s.hotel_id = $1 and s.status = 'in_house' and s.departure <= $2::date
        and sg.first_night + sg.nights = s.departure
      order by r.sort_key`,
    [hotelId, businessDate],
  );
  return found.map((row) => ({
    roomId: row.room_id,
    roomNumber: row.number,
    text: errorTexts.notCheckedOut(row.number),
  }));
}

export async function lastClose(db: Db, hotelId: string): Promise<CloseResult | null> {
  const day = await one<{
    date: string;
    rooms_available: number;
    rooms_sold: number;
    room_revenue_cents: number;
    rooms_charged: number;
    no_shows: number;
  }>(
    db,
    `select date, rooms_available, rooms_sold, room_revenue_cents, rooms_charged, no_shows
       from closed_days where hotel_id = $1 order by date desc limit 1`,
    [hotelId],
  );
  if (!day) return null;
  const closeRows = await rows<{
    room_id: string;
    room_number: string;
    stay_id: string;
    posted_cents: number;
  }>(
    db,
    `select cr.room_id, cr.room_number, cr.stay_id, cr.posted_cents
       from close_rows cr join rooms r on r.id = cr.room_id
      where cr.hotel_id = $1 and cr.date = $2 order by r.sort_key`,
    [hotelId, day.date],
  );
  return {
    businessDate: day.date,
    newBusinessDate: addDays(day.date, 1),
    roomsCharged: day.rooms_charged,
    noShows: day.no_shows,
    figures: figuresFrom(day.rooms_available, day.rooms_sold, Number(day.room_revenue_cents)),
    rows: closeRows.map((row) => ({
      roomId: row.room_id,
      roomNumber: row.room_number,
      stayId: row.stay_id,
      postedCents: row.posted_cents,
    })),
  };
}

export interface Stamp {
  date: PlainDate;
  roomId: string;
  stamp: string;
}

/** The server's record of what each room's cell shows after a close. */
export async function stampsFor(
  db: Db,
  hotelId: string,
  from: PlainDate,
  to: PlainDate,
): Promise<Stamp[]> {
  const found = await rows<{ date: string; room_id: string; posted_cents: number | null }>(
    db,
    `select c.date, r.id as room_id, cr.posted_cents
       from closed_days c
       cross join rooms r
       left join close_rows cr on cr.hotel_id = c.hotel_id and cr.date = c.date and cr.room_id = r.id
      where c.hotel_id = $1 and r.hotel_id = $1 and c.date between $2::date and $3::date
      order by c.date, r.sort_key`,
    [hotelId, from, to],
  );
  return found.map((row) => ({
    date: row.date,
    roomId: row.room_id,
    stamp: row.posted_cents === null ? 'tick' : formatMoney(row.posted_cents),
  }));
}

interface PostingPlan {
  stayId: string;
  roomId: string;
  roomNumber: string;
  roomCents: number;
  taxCents: number;
  cityTaxCents: number;
}

/**
 * Posts no-show fees, then each in-house stay's room charge, tax and city tax in room-number
 * order, fixes the day's figures and advances the business date. Runs in one transaction.
 */
export async function runClose(
  db: Db,
  hotel: Hotel,
  businessDate: PlainDate,
): Promise<CloseResult> {
  const taxRates = await listTaxRates(db, hotel.id);

  const noShowCandidates = await rows<{ id: string }>(
    db,
    `select s.id from stays s join rooms r on r.id = (
        select sg.room_id from stay_segments sg where sg.stay_id = s.id order by sg.first_night limit 1
      )
      where s.hotel_id = $1 and s.status = 'booked' and s.arrival = $2::date
      order by r.sort_key`,
    [hotel.id, businessDate],
  );

  let noShows = 0;
  for (const candidate of noShowCandidates) {
    const stay = await loadStayRecordById(db, candidate.id);
    if (!stay) continue;
    const segments = await segmentsOf(db, stay.id);
    const nightly = completeNights(await storedNights(db, stay.id), segments, stay.guests, taxRates);
    const feeCents = nightly.length > 0 ? nightly[0].totalCents : 0;
    await db.query("update stays set status = 'no_show', version = version + 1 where id = $1", [
      stay.id,
    ]);
    await endLink(db, stay.id);
    if (feeCents > 0) {
      const guest = await one<{ name: string; email: string }>(
        db,
        'select name, email from guests where id = $1',
        [stay.guestId],
      );
      const folio = await firstOpenFolio(db, stay.id, guest?.name ?? '', guest?.email ?? '');
      await insertEntry(db, {
        folioId: folio.id,
        kind: 'charge',
        date: businessDate,
        description: entryDescriptions.noShowFee,
        amountCents: feeCents,
      });
    }
    noShows += 1;
  }

  const inHouse = await rows<{ id: string; room_id: string; number: string }>(
    db,
    `select s.id, sg.room_id, r.number
       from stays s
       join stay_segments sg on sg.stay_id = s.id
       join rooms r on r.id = sg.room_id
      where s.hotel_id = $1 and s.status = 'in_house'
        and sg.first_night <= $2::date and $2::date < sg.first_night + sg.nights
      order by r.sort_key`,
    [hotel.id, businessDate],
  );

  const plans: PostingPlan[] = [];
  for (const row of inHouse) {
    const stay = await loadStayRecordById(db, row.id);
    if (!stay) continue;
    const stored = await storedNights(db, stay.id);
    const night = stored.find((candidate) => candidate.date === businessDate);
    if (!night || night.posted) continue;
    const segments = await segmentsOf(db, stay.id);
    const completed = completeNights([night], segments, stay.guests, taxRates)[0];
    plans.push({
      stayId: stay.id,
      roomId: row.room_id,
      roomNumber: row.number,
      roomCents: completed.roomCents,
      taxCents: completed.taxCents,
      cityTaxCents: completed.cityTaxCents,
    });
  }

  const resultRows: CloseRowView[] = [];
  for (const plan of plans) {
    const stay = await loadStayRecordById(db, plan.stayId);
    if (!stay) continue;
    const guest = await one<{ name: string; email: string }>(
      db,
      'select name, email from guests where id = $1',
      [stay.guestId],
    );
    const folio = await firstOpenFolio(db, plan.stayId, guest?.name ?? '', guest?.email ?? '');
    await insertEntry(db, {
      folioId: folio.id,
      kind: 'charge',
      date: businessDate,
      description: entryDescriptions.roomCharge(plan.roomNumber),
      amountCents: plan.roomCents,
      roomNumber: plan.roomNumber,
    });
    await insertEntry(db, {
      folioId: folio.id,
      kind: 'charge',
      date: businessDate,
      description: entryDescriptions.tax(plan.roomNumber),
      amountCents: plan.taxCents,
      roomNumber: plan.roomNumber,
    });
    await insertEntry(db, {
      folioId: folio.id,
      kind: 'charge',
      date: businessDate,
      description: entryDescriptions.cityTax(plan.roomNumber),
      amountCents: plan.cityTaxCents,
      roomNumber: plan.roomNumber,
    });
    await db.query(
      `update stay_nights set posted = true, posted_tax_cents = $3, posted_city_tax_cents = $4
        where stay_id = $1 and date = $2`,
      [plan.stayId, businessDate, plan.taxCents, plan.cityTaxCents],
    );
    const postedCents = plan.roomCents + plan.taxCents + plan.cityTaxCents;
    await db.query(
      `insert into close_rows (hotel_id, date, room_id, room_number, stay_id, posted_cents)
       values ($1,$2,$3,$4,$5,$6)`,
      [hotel.id, businessDate, plan.roomId, plan.roomNumber, plan.stayId, postedCents],
    );
    resultRows.push({
      roomId: plan.roomId,
      roomNumber: plan.roomNumber,
      stayId: plan.stayId,
      postedCents,
    });
  }

  const tally = await nightTally(db, hotel.id, businessDate);
  await db.query(
    `insert into closed_days (hotel_id, date, rooms_available, rooms_sold, room_revenue_cents,
                              rooms_charged, no_shows)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      hotel.id,
      businessDate,
      tally.roomsAvailable,
      tally.roomsSold,
      tally.roomRevenueCents,
      resultRows.length,
      noShows,
    ],
  );
  const newBusinessDate = addDays(businessDate, 1);
  await db.query('update hotels set business_date = $2 where id = $1', [hotel.id, newBusinessDate]);

  return {
    businessDate,
    newBusinessDate,
    roomsCharged: resultRows.length,
    noShows,
    figures: figuresFrom(tally.roomsAvailable, tally.roomsSold, tally.roomRevenueCents),
    rows: resultRows,
  };
}
