import type { PoolClient } from "pg";
import type { CloseResult, CloseRow } from "../shared/api";
import { addDays, isIsoDate, type IsoDate } from "../shared/dates";
import { notices } from "../shared/notices";
import { atomic, database, one, rows, run, type Row } from "./db";
import { hotelNow, nightOf } from "./clock";
import { fail, ok, type JsonObject, type Reply } from "./http";
import { loadHotel, taxRatesOf, ROOM_ORDER } from "./hotel";
import { emit } from "./live";
import { postCharge } from "./folios";
import { nightFigures } from "./reports";
import type { TaxRateInForce } from "./rules/pricing";
import { statusAfter, statusBefore } from "../shared/stayStatus";
import { nightRows, nightView, type NightRow } from "./stayView";

interface Blocker extends Row { room_id: string; room_number: string }

export async function lastClose(hotelId: string): Promise<CloseResult | null> {
  const found = await one<Row & { result: CloseResult }>(
    database(), "SELECT result FROM closed_days WHERE hotel_id = $1 ORDER BY business_date DESC LIMIT 1", [hotelId]);
  return found?.result ?? null;
}

/** Each in-house stay's night on `date` gets its room charge, tax and city tax, in room-number order. */
async function postNight(client: PoolClient, hotelId: string, date: IsoDate, rates: readonly TaxRateInForce[]): Promise<CloseRow[]> {
  const charged = await rows<NightRow & { stay_id: string }>(
    client,
    `SELECT s.id AS stay_id, n.night, r.id AS room_id, r.number AS room_number, n.room_cents, n.city_tax_cents, n.tax_cents, n.posted
     FROM stay_nights n JOIN stays s ON s.id = n.stay_id JOIN rooms r ON r.id = n.room_id
     WHERE s.hotel_id = $1 AND s.status = 'in_house' AND n.night = $2 AND NOT n.posted ORDER BY ${ROOM_ORDER}`,
    [hotelId, date],
  );
  const lines: CloseRow[] = [];
  for (const night of charged) {
    const priced = nightView(night, rates);
    await postCharge(client, hotelId, night.stay_id, date, `Room charge, room ${night.room_number}`, priced.roomCents, night.room_number);
    await postCharge(client, hotelId, night.stay_id, date, `Tax, room ${night.room_number}`, priced.taxCents, night.room_number);
    await postCharge(client, hotelId, night.stay_id, date, `City tax, room ${night.room_number}`, priced.cityTaxCents, night.room_number);
    await run(client, "UPDATE stay_nights SET posted = true, tax_cents = $3 WHERE stay_id = $1 AND night = $2", [night.stay_id, date, priced.taxCents]);
    lines.push({ roomId: night.room_id, roomNumber: night.room_number, stayId: night.stay_id, postedCents: priced.totalCents });
  }
  return lines;
}

/** Posts the night, fixes its figures and records the day as closed. The business date is not moved here. */
export async function closeNight(client: PoolClient, hotelId: string, date: IsoDate, noShows: number): Promise<CloseResult> {
  const lines = await postNight(client, hotelId, date, await taxRatesOf(client, hotelId));
  const result: CloseResult = {
    businessDate: date,
    newBusinessDate: addDays(date, 1),
    roomsCharged: lines.length,
    noShows,
    figures: (await nightFigures(client, hotelId, [date]))[0].figures,
    rows: lines,
  };
  await run(client, "INSERT INTO closed_days (hotel_id, business_date, result) VALUES ($1, $2, $3)", [hotelId, date, JSON.stringify(result)]);
  return result;
}

/** A stay that did not arrive on the closing date becomes a no-show and pays the first night. */
async function markNoShows(client: PoolClient, hotelId: string, date: IsoDate, rates: readonly TaxRateInForce[]): Promise<number> {
  const missed = await rows<Row & { id: string }>(
    client, "SELECT id FROM stays WHERE hotel_id = $1 AND status = $3 AND arrival = $2", [hotelId, date, statusBefore("close")]);
  for (const { id } of missed) {
    const first = (await nightRows(client, id))[0];
    await run(
      client,
      "UPDATE stays SET status = $2, version = version + 1, link_state = CASE WHEN link_state = 'sent' THEN 'ended' ELSE link_state END WHERE id = $1",
      [id, statusAfter("close")]);
    await run(client, "UPDATE stay_nights SET holds = false WHERE stay_id = $1", [id]);
    await postCharge(client, hotelId, id, date, "No-show fee", nightView(first, rates).totalCents, first.room_number);
  }
  return missed.length;
}

/** The close: refused until the business day has ended, blocked by stays that should have left, otherwise all or nothing. */
export async function runClose(hotelId: string, body: JsonObject): Promise<Reply> {
  const result = await atomic(async (client) => {
    const hotel = await loadHotel(client, hotelId, true);
    const named = isIsoDate(body.businessDate) ? body.businessDate : null;
    if (named) {
      if (named < hotel.businessDate) throw fail.conflict("This business date is already closed.");
      if (named > hotel.businessDate || nightOf(hotelNow(hotel.clockNow), hotel.timeZone) <= hotel.businessDate) {
        throw fail.conflict("The business day has not ended. The close opens at 04:00.");
      }
    }
    const date = hotel.businessDate;
    const blockers = await rows<Blocker>(
      client,
      `SELECT r.id AS room_id, r.number AS room_number FROM stays s
       JOIN LATERAL (SELECT room_id FROM stay_nights WHERE stay_id = s.id ORDER BY night DESC LIMIT 1) last ON true
       JOIN rooms r ON r.id = last.room_id
       WHERE s.hotel_id = $1 AND s.status = 'in_house' AND s.departure <= $2 ORDER BY ${ROOM_ORDER}`,
      [hotelId, date],
    );
    if (blockers.length > 0) {
      const list = blockers.map((blocker) => ({ roomId: blocker.room_id, roomNumber: blocker.room_number, text: `Room ${blocker.room_number} has not checked out.` }));
      throw fail.conflict(list[0].text, { blockers: list });
    }
    if (!named) throw fail.invalid({ businessDate: "Enter a valid date." });
    const noShows = await markNoShows(client, hotelId, date, await taxRatesOf(client, hotelId));
    const closed = await closeNight(client, hotelId, date, noShows);
    await run(client, "UPDATE hotels SET business_date = $2 WHERE id = $1", [hotelId, closed.newBusinessDate]);
    const roomIds = (await rows<Row & { id: string }>(client, "SELECT id FROM rooms WHERE hotel_id = $1", [hotelId])).map((room) => room.id);
    await emit(client, hotelId, { type: "close", businessDate: date, notice: notices.closed(date, closed.roomsCharged, closed.noShows) }, roomIds);
    return closed;
  });
  return ok(result);
}
