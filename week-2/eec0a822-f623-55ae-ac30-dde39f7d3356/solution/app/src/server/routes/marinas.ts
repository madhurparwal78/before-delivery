import { randomUUID } from "node:crypto";
import { one, pool, rows, transaction, type Db } from "../db";
import { conflict, notFound, type Json } from "../http";
import { route, type Ctx } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { centimetresToMetres } from "../../shared/money";
import { addDays, isoInstant, localDate, type Base } from "../../shared/zones";
import { berthFits, daySlots, priceNights, SLOT_MS, slotStatus, tariffsOf, type BerthRow, type Night } from "../domain/berths";
import { splitToday } from "../domain/weeks";
import { visibleYacht } from "../domain/yachts";

interface MarinaRow {
  id: string;
  name: string;
  base: Base;
}

const READERS = ["charter_manager", "finance_lead", "captain"] as const;

async function marinaOf(db: Db, workspace: string, id: unknown): Promise<MarinaRow> {
  const marina = typeof id === "string" ? await one<MarinaRow>(db, "SELECT id, name, base FROM marinas WHERE workspace_slug = $1 AND id = $2", [workspace, id]) : undefined;
  if (!marina) throw notFound();
  return marina;
}

async function berthsOf(db: Db, workspace: string, marinaId: string): Promise<BerthRow[]> {
  return rows<BerthRow>(db, "SELECT code, length_cm, width_cm, depth_cm FROM berths WHERE workspace_slug = $1 AND marina_id = $2 ORDER BY code", [workspace, marinaId]);
}

function tariffJson(t: { id: string; effective_date: string; rate_per_metre_minor: number }): Json {
  return { id: t.id, effectiveDate: t.effective_date, ratePerMetreMinor: t.rate_per_metre_minor, currency: "EUR" };
}

route("GET", "/api/w/:ws/marinas", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(READERS);
    const marinas = await rows<MarinaRow>(pool, "SELECT id, name, base FROM marinas WHERE workspace_slug = $1 ORDER BY name", [ctx.params.ws]);
    const out = [];
    for (const m of marinas) {
      const pontoons = await rows<{ code: string; limit_kw: number }>(pool,
        "SELECT code, limit_kw FROM pontoons WHERE workspace_slug = $1 AND marina_id = $2 ORDER BY code", [ctx.params.ws, m.id]);
      out.push({
        id: m.id,
        name: m.name,
        base: m.base,
        today: localDate(ctx.now, m.base),
        berths: (await berthsOf(pool, ctx.params.ws, m.id)).map((b) => ({
          code: b.code, lengthM: centimetresToMetres(b.length_cm), widthM: centimetresToMetres(b.width_cm), depthM: centimetresToMetres(b.depth_cm),
        })),
        pontoons: pontoons.map((p) => ({ code: p.code, limitKw: p.limit_kw })),
        tariffs: (await tariffsOf(pool, ctx.params.ws, m.id)).map(tariffJson),
      });
    }
    return { status: 200, body: { marinas: out } };
  },
});

/** Arrival date and nights of a stay: the arrival on or after the marina's local today, 1 to 14 nights. */
function stayFields(fields: Fields, marina: MarinaRow, arrivalRaw: unknown, nightsRaw: unknown, nowMs: number): { arrival: string | null; nights: number | null } {
  const arrival = fields.date("arrivalDate", arrivalRaw);
  if (arrival && arrival < localDate(nowMs, marina.base)) fields.fail("arrivalDate", FIELD.arrival);
  const nights = fields.whole("nights", nightsRaw, 1, 14);
  return { arrival, nights };
}

async function takenNights(db: Db, workspace: string, marinaId: string, from: string, to: string): Promise<Set<string>> {
  const taken = await rows<{ berth_code: string }>(db,
    "SELECT DISTINCT berth_code FROM berth_nights WHERE workspace_slug = $1 AND marina_id = $2 AND night >= $3 AND night < $4",
    [workspace, marinaId, from, to]);
  return new Set(taken.map((t) => t.berth_code));
}

route("GET", "/api/w/:ws/marinas/:marina/berths", {
  staff: true,
  handle: async (ctx) => {
    const marina = await marinaOf(pool, ctx.params.ws, ctx.params.marina);
    ctx.allow(["captain"]);
    const yacht = await visibleYacht(pool, ctx.member, ctx.query("yachtSlug") ?? "");
    const fields = new Fields();
    const nightsText = ctx.query("nights");
    const { arrival, nights } = stayFields(fields, marina, ctx.query("arrivalDate"), nightsText && /^\d+$/.test(nightsText) ? Number(nightsText) : nightsText, ctx.now);
    fields.check();
    const tariffs = await tariffsOf(pool, ctx.params.ws, marina.id);
    const taken = await takenNights(pool, ctx.params.ws, marina.id, arrival!, addDays(arrival!, nights!));
    const berths = (await berthsOf(pool, ctx.params.ws, marina.id)).map((b) => {
      const priced = priceNights(tariffs, yacht.length_cm, arrival!, nights!);
      return {
        code: b.code,
        lengthM: centimetresToMetres(b.length_cm),
        widthM: centimetresToMetres(b.width_cm),
        depthM: centimetresToMetres(b.depth_cm),
        fits: berthFits(yacht, b),
        available: !taken.has(b.code),
        nights: priced as unknown as Json,
        totalMinor: priced.reduce((sum, n) => sum + n.feeMinor, 0),
        currency: "EUR",
      };
    });
    return { status: 200, body: { berths } };
  },
});

interface BookingRow {
  id: string;
  yacht_slug: string;
  marina_id: string;
  berth_code: string;
  arrival_date: string;
  departure_date: string;
  nights: Night[];
  total_minor: number;
  booked_by: string;
  booked_at: Date;
}

function bookingJson(b: BookingRow): Json {
  return {
    id: b.id,
    yachtSlug: b.yacht_slug,
    marinaId: b.marina_id,
    berthCode: b.berth_code,
    arrivalDate: b.arrival_date,
    departureDate: b.departure_date,
    nights: b.nights as unknown as Json,
    totalMinor: b.total_minor,
    currency: "EUR",
    bookedBy: b.booked_by,
    bookedAt: isoInstant(b.booked_at.getTime()),
  };
}

async function bookingById(db: Db, workspace: string, id: string): Promise<BookingRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return one<BookingRow>(db,
    "SELECT b.*, y.slug AS yacht_slug FROM berth_bookings b JOIN yachts y ON y.id = b.yacht_id WHERE b.id = $1 AND b.workspace_slug = $2",
    [id, workspace]);
}

route("POST", "/api/w/:ws/berth-bookings", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["captain"]);
    const body = asBody(await ctx.json());
    const id = await transaction(async (db) => {
      if (typeof body.yachtSlug !== "string") throw notFound();
      const yacht = await visibleYacht(db, ctx.member, body.yachtSlug);
      const marina = await marinaOf(db, ctx.params.ws, body.marinaId);
      const berth = (await berthsOf(db, ctx.params.ws, marina.id)).find((b) => b.code === body.berthCode);
      if (!berth) throw notFound();
      await db.query("SELECT 1 FROM berths WHERE workspace_slug = $1 AND marina_id = $2 AND code = $3 FOR UPDATE", [ctx.params.ws, marina.id, berth.code]);
      const fields = new Fields();
      const { arrival, nights } = stayFields(fields, marina, body.arrivalDate, body.nights, ctx.now);
      if (!berthFits(yacht, berth)) throw conflict("does_not_fit");
      if (arrival && nights && (await takenNights(db, ctx.params.ws, marina.id, arrival, addDays(arrival, nights))).has(berth.code)) {
        throw conflict("berth_taken");
      }
      fields.check();
      const priced = priceNights(await tariffsOf(db, ctx.params.ws, marina.id), yacht.length_cm, arrival!, nights!);
      const bookingId = randomUUID();
      await db.query(
        `INSERT INTO berth_bookings (id, workspace_slug, yacht_id, marina_id, berth_code, arrival_date, departure_date, nights, total_minor, booked_by, booked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
        [bookingId, ctx.params.ws, yacht.id, marina.id, berth.code, arrival, addDays(arrival!, nights!), JSON.stringify(priced),
          priced.reduce((sum, n) => sum + n.feeMinor, 0), ctx.member.name],
      );
      await db.query(
        "INSERT INTO berth_nights (workspace_slug, marina_id, berth_code, night, booking_id) SELECT $1, $2, $3, unnest($4::date[]), $5",
        [ctx.params.ws, marina.id, berth.code, priced.map((n) => n.date), bookingId],
      );
      return bookingId;
    });
    return { status: 201, body: { booking: bookingJson((await bookingById(pool, ctx.params.ws, id))!) } };
  },
});

route("GET", "/api/w/:ws/berth-bookings/:id", {
  staff: true,
  handle: async (ctx) => {
    const booking = await bookingById(pool, ctx.params.ws, ctx.params.id);
    if (!booking) throw notFound();
    ctx.allow(["captain"]);
    return { status: 200, body: { booking: bookingJson(booking) } };
  },
});

route("POST", "/api/w/:ws/marinas/:marina/tariffs", {
  staff: true,
  handle: async (ctx) => {
    const marina = await marinaOf(pool, ctx.params.ws, ctx.params.marina);
    ctx.allow(["finance_lead"]);
    const body = asBody(await ctx.json());
    const fields = new Fields();
    const date = fields.date("effectiveDate", body.effectiveDate);
    if (date && date <= localDate(ctx.now, marina.base)) fields.fail("effectiveDate", FIELD.effective);
    const rate = fields.whole("ratePerMetreMinor", body.ratePerMetreMinor, 1, 100000);
    if (date && (await one(pool, "SELECT 1 FROM tariffs WHERE workspace_slug = $1 AND marina_id = $2 AND effective_date = $3", [ctx.params.ws, marina.id, date]))) {
      throw conflict("date_exists");
    }
    fields.check();
    const tariff = await insertUnique(() => one<{ id: string; effective_date: string; rate_per_metre_minor: number }>(pool,
      "INSERT INTO tariffs (id, workspace_slug, marina_id, effective_date, rate_per_metre_minor) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [randomUUID(), ctx.params.ws, marina.id, date, rate]));
    return { status: 201, body: { tariff: tariffJson(tariff!) } };
  },
});

async function insertUnique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw conflict("date_exists");
    throw error;
  }
}

interface TableRow {
  id: string;
  effective_date: string;
  gbp: string;
  usd: string;
}

const tableJson = (t: TableRow): Json => ({ id: t.id, effectiveDate: t.effective_date, rates: { GBP: t.gbp, USD: t.usd } });

route("GET", "/api/w/:ws/exchange-tables", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(READERS);
    const tables = await rows<TableRow>(pool, "SELECT * FROM exchange_tables WHERE workspace_slug = $1 ORDER BY effective_date", [ctx.params.ws]);
    return { status: 200, body: { exchangeTables: tables.map(tableJson) } };
  },
});

route("POST", "/api/w/:ws/exchange-tables", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["finance_lead"]);
    const body = asBody(await ctx.json());
    const fields = new Fields();
    const date = fields.date("effectiveDate", body.effectiveDate);
    if (date && date <= splitToday(ctx.now)) fields.fail("effectiveDate", FIELD.effective);
    const rates = asBody(body.rates);
    for (const code of ["GBP", "USD"]) {
      const value = rates[code];
      if (value === undefined || value === null || value === "") fields.fail(`rates.${code}`, FIELD.required);
      else if (typeof value !== "string" || !/^\d+(\.\d{1,6})?$/.test(value) || !/[1-9]/.test(value)) fields.fail(`rates.${code}`, FIELD.rate);
    }
    if (date && (await one(pool, "SELECT 1 FROM exchange_tables WHERE workspace_slug = $1 AND effective_date = $2", [ctx.params.ws, date]))) {
      throw conflict("date_exists");
    }
    fields.check();
    const table = await insertUnique(() => one<TableRow>(pool,
      "INSERT INTO exchange_tables (id, workspace_slug, effective_date, gbp, usd) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [randomUUID(), ctx.params.ws, date, rates.GBP, rates.USD]));
    return { status: 201, body: { exchangeTable: tableJson(table!) } };
  },
});

async function pontoonOf(db: Db, ctx: Ctx, marinaId: unknown, code: unknown) {
  const marina = await marinaOf(db, ctx.params.ws, marinaId);
  const pontoon = typeof code === "string"
    ? await one<{ code: string; limit_kw: number }>(db, "SELECT code, limit_kw FROM pontoons WHERE workspace_slug = $1 AND marina_id = $2 AND code = $3",
      [ctx.params.ws, marina.id, code])
    : undefined;
  if (!pontoon) throw notFound();
  return { marina, pontoon };
}

interface SlotBookingRow {
  id: string;
  yacht_slug: string;
  yacht_name: string;
  member_name: string;
  slot_start: Date;
  kw: number;
  booked_at: Date;
}

async function slotBookings(db: Db, workspace: string, marinaId: string, code: string, from: number, to: number): Promise<SlotBookingRow[]> {
  return rows<SlotBookingRow>(db,
    `SELECT s.id, y.slug AS yacht_slug, y.name AS yacht_name, s.booked_by AS member_name, s.slot_start, s.kw, s.booked_at
       FROM shore_power_bookings s JOIN yachts y ON y.id = s.yacht_id
      WHERE s.workspace_slug = $1 AND s.marina_id = $2 AND s.pontoon_code = $3 AND s.slot_start >= $4 AND s.slot_start < $5
      ORDER BY s.booked_at, s.id`,
    [workspace, marinaId, code, new Date(from), new Date(to)]);
}

route("GET", "/api/w/:ws/marinas/:marina/pontoons/:code/slots", {
  staff: true,
  handle: async (ctx) => {
    const { marina, pontoon } = await pontoonOf(pool, ctx, ctx.params.marina, ctx.params.code);
    ctx.allow(["captain"]);
    const fields = new Fields();
    const date = fields.date("date", ctx.query("date"));
    fields.check();
    const starts = daySlots(date!, marina.base);
    const bookings = await slotBookings(pool, ctx.params.ws, marina.id, pontoon.code, starts[0], starts[starts.length - 1] + SLOT_MS);
    const now = Date.now();
    return {
      status: 200,
      body: {
        date,
        base: marina.base,
        limitKw: pontoon.limit_kw,
        slots: starts.map((ms) => {
          const here = bookings.filter((b) => b.slot_start.getTime() === ms);
          const booked = here.reduce((sum, b) => sum + b.kw, 0);
          return {
            startsAt: isoInstant(ms),
            endsAt: isoInstant(ms + SLOT_MS),
            status: slotStatus(ms, now, pontoon.limit_kw, booked),
            bookedKw: booked,
            bookings: here.map((b) => ({ yachtSlug: b.yacht_slug, yachtName: b.yacht_name })),
          };
        }),
      },
    };
  },
});

route("POST", "/api/w/:ws/shore-power-bookings", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["captain"]);
    const body = asBody(await ctx.json());
    const booking = await transaction(async (db) => {
      if (typeof body.yachtSlug !== "string") throw notFound();
      const yacht = await visibleYacht(db, ctx.member, body.yachtSlug);
      const { marina, pontoon } = await pontoonOf(db, ctx, body.marinaId, body.pontoonCode);
      await db.query("SELECT 1 FROM pontoons WHERE workspace_slug = $1 AND marina_id = $2 AND code = $3 FOR UPDATE", [ctx.params.ws, marina.id, pontoon.code]);
      const fields = new Fields();
      const raw = typeof body.slotStart === "string" ? body.slotStart : "";
      const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw) ? Date.parse(raw) : NaN;
      if (!raw) fields.fail("slotStart", FIELD.required);
      else if (Number.isNaN(ms) || ms % SLOT_MS !== 0) fields.fail("slotStart", FIELD.slot);
      if (fields.ok) {
        const here = await slotBookings(db, ctx.params.ws, marina.id, pontoon.code, ms, ms + SLOT_MS);
        const booked = here.reduce((sum, b) => sum + b.kw, 0);
        if (slotStatus(ms, Date.now(), pontoon.limit_kw, booked) === "past") throw conflict("slot_past");
        if (here.some((b) => b.yacht_slug === yacht.slug)) throw conflict("already_booked");
        if (booked + yacht.shore_power_kw > pontoon.limit_kw) {
          const latest = here[here.length - 1];
          throw conflict("slot_taken", { takenBy: `${latest.member_name} for ${latest.yacht_name}`, takenAt: isoInstant(latest.booked_at.getTime()) });
        }
      }
      fields.check();
      return (await one<{ id: string; slot_start: Date; kw: number; booked_by: string; booked_at: Date }>(db,
        `INSERT INTO shore_power_bookings (id, workspace_slug, yacht_id, marina_id, pontoon_code, slot_start, kw, booked_by, booked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING *`,
        [randomUUID(), ctx.params.ws, yacht.id, marina.id, pontoon.code, new Date(ms), yacht.shore_power_kw, ctx.member.name]))!;
    });
    return {
      status: 201,
      body: {
        booking: {
          id: booking.id,
          yachtSlug: body.yachtSlug as string,
          marinaId: body.marinaId as string,
          pontoonCode: body.pontoonCode as string,
          slotStart: isoInstant(booking.slot_start.getTime()),
          slotEnd: isoInstant(booking.slot_start.getTime() + SLOT_MS),
          kw: booking.kw,
          bookedBy: booking.booked_by,
          bookedAt: isoInstant(booking.booked_at.getTime()),
        },
      },
    };
  },
});
