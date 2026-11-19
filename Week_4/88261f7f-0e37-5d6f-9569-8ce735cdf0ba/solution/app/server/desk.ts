import type { DeskView, Timeline, TimelineBlock, TimelineRoom } from "../shared/api";
import { addDays, nightsBetween, type IsoDate } from "../shared/dates";
import { formatMoney } from "../shared/money";
import { notices } from "../shared/notices";
import { lastClose } from "./close";
import { database, inserted, rows, type Queryable, type Row } from "./db";
import { fail, ok, type Reply } from "./http";
import { ROOM_ORDER, hotelView, loadHotel } from "./hotel";
import { rangeErrors } from "./reports";
import { nightView, segmentsOf, type NightRow } from "./stayView";

const MAX_TIMELINE_NIGHTS = 62;

async function freeRoomsCount(from: Queryable, hotelId: string): Promise<number> {
  const free = await inserted<Row & { free: number }>(
    from,
    `SELECT count(*)::int AS free FROM rooms r JOIN hotels h ON h.id = r.hotel_id
     WHERE r.hotel_id = $1 AND r.status <> 'out_of_order'
       AND NOT EXISTS (SELECT 1 FROM stay_nights n WHERE n.room_id = r.id AND n.night = h.business_date AND n.holds)`,
    [hotelId],
  );
  return free.free;
}

export async function deskView(hotelId: string): Promise<Reply> {
  const hotel = await loadHotel(database(), hotelId);
  const view: DeskView = {
    hotel: hotelView(hotel),
    freeRoomsText: notices.freeRooms(await freeRoomsCount(database(), hotelId)),
    lastClose: await lastClose(hotelId),
  };
  return ok(view);
}

interface BlockNight extends NightRow { stay_id: string; status: TimelineBlock["status"]; guest_name: string; checked_in_online: boolean; version: number }

export async function timelineView(hotelId: string, query: URLSearchParams): Promise<Reply> {
  const from = query.get("from");
  const to = query.get("to");
  const errors = rangeErrors(from, to, MAX_TIMELINE_NIGHTS);
  if (Object.keys(errors).length > 0 || !from || !to) throw fail.invalid(errors);
  const hotel = await loadHotel(database(), hotelId);
  const dates = nightsBetween(from, addDays(to, 1));
  const roomRows = await rows<Row & TimelineRoom>(database(), `SELECT r.id, r.number, r.type, r.status FROM rooms r WHERE r.hotel_id = $1 ORDER BY ${ROOM_ORDER}`, [hotelId]);
  const nights = await rows<BlockNight>(
    database(),
    `SELECT n.stay_id, n.night, n.room_id, r.number AS room_number, n.room_cents, n.city_tax_cents, n.tax_cents, n.posted,
            s.status, g.name AS guest_name, s.checked_in_online, s.version
     FROM stay_nights n JOIN stays s ON s.id = n.stay_id JOIN guests g ON g.id = s.guest_id JOIN rooms r ON r.id = n.room_id
     WHERE s.hotel_id = $1 AND n.stay_id IN (SELECT stay_id FROM stay_nights WHERE night BETWEEN $2 AND $3)
     ORDER BY n.stay_id, n.night`,
    [hotelId, from, to],
  );
  const blocks: TimelineBlock[] = [];
  for (const stayId of new Set(nights.map((night) => night.stay_id))) {
    const own = nights.filter((night) => night.stay_id === stayId);
    const head = own[0];
    for (const segment of segmentsOf(own)) {
      blocks.push({
        stayId, roomId: segment.roomId, firstNight: segment.firstNight, nights: segment.nights, status: head.status,
        guestName: head.guest_name, checkedInOnline: head.checked_in_online, version: head.version,
      });
    }
  }
  const closed = await rows<Row & { business_date: IsoDate }>(
    database(), "SELECT business_date FROM closed_days WHERE hotel_id = $1 AND business_date BETWEEN $2 AND $3", [hotelId, from, to]);
  const stamps = closed.flatMap(({ business_date: date }) =>
    roomRows.map((room) => {
      const posted = nights.find((night) => night.room_id === room.id && night.night === date && night.posted);
      return { date, roomId: room.id, stamp: posted ? formatMoney(nightView(posted, []).totalCents) : "tick" };
    }));
  const view: Timeline = {
    businessDate: hotel.businessDate, dates,
    rooms: roomRows.map((room) => ({ id: room.id, number: room.number, type: room.type, status: room.status })),
    blocks, stamps,
  };
  return ok(view);
}
