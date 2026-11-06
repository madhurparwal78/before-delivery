import { audit, type Client, lockKitchenDates, pool, transaction } from "../db.js";
import { type Cell, FIRST_CELL_MINUTES, HORIZON_DAYS, type Kitchen, LAST_CELL_MINUTES, MAX_CELLS, type Member, type Quote, type Station, type User } from "../domain.js";
import { refuse } from "../errors.js";
import { json, route } from "../http.js";
import { idempotencyKey, idempotent } from "../idempotency.js";
import { bookOccurrences, newId, type Occurrence } from "../bookingUnit.js";
import { addDays, clockOf, isQuarterHour, kitchenDate, minutesOf, toInstant, weekdayName } from "../kitchenTime.js";
import { dollars, hoursText } from "../money.js";
import { priceCells } from "../pricing.js";
import { covers } from "../rules.js";
import { requireUp } from "../services.js";
import { cardInForce, cellKey, checkPackHours, loadKitchen, loadStations, monthQuarters, occupants, packBalance, type Queryable } from "../store.js";
import { allow, authed, bodyOf, checkSameDay, type Errors, failIfAny, readBookableDate, readBoolean, readWholeCents } from "../validate.js";
import { bookingView, invoiceView } from "../views.js";
import { memberCover, requireMember, targetMember } from "./holds.js";

// Weekly recurring slots (brief: Recurring series): every occurrence at the same kitchen wall-clock
// times, checked and priced in date order, booked all or nothing.

interface SeriesRequest {
  stationIds: string[];
  start: string;
  end: string;
  dates: string[];
  weeks: number;
  usePack: boolean;
}

function readSeries(body: Record<string, unknown>, kitchen: Kitchen, stations: Station[], now: Date, errors: Errors): SeriesRequest {
  const ids = new Set(stations.map((s) => s.id));
  const raw = body.station_ids;
  const stationIds = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  if (!Array.isArray(raw) || raw.length === 0 || stationIds.length !== raw.length || new Set(stationIds).size !== stationIds.length ||
    stationIds.some((id) => !ids.has(id))) {
    errors.station_ids = "Choose one or more stations of this kitchen, each once.";
  }
  const start = isQuarterHour(body.start, FIRST_CELL_MINUTES, LAST_CELL_MINUTES) ? body.start : "";
  if (!start) errors.start = "Choose a quarter-hour start from 04:00 to 23:45.";
  const end = isQuarterHour(body.end, FIRST_CELL_MINUTES + 15, LAST_CELL_MINUTES + 15) ? body.end : "";
  if (!end || (start && minutesOf(end) <= minutesOf(start))) errors.end = "Choose a quarter-hour end after the start, up to 24:00.";
  const first = readBookableDate(body.first_date, kitchen, now, errors, "first_date");
  const weeks = typeof body.weeks === "number" && Number.isInteger(body.weeks) && body.weeks >= 2 && body.weeks <= 12 ? body.weeks : 0;
  if (!weeks) errors.weeks = "Choose 2 to 12 weeks.";
  const usePack = readBoolean(body.use_pack, "use_pack", errors);
  const dates = first && weeks ? Array.from({ length: weeks }, (_, i) => addDays(first, 7 * i)) : [];
  if (dates.length > 0 && (dates.at(-1) ?? "") > addDays(kitchenDate(kitchen.timezone, now), HORIZON_DAYS)) {
    errors.weeks = "Every week must fall within 365 days of today.";
  }
  if (start && end && stationIds.length * ((minutesOf(end) - minutesOf(start)) / 15) > MAX_CELLS) {
    errors.station_ids = `A weekly slot may cover at most ${MAX_CELLS} cells.`;
  }
  return { stationIds, start, end, dates, weeks, usePack };
}

function slotCells(request: SeriesRequest): Cell[] {
  const cells: Cell[] = [];
  for (const station_id of request.stationIds) {
    for (let m = minutesOf(request.start); m < minutesOf(request.end); m += 15) cells.push({ station_id, start: clockOf(m) });
  }
  return cells;
}

/** Cover, same-day and availability checks for every week, then the priced occurrences in date order. */
async function planSeries(
  request: SeriesRequest,
  member: Member,
  kitchen: Kitchen,
  stations: Station[],
  now: Date,
  db: Queryable,
): Promise<Occurrence[]> {
  const cover = await memberCover(member, kitchen, now);
  const uncovered = request.dates.find((d) => !covers(cover, d));
  if (uncovered) throw refuse.complianceBlocked(uncovered);
  const cells = slotCells(request);
  for (const date of request.dates) checkSameDay(kitchen, date, cells.map((c) => c.start), now);
  const conflicts: { date: string; station_id: string; start: string }[] = [];
  for (const date of request.dates) {
    // The member's own live hold on these cells does not block the series; it is released once booked.
    const busy = new Set(
      (await occupants(kitchen.id, date, now, db)).filter((o) => o.booking_id !== null || o.member_id !== member.id).map((o) => cellKey(o.cell)),
    );
    for (const cell of cells) if (busy.has(cellKey(cell))) conflicts.push({ date, ...cell });
  }
  if (conflicts.length > 0) throw refuse.seriesConflict([...new Set(conflicts.map((c) => c.date))], conflicts);
  const card = await cardInForce(kitchen, now, db);
  let pack = request.usePack ? await packBalance(member.id, db) : 0;
  const counted = new Map<string, number>();
  const occurrences: Occurrence[] = [];
  for (const date of request.dates) {
    const month = date.slice(0, 7);
    const before = counted.get(month) ?? (await monthQuarters(member.id, month, db));
    const priced = priceCells(cells, stations, card, month, before, pack);
    pack = priced.packLeft;
    counted.set(month, before + cells.length);
    occurrences.push({ date, cells, quote: priced.quote });
  }
  return occurrences;
}

const seriesTotal = (occurrences: Occurrence[]): number => occurrences.reduce((sum, o) => sum + o.quote.total_cents, 0);

async function prepare(request: Parameters<typeof bodyOf>[0], user: User) {
  const body = bodyOf(request);
  const target = await targetMember(user, body);
  allow(user, "operator", "member");
  return { body, target };
}

route(
  "POST",
  "/api/series/quote",
  authed(async (request, user, now) => {
    const { body, target } = await prepare(request, user);
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const errors: Errors = {};
    const series = readSeries(body, kitchen, stations, now, errors);
    const member = requireMember(target, errors);
    failIfAny(errors);
    const occurrences = await planSeries(series, member, kitchen, stations, now, pool);
    const total = seriesTotal(occurrences);
    return json(200, {
      occurrences: occurrences.map((o) => ({
        date: o.date,
        starts_at: toInstant(kitchen.timezone, o.date, series.start).toISOString(),
        ends_at: toInstant(kitchen.timezone, o.date, series.end).toISOString(),
        quote: o.quote,
      })),
      total_cents: total,
      total: dollars(total),
    });
  }),
);

async function releaseOwnHolds(client: Client, member: Member, kitchen: Kitchen, occurrences: Occurrence[], actor: User, now: Date): Promise<void> {
  for (const occurrence of occurrences) {
    const keys = new Set(occurrence.cells.map(cellKey));
    const own = (await occupants(kitchen.id, occurrence.date, now, client)).filter(
      (o) => o.hold_id !== null && o.member_id === member.id && keys.has(cellKey(o.cell)),
    );
    for (const holdId of new Set(own.map((o) => o.hold_id ?? ""))) {
      await client.query("UPDATE holds SET state = 'released' WHERE id = $1", [holdId]);
      await audit(client, actor.id, "hold", holdId, "held", "released", now);
    }
  }
}

route(
  "POST",
  "/api/series",
  authed(async (request, user, now) => {
    const { body, target } = await prepare(request, user);
    const key = idempotencyKey(request);
    return idempotent(user, key, request, async () => {
      const kitchen = await loadKitchen(user.kitchen_id);
      const stations = await loadStations(kitchen.id);
      const errors: Errors = {};
      const series = readSeries(body, kitchen, stations, now, errors);
      const quoted = readWholeCents(body.quoted_total_cents, "quoted_total_cents", errors);
      const member = requireMember(target, errors);
      return transaction(async (client) => {
        await lockKitchenDates(client, kitchen.id, series.dates);
        await client.query("SELECT id FROM members WHERE id = $1 FOR NO KEY UPDATE", [member.id]);
        await checkPackHours(member.id, series.usePack, errors, client);
        failIfAny(errors);
        const occurrences = await planSeries(series, member, kitchen, stations, now, client);
        const total = seriesTotal(occurrences);
        if (total !== quoted) throw refuse.quoteChanged(seriesQuote(occurrences, total));
        requireUp("billing", "mail");
        const record = {
          id: newId("series"),
          weekday: weekdayName(series.dates[0] ?? ""),
          start: series.start,
          end: series.end,
          station_ids: series.stationIds,
          weeks: series.weeks,
        };
        await releaseOwnHolds(client, member, kitchen, occurrences, user, now);
        const card = await cardInForce(kitchen, now, client);
        const done = await bookOccurrences({ client, actor: user, kitchen, stations, member, card, occurrences, holdId: null, series: record, now });
        const amounts = done.billingAmountCents === null || done.invoice.killbill_invoice_id === null
          ? null
          : new Map([[done.invoice.killbill_invoice_id, done.billingAmountCents]]);
        return json(201, {
          series: { ...record, booking_ids: done.bookings.map((b) => b.id) },
          bookings: done.bookings.map((b) => bookingView(b, stations)),
          invoice: invoiceView(done.invoice, amounts),
        });
      });
    });
  }),
);

/** The changed price of a series, in Quote shape, for quote_changed. */
function seriesQuote(occurrences: Occurrence[], total: number): Quote {
  const first = occurrences[0]?.quote;
  const lines = occurrences.flatMap((o) => o.quote.lines);
  const quarters = occurrences.reduce((sum, o) => sum + o.quote.quarters, 0);
  return {
    month: first?.month ?? "",
    month_hours_before: first?.month_hours_before ?? "0.00",
    rate_card_id: first?.rate_card_id ?? "",
    lines,
    tier_steps_crossed: [...new Set(occurrences.flatMap((o) => o.quote.tier_steps_crossed))],
    pack_quarters: occurrences.reduce((sum, o) => sum + o.quote.pack_quarters, 0),
    quarters,
    hours: hoursText(quarters),
    total_cents: total,
    total: dollars(total),
  };
}
