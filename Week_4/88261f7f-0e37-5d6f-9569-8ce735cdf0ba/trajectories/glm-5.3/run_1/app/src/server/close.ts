import type { Request, Response } from 'express';
import type pg from 'pg';
import { pool, withTransaction, id } from './db.js';
import { err } from './errors.js';
import { publish } from './live.js';
import { addDays, closeOpensAt, compareDates, isValidDate } from './dates.js';
import { FolioRow, stayFolios, folioBalance, nextFolioLetter } from './store.js';
import type { CloseResult, ReportFigures } from '../shared/types.js';
import { computeNightFigures, serializeFigures } from './reports.js';

export async function runClose(req: Request, res: Response) {
  const user = req.user!;
  const hotelId = user.hotelId;
  const businessDate = req.body.businessDate;
  if (typeof businessDate !== 'string' || !isValidDate(businessDate)) {
    throw err.validation('businessDate', 'Enter a valid date range.');
  }

  const result = await withTransaction(async client => {
    const hotelRes = await client.query('SELECT * FROM hotels WHERE id = $1 FOR UPDATE', [hotelId]);
    const hotel = hotelRes.rows[0];
    if (!hotel) throw err.notFound();
    const now = hotel.clock_fixed_at ? new Date(hotel.clock_fixed_at) : new Date();

    if (businessDate !== hotel.business_date) {
      // already closed or in the future
      const closedRes = await client.query('SELECT 1 FROM closed_nights WHERE hotel_id = $1 AND date = $2', [hotelId, businessDate]);
      if (closedRes.rows[0]) {
        throw conflictWithBlockers('This business date is already closed.', []);
      }
      if (compareDates(businessDate, hotel.business_date) > 0) {
        throw err.conflict('The business day has not ended. The close opens at 04:00.');
      }
      throw conflictWithBlockers('This business date is already closed.', []);
    }

    // Opening time: 04:00:00 local on the date after the business date
    const opensAt = closeOpensAt(businessDate, hotel.time_zone);
    if (now.getTime() < opensAt.getTime()) {
      throw err.conflict('The business day has not ended. The close opens at 04:00.');
    }

    // Blockers: stays departing on or before the business date still in house
    const inHouseRes = await client.query(
      `SELECT s.id, s.departure, r.number AS room_number, r.id AS room_id
       FROM stays s
       JOIN stay_nights sn ON sn.stay_id = s.id AND sn.date = $2
       JOIN rooms r ON r.id = sn.room_id
       WHERE s.hotel_id = $1 AND s.status = 'in_house'
       ORDER BY r.number`, [hotelId, businessDate]);
    const blockers: Array<{ roomId: string; roomNumber: string; text: string }> = [];
    const inHouseStays: Array<{ stayId: string; roomId: string; roomNumber: string }> = [];
    for (const row of inHouseRes.rows) {
      if (compareDates(row.departure, businessDate) <= 0) {
        blockers.push({ roomId: row.room_id, roomNumber: row.room_number, text: `Room ${row.room_number} has not checked out.` });
      } else {
        inHouseStays.push({ stayId: row.id, roomId: row.room_id, roomNumber: row.room_number });
      }
    }
    if (blockers.length > 0) {
      throw conflictWithBlockers(blockers[0].text, blockers);
    }

    // 1. No-shows: booked stays arriving on the closing date
    const noShowRes = await client.query(
      `SELECT s.id, sn.room_cents, sn.tax_cents, sn.city_tax_cents
       FROM stays s JOIN stay_nights sn ON sn.stay_id = s.id AND sn.date = s.arrival
       WHERE s.hotel_id = $1 AND s.status = 'booked' AND s.arrival = $2`, [hotelId, businessDate]);
    let noShows = 0;
    for (const row of noShowRes.rows) {
      await client.query(`UPDATE stays SET status='no_show', version=version+1 WHERE id=$1`, [row.id]);
      await client.query('DELETE FROM stay_nights WHERE stay_id = $1', [row.id]);
      await client.query('UPDATE checkin_tokens SET accepted_at = $1 WHERE stay_id = $2 AND accepted_at IS NULL', [now, row.id]);
      const fee = row.room_cents + row.tax_cents + row.city_tax_cents;
      const folios = await stayFolios(client, row.id);
      const open = folios.find(f => f.state === 'open');
      let folioId = open?.id;
      if (!folioId) {
        const letter = nextFolioLetter(folios.map(f => f.letter));
        folioId = id('f');
        const guestRes = await client.query(
          'SELECT g.name, g.email FROM stays s JOIN guests g ON g.id = s.guest_id WHERE s.id = $1', [row.id]);
        await client.query(
          `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
           VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
          [folioId, hotelId, row.id, `Folio ${letter}`, guestRes.rows[0].name, guestRes.rows[0].email, letter]);
      }
      await client.query(
        `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
         VALUES ($1,$2,'charge',$3,'No-show fee',$4,$5)`,
        [id('e'), folioId, businessDate, fee, null]);
      noShows++;
    }

    // 2. In-house stays: room charge, tax, city tax in room-number order
    const rows: Array<{ roomId: string; roomNumber: string; stayId: string; postedCents: number }> = [];
    const sorted = [...inHouseStays].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    for (const stayRoom of sorted) {
      const nightRes = await client.query(
        'SELECT * FROM stay_nights WHERE stay_id = $1 AND date = $2', [stayRoom.stayId, businessDate]);
      const night = nightRes.rows[0];
      if (!night) continue;
      const folios = await stayFolios(client, stayRoom.stayId);
      let folioId = folios.find(f => f.state === 'open')?.id;
      if (!folioId) {
        const letter = nextFolioLetter(folios.map(f => f.letter));
        folioId = id('f');
        const guestRes = await client.query(
          'SELECT g.name, g.email FROM stays s JOIN guests g ON g.id = s.guest_id WHERE s.id = $1', [stayRoom.stayId]);
        await client.query(
          `INSERT INTO folios (id, hotel_id, stay_id, name, payer_name, payer_email, state, letter)
           VALUES ($1,$2,$3,$4,$5,$6,'open',$7)`,
          [folioId, hotelId, stayRoom.stayId, `Folio ${letter}`, guestRes.rows[0].name, guestRes.rows[0].email, letter]);
      }
      await client.query(
        `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
         VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
        [id('e'), folioId, businessDate, `Room charge, room ${stayRoom.roomNumber}`, night.room_cents, stayRoom.roomNumber]);
      await client.query(
        `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
         VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
        [id('e'), folioId, businessDate, `Tax, room ${stayRoom.roomNumber}`, night.tax_cents, stayRoom.roomNumber]);
      await client.query(
        `INSERT INTO entries (id, folio_id, kind, date, description, amount_cents, room_number)
         VALUES ($1,$2,'charge',$3,$4,$5,$6)`,
        [id('e'), folioId, businessDate, `City tax, room ${stayRoom.roomNumber}`, night.city_tax_cents, stayRoom.roomNumber]);
      await client.query('UPDATE stay_nights SET posted = TRUE WHERE id = $1', [night.id]);
      rows.push({
        roomId: stayRoom.roomId, roomNumber: stayRoom.roomNumber,
        stayId: stayRoom.stayId, postedCents: night.room_cents + night.tax_cents + night.city_tax_cents
      });
    }

    // 3. Fix the day's figures
    const figures = await computeNightFigures(client, hotelId, businessDate, businessDate);
    const nightFig = figures[0];
    await client.query(
      `INSERT INTO closed_nights (hotel_id, date, rooms_available, rooms_sold, room_revenue_cents)
       VALUES ($1,$2,$3,$4,$5)`,
      [hotelId, businessDate, nightFig.roomsAvailable, nightFig.roomsSold, nightFig.roomRevenueCents]);

    // 4. Advance the business date
    const newBusinessDate = addDays(businessDate, 1);
    await client.query('UPDATE hotels SET business_date = $1 WHERE id = $2', [newBusinessDate, hotelId]);

    const closeResult: CloseResult = {
      businessDate,
      newBusinessDate,
      roomsCharged: rows.length,
      noShows,
      figures: serializeFigures(nightFig),
      rows
    };
    return closeResult;
  });

  publish(hotelId, { type: 'close', notice: null, businessDate: result.newBusinessDate });
  res.json(result);
}

function conflictWithBlockers(text: string, blockers: Array<{ roomId: string; roomNumber: string; text: string }>) {
  const error = new (class extends Error {
    public status = 409;
    public body = { error: text, blockers };
  })('conflict');
  return error;
}

export async function lastClose(client: pg.PoolClient, hotelId: string, businessDate: string) {
  const res = await client.query(
    'SELECT * FROM closed_nights WHERE hotel_id = $1 AND date < $2 ORDER BY date DESC LIMIT 1',
    [hotelId, businessDate]);
  return res.rows[0] ?? null;
}
