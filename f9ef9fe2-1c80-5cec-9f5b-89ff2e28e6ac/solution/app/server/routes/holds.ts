import { config } from "../config.js";
import { audit, lockKitchenDates, pool, transaction } from "../db.js";
import type { Cell, HoldRow, Kitchen, Member, Station, User } from "../domain.js";
import { ApiError, refuse } from "../errors.js";
import { json, route } from "../http.js";
import { idempotencyKey, idempotent } from "../idempotency.js";
import { bookOccurrences, newId } from "../bookingUnit.js";
import { priceCells, type Priced } from "../pricing.js";
import { coveredUntil, covers, requireLiveHold } from "../rules.js";
import { requireUp } from "../services.js";
import {
  cardInForce,
  cellKey,
  checkPackHours,
  type Queryable,
  holdFor,
  loadKitchen,
  loadStations,
  memberDocuments,
  memberFor,
  monthQuarters,
  occupants,
  packBalance,
  sortCells,
} from "../store.js";
import { kitchenDate } from "../kitchenTime.js";
import { bookingView, holdView, invoiceView } from "../views.js";
import {
  allow,
  authed,
  bodyOf,
  readBookableDate,
  checkSameDay,
  type Errors,
  failIfAny,
  readBoolean,
  readCells,
  readWholeCents,
} from "../validate.js";

/** Prices cells for a member with the card in force today, optionally drawing pack hours. */
async function quoteFor(
  member: Member,
  kitchen: Kitchen,
  stations: Station[],
  date: string,
  cells: Cell[],
  usePack: boolean,
  now: Date,
  db: Queryable = pool,
): Promise<Priced> {
  const card = await cardInForce(kitchen, now, db);
  const month = date.slice(0, 7);
  const before = await monthQuarters(member.id, month, db);
  const balance = usePack ? await packBalance(member.id, db) : 0;
  return priceCells(cells, stations, card, month, before, balance);
}

export async function memberCover(member: Member, kitchen: Kitchen, now: Date): Promise<string | null> {
  return coveredUntil(await memberDocuments(member.id), kitchenDate(kitchen.timezone, now));
}

/**
 * The member a quote, hold or series is for. Members act for themselves; operators name one with
 * member_id. A member_id outside the user's reach is not found (checked first); a missing one is a
 * validation error, reported by `requireMember` with the other field errors. Stations of another
 * kitchen are a cell check, answered `validation` like any off-grid cell.
 */
export async function targetMember(user: User, body: Record<string, unknown>): Promise<Member | null> {
  if (typeof body.member_id === "string") return memberFor(user, body.member_id);
  if (user.role === "member" && user.member_id) return memberFor(user, user.member_id);
  return null;
}

export function requireMember(member: Member | null, errors: Errors): Member {
  if (member) return member;
  throw refuse.validation({ ...errors, member_id: "Choose the member to book for." });
}

const strip = (cells: Cell[]): Cell[] => cells.map((c) => ({ station_id: c.station_id, start: c.start }));

route(
  "POST",
  "/api/quotes",
  authed(async (request, user, now) => {
    const body = bodyOf(request);
    const target = await targetMember(user, body);
    allow(user, "operator", "member");
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const errors: Errors = {};
    const date = readBookableDate(body.date, kitchen, now, errors);
    const cells = readCells(body.cells, stations, errors);
    const usePack = readBoolean(body.use_pack, "use_pack", errors);
    const member = requireMember(target, errors);
    failIfAny(errors);
    const taken = new Set((await occupants(kitchen.id, date, now)).map((o) => cellKey(o.cell)));
    const papers = covers(await memberCover(member, kitchen, now), date) ? [] : cells;
    const priced = cells.filter((c) => !taken.has(cellKey(c)) && papers.length === 0);
    const { quote } = await quoteFor(member, kitchen, stations, date, priced, usePack, now);
    return json(200, {
      quote,
      taken: strip(sortCells(cells.filter((c) => taken.has(cellKey(c))), stations)),
      papers: strip(sortCells(papers, stations)),
    });
  }),
);

route(
  "POST",
  "/api/holds",
  authed(async (request, user, now) => {
    const body = bodyOf(request);
    const target = await targetMember(user, body);
    allow(user, "operator", "member");
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const errors: Errors = {};
    const date = readBookableDate(body.date, kitchen, now, errors);
    const cells = readCells(body.cells, stations, errors);
    const member = requireMember(target, errors);
    failIfAny(errors);
    if (!covers(await memberCover(member, kitchen, now), date)) throw refuse.complianceBlocked(date);
    checkSameDay(kitchen, date, cells.map((c) => c.start), now);
    const { hold, taken } = await transaction(async (client) => {
      await lockKitchenDates(client, kitchen.id, [date]);
      const busy = new Set((await occupants(kitchen.id, date, now, client)).map((o) => cellKey(o.cell)));
      const free = sortCells(cells.filter((c) => !busy.has(cellKey(c))), stations);
      const lost = strip(sortCells(cells.filter((c) => busy.has(cellKey(c))), stations));
      if (free.length === 0) throw refuse.cellsTaken(lost);
      const row: HoldRow = {
        id: newId("hold"),
        kitchen_id: kitchen.id,
        member_id: member.id,
        date,
        cells: free,
        state: "held",
        created_at: now,
        expires_at: new Date(now.getTime() + config.holdSeconds * 1000),
      };
      await client.query(
        `INSERT INTO holds (id, kitchen_id, member_id, date, cells, state, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,'held',$6,$7)`,
        [row.id, row.kitchen_id, row.member_id, row.date, JSON.stringify(row.cells), row.created_at, row.expires_at],
      );
      await audit(client, user.id, "hold", row.id, null, "held", now);
      return { hold: row, taken: lost };
    });
    const { quote } = await quoteFor(member, kitchen, stations, date, hold.cells, false, now);
    return json(201, { hold: holdView(hold, kitchen, now, quote), taken });
  }),
);

route(
  "GET",
  "/api/holds/:hold_id",
  authed(async (request, user, now) => {
    const hold = await holdFor(user, request.params.hold_id ?? "");
    allow(user, "operator", "member");
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const member = await memberFor(user, hold.member_id);
    const usePack = request.query.get("use_pack") === "true";
    const { quote } = await quoteFor(member, kitchen, stations, hold.date, hold.cells, usePack, now);
    return json(200, { hold: holdView(hold, kitchen, now, quote) });
  }),
);

route(
  "DELETE",
  "/api/holds/:hold_id",
  authed(async (request, user, now) => {
    const found = await holdFor(user, request.params.hold_id ?? "");
    allow(user, "operator", "member");
    const kitchen = await loadKitchen(user.kitchen_id);
    const stations = await loadStations(kitchen.id);
    const member = await memberFor(user, found.member_id);
    const hold = await transaction(async (client) => {
      const locked = await holdFor(user, found.id, client, true);
      requireLiveHold(locked, now);
      await client.query("UPDATE holds SET state = 'released' WHERE id = $1", [locked.id]);
      await audit(client, user.id, "hold", locked.id, "held", "released", now);
      return { ...locked, state: "released" as const };
    });
    const { quote } = await quoteFor(member, kitchen, stations, hold.date, hold.cells, false, now);
    return json(200, { hold: holdView(hold, kitchen, now, quote) });
  }),
);

/** Releases a hold after a failed confirm, so its cells are free again. */
async function releaseAfterFailure(holdId: string, actor: User, now: Date): Promise<void> {
  await transaction(async (client) => {
    const released = await client.query("UPDATE holds SET state = 'released' WHERE id = $1 AND state = 'held'", [holdId]);
    if (released.rowCount === 1) await audit(client, actor.id, "hold", holdId, "held", "released", now);
  });
}

route(
  "POST",
  "/api/holds/:hold_id/confirm",
  authed(async (request, user, now) => {
    const found = await holdFor(user, request.params.hold_id ?? "");
    allow(user, "operator", "member");
    const key = idempotencyKey(request);
    return idempotent(user, key, request, async () => {
      const body = bodyOf(request);
      const kitchen = await loadKitchen(user.kitchen_id);
      const stations = await loadStations(kitchen.id);
      const member = await memberFor(user, found.member_id);
      try {
        return await transaction(async (client) => {
          await lockKitchenDates(client, kitchen.id, [found.date]);
          await client.query("SELECT id FROM members WHERE id = $1 FOR NO KEY UPDATE", [member.id]);
          const hold = await holdFor(user, found.id, client, true);
          requireLiveHold(hold, now);
          const errors: Errors = {};
          const usePack = readBoolean(body.use_pack, "use_pack", errors);
          const quoted = readWholeCents(body.quoted_total_cents, "quoted_total_cents", errors);
          await checkPackHours(member.id, usePack, errors, client);
          failIfAny(errors);
          if (!covers(await memberCover(member, kitchen, now), hold.date)) throw refuse.complianceBlocked(hold.date);
          const priced = await quoteFor(member, kitchen, stations, hold.date, hold.cells, usePack, now, client);
          if (priced.quote.total_cents !== quoted) throw refuse.quoteChanged(priced.quote);
          requireUp("billing", "mail");
          const card = await cardInForce(kitchen, now, client);
          const done = await bookOccurrences({
            client,
            actor: user,
            kitchen,
            stations,
            member,
            card,
            occurrences: [{ date: hold.date, cells: hold.cells, quote: priced.quote }],
            holdId: hold.id,
            series: null,
            now,
          });
          await client.query("UPDATE holds SET state = 'confirmed' WHERE id = $1", [hold.id]);
          await audit(client, user.id, "hold", hold.id, "held", "confirmed", now);
          const amounts = done.billingAmountCents === null || done.invoice.killbill_invoice_id === null
            ? null
            : new Map([[done.invoice.killbill_invoice_id, done.billingAmountCents]]);
          const [booking] = done.bookings;
          if (!booking) throw new Error("confirm produced no booking");
          return json(201, { booking: bookingView(booking, stations), invoice: invoiceView(done.invoice, amounts) });
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 503) await releaseAfterFailure(found.id, user, now);
        throw error;
      }
    });
  }),
);
