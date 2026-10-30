import { q, withStationLock } from "./db.js";
import type { Tx } from "./db.js";
import { uid, token } from "./seed.js";
import { isDate, isTime, iso, localDate, parseIso, resolveWallTime, hhmmOf, addDaysStr, dayMinutes, dayTicks } from "../shared/time.js";
import { ACTIVE_BOOKING_STATUSES, overlaps, Blocker } from "./domain.js";
import type { Hold, Occurrence, Quote, Segment, SegmentState, SessionUser } from "../shared/types.js";
import { packBalance } from "./pack.js";
import { getSite } from "./scope.js";
import { notFound, forbidden } from "./errors.js";

export { q, withStationLock, uid, token };
export type { Tx };
export { isDate, isTime, iso, localDate, parseIso, resolveWallTime, hhmmOf, addDaysStr, dayMinutes, dayTicks };
export { ACTIVE_BOOKING_STATUSES, overlaps };
export { packBalance };
export { getSite, notFound, forbidden };
export type { Blocker };
export type { Hold, Occurrence, Quote, Segment, SegmentState, SessionUser };

export interface Occ {
  date: string;
  start: string;
  end: string;
  startAt: number;
  endAt: number;
  minutes: number;
}

/** Build occurrences for a hold request, one place. */
export function buildOccurrences(
  tz: string,
  date: string,
  start: string,
  end: string,
  repeatWeeks: number,
): Occ[] {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const nextDay = eh * 60 + em <= sh * 60 + sm;
  const out: Occ[] = [];
  for (let k = 0; k < repeatWeeks; k++) {
    const d = addDaysStr(date, k * 7);
    const [y, m, dd] = d.split("-").map(Number);
    const startAt = resolveWallTime(tz, { y, m, d: dd, hh: sh, mm: sm });
    const endDate = nextDay ? addDaysStr(d, 1) : d;
    const [ey, em2, ed] = endDate.split("-").map(Number);
    const endAt = resolveWallTime(tz, { y: ey, m: em2, d: ed, hh: eh, mm: em });
    out.push({ date: d, start, end, startAt, endAt, minutes: Math.round((endAt - startAt) / 60000) });
  }
  return out;
}

/** Find a conflicting segment for a station and instant range, labelling it for the viewer. */
export async function findConflict(
  tx: Tx,
  stationId: string,
  startAt: number,
  endAt: number,
  viewerRenterId: string | null,
  tz: string,
): Promise<Blocker | null> {
  const bookings = await tx.query(
    `SELECT b.id, b.start_at, b.end_at, b.renter_id FROM bookings b
     WHERE b.station_id = $1 AND b.status = ANY($2::text[]) AND b.start_at < $4 AND b.end_at > $3`,
    [stationId, ACTIVE_BOOKING_STATUSES, new Date(startAt).toISOString(), new Date(endAt).toISOString()],
  );
  for (const b of bookings.rows as { start_at: Date; end_at: Date; renter_id: string }[]) {
    if (overlaps(startAt, endAt, b.start_at.getTime(), b.end_at.getTime())) {
      const own = viewerRenterId !== null && b.renter_id === viewerRenterId;
      const state: Blocker["state"] = own ? "yours_booked" : "booked";
      return blockerOf(state, b.start_at.getTime(), b.end_at.getTime(), tz);
    }
  }
  const holds = await tx.query(
    `SELECT ho.start_at, ho.end_at, h.renter_id, ho.date FROM hold_occurrences ho
     JOIN holds h ON h.id = ho.hold_id
     WHERE h.station_id = $1 AND h.status = 'held' AND h.expires_at > now()
       AND ho.start_at < $3 AND ho.end_at > $2`,
    [stationId, new Date(startAt).toISOString(), new Date(endAt).toISOString()],
  );  for (const h of holds.rows as { start_at: Date; end_at: Date; renter_id: string; date: Date }[]) {
    if (overlaps(startAt, endAt, h.start_at.getTime(), h.end_at.getTime())) {
      const own = viewerRenterId !== null && h.renter_id === viewerRenterId;
      const state: Blocker["state"] = own ? "yours_held" : "held";
      const b = blockerOf(state, h.start_at.getTime(), h.end_at.getTime(), tz);
      b.date = h.date.toISOString().slice(0, 10);
      return b;
    }
  }
  return null;
}

function blockerOf(state: Blocker["state"], startMs: number, endMs: number, tz: string): Blocker {
  const words = state === "booked" ? "Booked" : state === "held" ? "Held" : state === "yours_booked" ? "Your booking" : "Your hold";
  return {
    state,
    start_at: iso(startMs),
    end_at: iso(endMs),
    label: `${words} ${hhmmOf(tz, startMs)}–${hhmmOf(tz, endMs)}`,
    date: "",
  };
}

/** Cover occurrences with pack minutes in time order; the one pricing helper. */
export function coverOccurrences(
  occs: { startAt: number; minutes: number }[],
  packAvailable: number,
  rateCents: number,
  depositCents: number,
): { perOcc: { pack: number; card: number }[]; packMinutes: number; cardMinutes: number; cardCents: number; depositCents: number } {
  let remaining = Math.max(0, packAvailable);
  const perOcc: { pack: number; card: number }[] = [];
  const ordered = [...occs].sort((a, b) => a.startAt - b.startAt);
  let packTotal = 0, cardTotal = 0, deposits = 0;
  for (const o of ordered) {
    const take = Math.min(remaining, o.minutes);
    const card = o.minutes - take;
    remaining -= take;
    packTotal += take;
    cardTotal += card;
    if (card > 0) deposits += 1;
    perOcc.push({ pack: take, card });
  }
  return {
    perOcc,
    packMinutes: packTotal,
    cardMinutes: cardTotal,
    cardCents: Math.round(cardTotal * rateCents / 60),
    depositCents: depositCents * deposits,
  };
}

export async function loadHold(holdId: string): Promise<Hold> {
  const r = await q(`SELECT * FROM holds WHERE id = $1`, [holdId]);
  const h = r.rows[0] as { id: string; status: Hold["status"]; station_id: string; site_id: string; renter_id: string; created_at: Date; expires_at: Date } | undefined;
  if (!h) throw notFound();
  const occ = await q(
    `SELECT date, start_time, end_time, start_at, end_at, minutes FROM hold_occurrences WHERE hold_id = $1 ORDER BY ordinal`,
    [holdId],
  );
  const station = await q(`SELECT rate_cents FROM stations WHERE id = $1`, [h.station_id]);
  const site = await getSite(h.site_id);
  const rate = (station.rows[0] as { rate_cents: number }).rate_cents;
  const occs: Occurrence[] = occ.rows.map((o: { date: Date; start_time: string; end_time: string; start_at: Date; end_at: Date; minutes: number }) => ({
    date: o.date.toISOString().slice(0, 10),
    start: o.start_time,
    end: o.end_time,
    start_at: iso(o.start_at.getTime()),
    end_at: iso(o.end_at.getTime()),
    minutes: o.minutes,
  }));
  const balance = await packBalance(h.renter_id);
  const cover = coverOccurrences(occs.map(o => ({ startAt: Date.parse(o.start_at), minutes: o.minutes })), balance.available, rate, site!.deposit_cents);
  const quote: Quote = {
    pack_minutes_available: balance.available,
    pack_minutes: cover.packMinutes,
    card_minutes: cover.cardMinutes,
    card_cents: cover.cardCents,
    deposit_cents: cover.depositCents,
  };
  return {
    id: h.id, status: h.status, station_id: h.station_id, site_id: h.site_id, renter_id: h.renter_id,
    created_at: iso(h.created_at.getTime()), expires_at: iso(h.expires_at.getTime()),
    occurrences: occs, quote,
  };
}

/** Holds scope: owner renter, or staff within their site/operator. */
export async function assertHoldScope(user: SessionUser, hold: Hold): Promise<void> {
  if (user.role === "renter") {
    if (hold.renter_id !== user.renter_id) throw notFound();
    return;
  }
  const site = await getSite(hold.site_id);
  if (!site) throw notFound();
  if (user.role === "front_desk" && !user.site_ids.includes(site.id)) throw notFound();
  if (site.operator_id !== user.operator_id) throw notFound();
}

export async function stationRateCents(stationId: string): Promise<number> {
  const r = await q(`SELECT rate_cents FROM stations WHERE id = $1`, [stationId]);
  return (r.rows[0] as { rate_cents: number }).rate_cents;
}
