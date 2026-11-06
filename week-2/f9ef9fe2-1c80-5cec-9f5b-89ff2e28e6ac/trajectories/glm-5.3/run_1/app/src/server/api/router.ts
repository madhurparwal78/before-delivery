import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { Config } from "../config";
import { ApiError, billingUnavailable, cellInPast, cellsTaken, complianceBlocked, fileTooLarge, forbidden, holdExpired, holdNotActive, idempotencyKeyReused, invalidCredentials, invalidJson, invalidTransition, bookingDayNotReached, mailUnavailable, filesUnavailable, notFound, payloadTooLarge, quoteChanged, rateCardExists, sameDayClosed, seriesConflict, unauthenticated, unsupportedMediaType, validation } from "../errors";
import { kitchenDate, kitchenTime, addDays, kitchenInstant, monthOf, dayOfWeek, isValidDate, isValidWallTime, timeHourMinutes, quarterOf, timeFromQuarter } from "../kitchenTime";
import { type Cell, type Line, type Quote, type Station, formatHours, formatMoney, priceCells, type RateCard } from "../domain";
import * as store from "../store";
import { withTx, lockKitchenDate, pool, type Tx } from "../db";
import { checkOrigin, readJsonBody, readRawBody, FILE_PART_LIMIT, UPLOAD_BODY_LIMIT } from "./boundary";
import { cellsForRange, checkCellGuards, checkHorizon, checkIdempotencyKey, monthValue, parseCells, parseDate, requireString, wallRange, weeksValue } from "./validate";
import { verifyPassword, newToken } from "../passwords";
import type { ServiceStatus } from "../services/status";
import type { Killbill } from "../services/killbill";
import type { ObjectStorage } from "../services/storage";
import type { MailService } from "../services/mail";
import { cancellationEmail, confirmationEmail, seriesEmail } from "../emails";
import busboy from "busboy";

export interface Ctx {
  config: Config;
  status: ServiceStatus;
  killbill: Killbill;
  storage: ObjectStorage;
  mail: MailService;
}

type RouteHandler = (req: Request, res: Response) => unknown;

interface Registrar {
  get(path: string, handler: RouteHandler): Registrar;
  post(path: string, handler: RouteHandler): Registrar;
  patch(path: string, handler: RouteHandler): Registrar;
  delete(path: string, handler: RouteHandler): Registrar;
}

/** Routes register one handler whose promise rejections reach the error middleware. */
function asyncRouter(): { reg: Registrar; router: Router } {
  const router: Router = Router();
  const wrap =
    (handler: RouteHandler) =>
    (req: Request, res: Response, next: NextFunction): void => {
      Promise.resolve(handler(req, res)).catch(next);
    };
  const reg: Registrar = {
    get(path, handler) {
      router.get(path, wrap(handler));
      return reg;
    },
    post(path, handler) {
      router.post(path, wrap(handler));
      return reg;
    },
    patch(path, handler) {
      router.patch(path, wrap(handler));
      return reg;
    },
    delete(path, handler) {
      router.delete(path, wrap(handler));
      return reg;
    },
  };
  return { reg, router };
}

export function buildRouter(ctx: Ctx): Router {
  const { reg: router, router: expressRouter } = asyncRouter();

  // ---------- session ----------

  const SESSION_COOKIE = "pl_session";

  function parseCookies(req: Request): Record<string, string> {
    const header = req.headers.cookie;
    const out: Record<string, string> = {};
    if (!header) {
      return out;
    }
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index > 0) {
        out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
      }
    }
    return out;
  }

  async function currentUser(req: Request): Promise<store.UserRow | null> {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) {
      return null;
    }
    const result = await pool.query(
      `SELECT u.id, u.kitchen_id, u.member_id, u.name, u.email, u.password_hash, u.role::text AS role
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()`,
      [token]
    );
    return result.rows[0] ? (result.rows[0] as unknown as store.UserRow) : null;
  }

  async function requireUser(req: Request): Promise<store.UserRow> {
    const user = await currentUser(req);
    if (!user) {
      throw unauthenticated();
    }
    return user;
  }

  function userJson(user: store.UserRow): Record<string, unknown> {
    return { id: user.id, name: user.name, email: user.email, role: user.role, kitchen_id: user.kitchen_id, member_id: user.member_id };
  }

  // ---------- kitchen helpers ----------

  async function requireKitchen(user: store.UserRow, kitchenId: string): Promise<store.KitchenRow> {
    if (user.kitchen_id !== kitchenId) {
      throw notFound();
    }
    const kitchen = await store.getKitchen(pool, kitchenId);
    if (!kitchen) {
      throw notFound();
    }
    return kitchen;
  }

  /** The member a request acts for: operators must pass one, members are themselves. */
  async function resolveActorMember(user: store.UserRow, rawMemberId: unknown): Promise<store.MemberRow> {
    if (user.role === "member") {
      if (!user.member_id) {
        throw notFound();
      }
      const member = await store.getMember(pool, user.member_id);
      if (!member) {
        throw notFound();
      }
      return member;
    }
    const memberId = requireString(rawMemberId, "member_id");
    const member = await store.getMember(pool, memberId);
    if (!member || member.kitchen_id !== user.kitchen_id) {
      throw notFound();
    }
    return member;
  }

  function todayIn(kitchen: store.KitchenRow): string {
    return kitchenDate(new Date(), kitchen.timezone);
  }

  // ---------- JSON shapes ----------

  function quoteJson(quote: Quote): Record<string, unknown> {
    return { ...quote };
  }

  function blocksOf(cells: Cell[], stations: Station[]): Array<Record<string, unknown>> {
    const byId = new Map(stations.map((station) => [station.id, station]));
    const grouped = new Map<string, number[]>();
    for (const cell of cells) {
      const list = grouped.get(cell.station_id) ?? [];
      list.push(quarterOf(cell.start));
      grouped.set(cell.station_id, list);
    }
    const blocks: Array<Record<string, unknown>> = [];
    for (const [stationId, qs] of grouped) {
      qs.sort((a, b) => a - b);
      let runStart = qs[0]!;
      let previous = qs[0]!;
      const flush = (start: number, end: number): void => {
        const station = byId.get(stationId);
        blocks.push({
          station_id: stationId,
          station: station?.name ?? stationId,
          start: timeFromQuarter(start),
          end: timeFromQuarter(end + 1),
          hours: formatHours(end - start + 1),
        });
      };
      for (const q of qs.slice(1)) {
        if (q !== previous + 1) {
          flush(runStart, previous);
          runStart = q;
        }
        previous = q;
      }
      flush(runStart, previous);
    }
    return blocks;
  }

  function bookingJson(booking: store.BookingRow, cells: Cell[], stations: Station[]): Record<string, unknown> {
    return {
      id: booking.id,
      ref: booking.ref,
      member_id: booking.member_id,
      kitchen_id: booking.kitchen_id,
      date: booking.date,
      state: booking.state,
      cells,
      blocks: blocksOf(cells, stations),
      starts_at: booking.starts_at.toISOString(),
      ends_at: booking.ends_at.toISOString(),
      quarters: booking.quarters,
      hours: formatHours(booking.quarters),
      lines: booking.lines,
      pack_quarters: booking.pack_quarters,
      total_cents: booking.total_cents,
      total: formatMoney(booking.total_cents),
      rate_card_id: booking.rate_card_id,
      cancellation_window_hours: booking.cancellation_window_hours,
      confirmed_at: booking.confirmed_at.toISOString(),
      invoice_id: booking.invoice_id,
      series_id: booking.series_id,
    };
  }

  async function holdJson(hold: store.HoldRow, kitchen: store.KitchenRow, quote: Quote | null): Promise<Record<string, unknown>> {
    const cells = await store.getHoldCells(pool, hold.id);
    const readState = hold.state === "held" && hold.expires_at.getTime() <= Date.now() ? "expired" : hold.state;
    return {
      id: hold.id,
      member_id: hold.member_id,
      date: hold.date,
      state: readState,
      cells,
      expires_at: hold.expires_at.toISOString(),
      expires_local: kitchenTime(hold.expires_at, kitchen.timezone),
      server_now: new Date().toISOString(),
      ...(quote ? { quote: quoteJson(quote) } : {}),
    };
  }

  async function invoiceJson(invoice: store.InvoiceRow): Promise<Record<string, unknown>> {
    let billingAmountCents: number | null = null;
    if (invoice.killbill_invoice_id && ctx.status.isUp("billing")) {
      billingAmountCents = await ctx.killbill.invoiceAmountCents(invoice.killbill_invoice_id);
    }
    return {
      id: invoice.id,
      ref: invoice.ref,
      member_id: invoice.member_id,
      kind: invoice.kind,
      booking_ids: invoice.booking_ids,
      lines: invoice.lines,
      total_cents: invoice.total_cents,
      total: formatMoney(invoice.total_cents),
      killbill_invoice_id: invoice.killbill_invoice_id,
      billing_amount_cents: billingAmountCents,
      billing_amount: billingAmountCents === null ? null : formatMoney(billingAmountCents),
      issued_at: invoice.issued_at.toISOString(),
    };
  }

  function movementJson(movement: store.MovementRow): Record<string, unknown> {
    return {
      id: movement.id,
      kind: movement.kind,
      quarters: movement.quarters,
      booking_id: movement.booking_id,
      reverses: movement.reverses,
      created_at: movement.created_at.toISOString(),
      entries: movement.entries.map((entry) => ({ account: entry.account, quarters: entry.quarters })),
    };
  }

  function rateCardJson(card: RateCard, today: string): Record<string, unknown> {
    return {
      id: card.id,
      effective_from: card.effective_from,
      tier_rates_cents: card.tier_rates_cents,
      station_surcharges_cents: card.station_surcharges_cents,
      cancellation_window_hours: card.cancellation_window_hours,
      pack_price_cents: card.pack_price_cents,
      in_force: card.effective_from <= today,
      created_at: card.created_at.toISOString(),
    };
  }

  function documentJson(doc: store.DocumentRow, kitchen: store.KitchenRow): Record<string, unknown> {
    const labels: Record<string, string> = {
      insurance: "Insurance certificate",
      food_handler: "Food-handler card",
      kitchen_agreement: "Signed kitchen-use agreement",
    };
    return {
      id: doc.id,
      member_id: doc.member_id,
      type: doc.type,
      label: labels[doc.type] ?? doc.type,
      state: store.documentReadState(doc, kitchen, new Date()),
      expires_on: doc.expires_on,
      original_name: doc.original_name,
      size_bytes: doc.size_bytes,
      content_type: doc.content_type,
      uploaded_at: doc.uploaded_at.toISOString(),
      reject_reason: doc.reject_reason,
    };
  }

  // ---------- pricing ----------

  async function quoteFor(
    db: store.Db,
    kitchen: store.KitchenRow,
    member: store.MemberRow,
    date: string,
    cells: Cell[],
    usePack: boolean
  ): Promise<Quote> {
    const today = todayIn(kitchen);
    const stations = await store.getStations(db, kitchen.id);
    const byId = new Map(stations.map((station) => [station.id, station]));
    const rateCard = await store.getRateCardInForce(db, kitchen.id, today);
    if (!rateCard) {
      throw new ApiError(500, "no_rate_card", "No rate card is in force.");
    }
    const monthToDate = await store.monthToDateQuarters(db, member.id, monthOf(date));
    const balance = await store.packBalance(db, member.id);
    const priced = cells.map((cell) => ({
      station: byId.get(cell.station_id)!,
      startQ: quarterOf(cell.start),
    }));
    const { quote } = priceCells({
      cells: priced,
      monthToDateQuarters: monthToDate,
      packBalanceQuarters: balance,
      usePack,
      rateCard,
      month: monthOf(date),
    });
    return quote;
  }

  async function isCovered(db: store.Db, member: store.MemberRow, kitchen: store.KitchenRow, date: string): Promise<boolean> {
    const covered = await store.coveredUntil(db, member.id, todayIn(kitchen));
    return covered !== null && date <= covered;
  }

  // ---------- routes: health, status, session ----------

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/status", (_req, res) => {
    res.json({ services: ctx.status.snapshot(), paused: ctx.status.paused() });
  });

  router.post("/session", async (req, res) => {
    checkOrigin(req);
    const body = await readJsonBody(req);
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    const errors: Record<string, string> = {};
    if (email.length === 0) {
      errors.email = "Enter your email.";
    }
    if (password.length === 0) {
      errors.password = "Enter your password.";
    }
    if (Object.keys(errors).length > 0) {
      throw validation(errors);
    }
    const user = await store.getUserByEmail(pool, email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw invalidCredentials();
    }
    const token = newToken();
    await pool.query("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, now(), now() + interval '7 days')", [token, user.id]);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    res.json({ user: userJson(user) });
  });

  router.delete("/session", async (req, res) => {
    checkOrigin(req);
    await requireUser(req);
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) {
      await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    }
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.status(204).end();
  });

  router.get("/me", async (req, res) => {
    const user = await requireUser(req);
    res.json({ user: userJson(user) });
  });

  // ---------- kitchen, settings, loom ----------

  router.get("/kitchens/:kitchenId", async (req, res) => {
    const user = await requireUser(req);
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const stations = await store.getStations(pool, kitchen.id);
    res.json({
      kitchen: {
        id: kitchen.id,
        name: kitchen.name,
        timezone: kitchen.timezone,
        today: todayIn(kitchen),
        server_now: new Date().toISOString(),
        same_day_cutoff: kitchen.same_day_cutoff,
        hold_seconds: kitchen.hold_seconds,
        stations: stations.map((station) => ({ id: station.id, name: station.name, kind: station.kind, order: station.loom_order })),
      },
    });
  });

  router.patch("/kitchens/:kitchenId/settings", async (req, res) => {
    checkOrigin(req);
    const user = await requireUser(req);
    if (user.role !== "operator") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const body = await readJsonBody(req);
    const cutoff = body.same_day_cutoff;
    if (typeof cutoff !== "string" || !isValidWallTime(cutoff) || timeHourMinutes(cutoff) % 15 !== 0) {
      throw validation({ same_day_cutoff: "Enter a time on a quarter hour." });
    }
    await pool.query("UPDATE kitchens SET same_day_cutoff = $1 WHERE id = $2", [cutoff, kitchen.id]);
    const fresh = await store.getKitchen(pool, kitchen.id);
    const stations = await store.getStations(pool, kitchen.id);
    res.json({
      kitchen: {
        id: fresh!.id,
        name: fresh!.name,
        timezone: fresh!.timezone,
        today: todayIn(fresh!),
        server_now: new Date().toISOString(),
        same_day_cutoff: fresh!.same_day_cutoff,
        hold_seconds: fresh!.hold_seconds,
        stations: stations.map((station) => ({ id: station.id, name: station.name, kind: station.kind, order: station.loom_order })),
      },
    });
  });

  router.get("/kitchens/:kitchenId/loom", async (req, res) => {
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const date = typeof req.query.date === "string" ? req.query.date : "";
    if (!isValidDate(date)) {
      throw validation({ date: "Enter a date as YYYY-MM-DD." });
    }
    let member: store.MemberRow | null = null;
    const rawMemberId = req.query.member_id;
    if (user.role === "member") {
      if (!user.member_id) {
        throw notFound();
      }
      member = await store.getMember(pool, user.member_id);
      if (!member) {
        throw notFound();
      }
      if (typeof rawMemberId === "string" && rawMemberId !== member.id) {
        throw notFound();
      }
    } else if (typeof rawMemberId === "string" && rawMemberId.length > 0) {
      member = await store.getMember(pool, rawMemberId);
      if (!member || member.kitchen_id !== kitchen.id) {
        throw notFound();
      }
    }
    const occupied = await store.occupiedCells(pool, kitchen.id, date);
    const cells: Array<Record<string, unknown>> = [];
    for (const occupiedCell of occupied) {
      const start = timeFromQuarter(occupiedCell.startQ);
      if (user.role === "operator") {
        cells.push({
          station_id: occupiedCell.stationId,
          start,
          state: occupiedCell.kind,
          business: occupiedCell.business,
          ...(occupiedCell.kind === "held"
            ? { hold_id: occupiedCell.refId, expires_at: occupiedCell.expiresAt!.toISOString() }
            : { booking_id: occupiedCell.refId }),
        });
      } else {
        const own = occupiedCell.memberId === member!.id;
        cells.push(
          own
            ? {
                station_id: occupiedCell.stationId,
                start,
                state: occupiedCell.kind,
                ...(occupiedCell.kind === "held"
                  ? { hold_id: occupiedCell.refId, expires_at: occupiedCell.expiresAt!.toISOString() }
                  : { booking_id: occupiedCell.refId }),
              }
            : { station_id: occupiedCell.stationId, start, state: "taken" }
        );
      }
    }
    const stations = await store.getStations(pool, kitchen.id);
    const coveredUntil = member ? await store.coveredUntil(pool, member.id, todayIn(kitchen)) : null;
    res.json({
      date,
      today: todayIn(kitchen),
      server_now: new Date().toISOString(),
      timezone: kitchen.timezone,
      same_day_cutoff: kitchen.same_day_cutoff,
      hold_seconds: kitchen.hold_seconds,
      covered_until: coveredUntil,
      papers: member !== null && coveredUntil !== null && date <= coveredUntil,
      stations: stations.map((station) => ({ id: station.id, name: station.name, kind: station.kind, order: station.loom_order })),
      cells,
    });
  });

  // ---------- members ----------

  router.get("/kitchens/:kitchenId/members", async (req, res) => {
    const user = await requireUser(req);
    if (user.role !== "operator") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const members = await store.getMembers(pool, kitchen.id);
    const today = todayIn(kitchen);
    const out = [];
    for (const member of members) {
      const coveredUntil = await store.coveredUntil(pool, member.id, today);
      const monthHours = await store.monthToDateQuarters(pool, member.id, monthOf(today));
      const balance = await store.packBalance(pool, member.id);
      out.push({
        id: member.id,
        business: member.business,
        contact_email: member.contact_email,
        covered_until: coveredUntil,
        month_hours: formatHours(monthHours),
        pack_balance_quarters: balance,
      });
    }
    res.json({ members: out });
  });

  router.get("/members/:memberId", async (req, res) => {
    const user = await requireUser(req);
    const member = await store.getMember(pool, req.params.memberId!);
    if (!member || member.kitchen_id !== user.kitchen_id || (user.role === "member" && member.id !== user.member_id)) {
      throw notFound();
    }
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await store.getKitchen(pool, member.kitchen_id);
    const today = todayIn(kitchen!);
    const coveredUntil = await store.coveredUntil(pool, member.id, today);
    const monthHours = await store.monthToDateQuarters(pool, member.id, monthOf(today));
    const balance = await store.packBalance(pool, member.id);
    res.json({
      member: {
        id: member.id,
        business: member.business,
        contact_email: member.contact_email,
        covered_until: coveredUntil,
        month_hours: formatHours(monthHours),
        pack_balance_quarters: balance,
      },
    });
  });

  // ---------- quotes and holds ----------

  async function quoteOrHoldBody(req: Request): Promise<Record<string, unknown>> {
    checkOrigin(req);
    return readJsonBody(req);
  }

  router.post("/quotes", async (req, res) => {
    const body = await quoteOrHoldBody(req);
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, user.kitchen_id);
    const date = parseDate(body.date, "date");
    const member = await resolveActorMember(user, body.member_id);
    const stations = await store.getStations(pool, kitchen.id);
    const { cells, startQs } = parseCells(body.cells, stations, "cells");
    const usePack = body.use_pack === true;
    checkHorizon(date, todayIn(kitchen), "date");
    checkCellGuards(kitchen, date, startQs, new Date());
    const occupied = await store.occupiedCells(pool, kitchen.id, date, member.id);
    const taken = store.takenCellsOf(cells, occupied);
    const covered = await isCovered(pool, member, kitchen, date);
    const papers = covered ? [] : cells;
    const priceable = cells.filter((cell) => !taken.some((takenCell) => takenCell.station_id === cell.station_id && takenCell.start === cell.start) && covered);
    const quote = await quoteFor(pool, kitchen, member, date, priceable, usePack);
    res.json({ quote: quoteJson(quote), taken, papers });
  });

  router.post("/holds", async (req, res) => {
    const body = await quoteOrHoldBody(req);
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, user.kitchen_id);
    const date = parseDate(body.date, "date");
    const member = await resolveActorMember(user, body.member_id);
    const stations = await store.getStations(pool, kitchen.id);
    const { cells, startQs } = parseCells(body.cells, stations, "cells");
    const startQByKey = new Map(cells.map((cell, index) => [`${cell.station_id}|${cell.start}`, startQs[index]!]));
    checkHorizon(date, todayIn(kitchen), "date");
    checkCellGuards(kitchen, date, startQs, new Date());
    const covered = await isCovered(pool, member, kitchen, date);
    if (!covered) {
      throw complianceBlocked();
    }
    const result = await withTx(async (tx) => {
      await lockKitchenDate(tx, kitchen.id, date);
      const occupied = await store.occupiedCells(tx, kitchen.id, date);
      const taken = store.takenCellsOf(cells, occupied);
      const free = cells.filter((cell) => !taken.some((takenCell) => takenCell.station_id === cell.station_id && takenCell.start === cell.start));
      if (free.length === 0) {
        throw cellsTaken(taken);
      }
      const holdId = `hold-${randomBytes(12).toString("hex")}`;
      await tx.query(
        `INSERT INTO holds (id, kitchen_id, member_id, date, state, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 'held', now() + make_interval(secs => $5), now())`,
        [holdId, kitchen.id, member.id, date, kitchen.hold_seconds]
      );
      for (const cell of free) {
        await tx.query(`INSERT INTO hold_cells (hold_id, kitchen_id, date, station_id, start_q) VALUES ($1, $2, $3, $4, $5)`, [
          holdId,
          kitchen.id,
          date,
          cell.station_id,
          startQByKey.get(`${cell.station_id}|${cell.start}`)!,
        ]);
      }
      await store.insertAudit(tx, "hold", holdId, null, "held", user.id);
      return { holdId, free, taken };
    });
    const hold = await store.getHold(pool, result.holdId);
    const quote = await quoteFor(pool, kitchen, member, date, result.free, false);
    const holdOut = await holdJson(hold!, kitchen, null);
    holdOut.quote = quoteJson(quote);
    res.status(201).json({ hold: holdOut, taken: result.taken });
  });

  async function requireHoldAccess(req: Request): Promise<{ user: store.UserRow; hold: store.HoldRow }> {
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      const hold = await store.getHold(pool, req.params.holdId!);
      if (!hold) {
        throw notFound();
      }
      throw forbidden();
    }
    const hold = await store.getHold(pool, req.params.holdId!);
    if (!hold || hold.kitchen_id !== user.kitchen_id) {
      throw notFound();
    }
    if (user.role === "member" && hold.member_id !== user.member_id) {
      throw notFound();
    }
    return { user, hold };
  }

  router.get("/holds/:holdId", async (req, res) => {
    const { hold } = await requireHoldAccess(req);
    const kitchen = await store.getKitchen(pool, hold.kitchen_id);
    const member = await store.getMember(pool, hold.member_id);
    const cells = await store.getHoldCells(pool, hold.id);
    const readState = hold.state === "held" && hold.expires_at.getTime() <= Date.now() ? "expired" : hold.state;
    const covered = await isCovered(pool, member!, kitchen!, hold.date);
    const quote = await quoteFor(pool, kitchen!, member!, hold.date, covered ? cells : [], false);
    const out = await holdJson(hold, kitchen!, quote);
    out.state = readState;
    res.json({ hold: out });
  });

  router.delete("/holds/:holdId", async (req, res) => {
    checkOrigin(req);
    const { user: actor, hold } = await requireHoldAccess(req);
    const readState = hold.state === "held" && hold.expires_at.getTime() <= Date.now() ? "expired" : hold.state;
    if (readState === "expired") {
      throw holdExpired();
    }
    if (hold.state !== "held") {
      throw holdNotActive(hold.state);
    }
    await withTx(async (tx) => {
      await tx.query("UPDATE holds SET state = 'released' WHERE id = $1", [hold.id]);
      await store.insertAudit(tx, "hold", hold.id, "held", "released", actor.id);
    });
    const fresh = await store.getHold(pool, hold.id);
    const kitchen = await store.getKitchen(pool, hold.kitchen_id);
    const member = await store.getMember(pool, hold.member_id);
    const cells = await store.getHoldCells(pool, hold.id);
    const covered = await isCovered(pool, member!, kitchen!, hold.date);
    const quote = await quoteFor(pool, kitchen!, member!, hold.date, covered ? cells : [], false);
    res.json({ hold: { ...(await holdJson(fresh!, kitchen!, null)), quote: quoteJson(quote) } });
  });

  // ---------- idempotency ----------

  interface StoredIdempotency {
    method: string;
    path: string;
    body_sha256: string;
    status: number;
    response_body: string;
  }

  async function findIdempotency(db: store.Db, userId: string, key: string): Promise<StoredIdempotency | null> {
    const result = await db.query("SELECT method, path, body_sha256, status, response_body FROM idempotency WHERE user_id = $1 AND key = $2", [userId, key]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return { method: row.method, path: row.path, body_sha256: row.body_sha256, status: row.status, response_body: row.response_body };
  }

  async function storeIdempotency(
    db: store.Db,
    userId: string,
    key: string,
    method: string,
    path: string,
    bodySha256: string,
    status: number,
    responseBody: string
  ): Promise<void> {
    await db.query(
      `INSERT INTO idempotency (user_id, key, method, path, body_sha256, status, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [userId, key, method, path, bodySha256, status, responseBody]
    );
  }

  function bodySha(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  function sendReplay(res: Response, stored: StoredIdempotency): void {
    res.status(stored.status).type("json").send(stored.response_body);
  }

  /** Reads the body with the transport checks and returns the parsed body plus its hash. */
  async function readIdempotentJsonBody(req: Request): Promise<{ parsed: Record<string, unknown>; sha: string }> {
    checkOrigin(req);
    const raw = await readRawBody(req, 64000);
    if (raw.length > 0) {
      const contentType = req.headers["content-type"] ?? "";
      const mime = contentType.split(";")[0]!.trim().toLowerCase();
      if (mime !== "application/json") {
        throw unsupportedMediaType();
      }
    }
    let parsed: Record<string, unknown> = {};
    if (raw.length > 0) {
      try {
        const value = JSON.parse(raw.toString("utf8")) as unknown;
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw new Error("not an object");
        }
        parsed = value as Record<string, unknown>;
      } catch {
        throw invalidJson();
      }
    }
    return { parsed, sha: bodySha(raw.toString("utf8")) };
  }

  function chargeDescription(ref: string, line: Line): string {
    return `${ref} · ${line.station} · tier ${line.tier} · ${line.hours} h`;
  }

  async function postBookingCharges(member: store.MemberRow, lines: Array<{ ref: string; line: Line }>): Promise<string | null> {
    const cashLines = lines.filter((entry) => entry.line.paid_by === "cash" && entry.line.amount_cents > 0);
    if (cashLines.length === 0) {
      return null;
    }
    if (!ctx.status.isUp("billing")) {
      throw billingUnavailable();
    }
    try {
      const accountId = await ctx.killbill.ensureAccount(member.id, member.business, member.contact_email);
      const charges = cashLines.map((entry) => ({ description: chargeDescription(entry.ref, entry.line), amountCents: entry.line.amount_cents }));
      const posted = await ctx.killbill.postCharges(accountId, charges);
      return posted.invoiceId;
    } catch (error) {
      console.error("billing charge failed:", error instanceof Error ? error.message : error);
      ctx.status.markDown("billing");
      throw billingUnavailable();
    }
  }

  async function sendBookingEmail(member: store.MemberRow, subject: string, body: string): Promise<void> {
    if (!ctx.status.isUp("mail")) {
      throw mailUnavailable();
    }
    try {
      await ctx.mail.send(member.contact_email, subject, body);
    } catch {
      ctx.status.markDown("mail");
      throw mailUnavailable();
    }
  }

  interface NewBooking {
    id: string;
    ref: string;
    memberId: string;
    kitchenId: string;
    seriesId: string | null;
    date: string;
    rateCardId: string;
    cancellationWindowHours: number;
    quote: Quote;
    startsAt: Date;
    endsAt: Date;
    invoiceId: string;
    cells: Cell[];
  }

  async function insertBooking(tx: Tx, booking: NewBooking): Promise<void> {
    await tx.query(
      `INSERT INTO bookings (id, ref, kitchen_id, member_id, series_id, date, state, rate_card_id,
         cancellation_window_hours, total_cents, pack_quarters, quarters, lines, starts_at, ends_at,
         confirmed_at, cancelled_at, invoice_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9, $10, $11, $12, $13, $14, now(), NULL, $15, now())`,
      [
        booking.id,
        booking.ref,
        booking.kitchenId,
        booking.memberId,
        booking.seriesId,
        booking.date,
        booking.rateCardId,
        booking.cancellationWindowHours,
        booking.quote.total_cents,
        booking.quote.pack_quarters,
        booking.quote.quarters,
        JSON.stringify(booking.quote.lines),
        booking.startsAt,
        booking.endsAt,
        booking.invoiceId,
      ]
    );
    for (const cell of booking.cells) {
      await tx.query(`INSERT INTO booking_cells (booking_id, kitchen_id, date, station_id, start_q) VALUES ($1, $2, $3, $4, $5)`, [
        booking.id,
        booking.kitchenId,
        booking.date,
        cell.station_id,
        quarterOf(cell.start),
      ]);
    }
  }

  async function insertPackDraw(tx: Tx, memberId: string, bookingId: string, quarters: number): Promise<void> {
    if (quarters <= 0) {
      return;
    }
    const movementId = await store.nextMovementId(tx);
    await tx.query(
      `INSERT INTO movements (id, member_id, kind, quarters, booking_id, reverses, invoice_id, created_at)
       VALUES ($1, $2, 'draw', $3, $4, NULL, NULL, now())`,
      [movementId, memberId, quarters, bookingId]
    );
    await tx.query(`INSERT INTO movement_entries (movement_id, account, quarters) VALUES ($1, 'member_pack', $2), ($1, 'hours_used', $3)`, [
      movementId,
      -quarters,
      quarters,
    ]);
  }

  async function insertInvoice(
    tx: Tx,
    invoice: { id: string; ref: string; kitchenId: string; memberId: string; kind: "booking" | "series" | "pack"; bookingIds: string[]; lines: unknown[]; totalCents: number; killbillInvoiceId: string | null }
  ): Promise<void> {
    await tx.query(
      `INSERT INTO invoices (id, ref, kitchen_id, member_id, kind, booking_ids, lines, total_cents, killbill_invoice_id, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [invoice.id, invoice.ref, invoice.kitchenId, invoice.memberId, invoice.kind, JSON.stringify(invoice.bookingIds), JSON.stringify(invoice.lines), invoice.totalCents, invoice.killbillInvoiceId]
    );
  }

  // ---------- confirm ----------

  router.post("/holds/:holdId/confirm", async (req, res) => {
    const { parsed, sha } = await readIdempotentJsonBody(req);
    const user = await requireUser(req);
    const { hold } = await requireHoldAccess(req);
    const key = checkIdempotencyKey(Array.isArray(req.headers["idempotency-key"]) ? req.headers["idempotency-key"][0] : req.headers["idempotency-key"]);
    const requestPath = `/api/holds/${req.params.holdId}/confirm`;
    const stored = await findIdempotency(pool, user.id, key);
    if (stored) {
      if (stored.method === "POST" && stored.path === requestPath && stored.body_sha256 === sha) {
        sendReplay(res, stored);
        return;
      }
      throw idempotencyKeyReused();
    }
    if (typeof parsed.quoted_total_cents !== "number" || !Number.isInteger(parsed.quoted_total_cents) || parsed.quoted_total_cents < 0) {
      throw validation({ quoted_total_cents: "Send the quoted total in cents." });
    }
    const quotedTotalCents = parsed.quoted_total_cents;
    const usePack = parsed.use_pack === true;

    const kitchen = await store.getKitchen(pool, hold.kitchen_id);
    const member = await store.getMember(pool, hold.member_id);
    const client = await pool.connect();
    let postedKillbillInvoiceId: string | null = null;
    let unitStarted = false;
    try {
      await client.query("BEGIN");
      await lockKitchenDate(client, kitchen!.id, hold.date);
      const underLock = await findIdempotency(client, user.id, key);
      if (underLock) {
        await client.query("COMMIT");
        if (underLock.method === "POST" && underLock.path === requestPath && underLock.body_sha256 === sha) {
          sendReplay(res, underLock);
          return;
        }
        throw idempotencyKeyReused();
      }
      const stateResult = await client.query("SELECT state::text AS state, expires_at FROM holds WHERE id = $1 FOR UPDATE", [hold.id]);
      const stateRow = stateResult.rows[0]!;
      if (stateRow.state !== "held") {
        throw holdNotActive(stateRow.state);
      }
      if ((stateRow.expires_at as Date).getTime() <= Date.now()) {
        throw holdExpired();
      }
      if (!(await isCovered(client, member!, kitchen!, hold.date))) {
        throw complianceBlocked();
      }
      const cells = await store.getHoldCells(client, hold.id);
      const balance = await store.packBalance(client, member!.id);
      if (usePack && balance <= 0) {
        throw validation({ use_pack: "No pack hours left." });
      }
      const quote = await quoteFor(client, kitchen!, member!, hold.date, cells, usePack);
      if (quote.total_cents !== quotedTotalCents) {
        throw quoteChanged(quoteJson(quote));
      }
      unitStarted = true;

      const rateCard = (await store.getRateCardInForce(client, kitchen!.id, todayIn(kitchen!)))!;
      const booking = await store.nextBookingRef(client);
      const invoice = await store.nextInvoiceRef(client);
      postedKillbillInvoiceId = await postBookingCharges(
        member!,
        quote.lines.map((line) => ({ ref: booking.ref, line }))
      );
      const stations = await store.getStations(client, kitchen!.id);
      const now = new Date();
      const starts = cells.map((cell) => cell.start).sort();
      const startsAt = kitchenInstant(hold.date, starts[0]!, kitchen!.timezone);
      const endsAt = new Date(kitchenInstant(hold.date, starts[starts.length - 1]!, kitchen!.timezone).getTime() + 15 * 60000);
      const email = confirmationEmail(member!.contact_email, kitchen!.name, {
        ref: booking.ref,
        date: hold.date,
        hours: quote.hours,
        total: quote.total,
        packQuarters: quote.pack_quarters,
        lines: quote.lines,
        blocks: blocksOf(cells, stations).map((block) => ({
          station: String(block.station),
          start: String(block.start),
          end: String(block.end),
          hours: String(block.hours),
        })),
        cancellationWindowHours: rateCard.cancellation_window_hours,
      });
      await sendBookingEmail(member!, email.subject, email.body);
      await insertBooking(client, {
        id: booking.id,
        ref: booking.ref,
        memberId: member!.id,
        kitchenId: kitchen!.id,
        seriesId: null,
        date: hold.date,
        rateCardId: quote.rate_card_id,
        cancellationWindowHours: rateCard.cancellation_window_hours,
        quote,
        startsAt,
        endsAt,
        invoiceId: invoice.id,
        cells,
      });
      await insertPackDraw(client, member!.id, booking.id, quote.pack_quarters);
      await insertInvoice(client, {
        id: invoice.id,
        ref: invoice.ref,
        kitchenId: kitchen!.id,
        memberId: member!.id,
        kind: "booking",
        bookingIds: [booking.id],
        lines: quote.lines,
        totalCents: quote.total_cents,
        killbillInvoiceId: postedKillbillInvoiceId,
      });
      await client.query(`UPDATE holds SET state = 'confirmed' WHERE id = $1`, [hold.id]);
      await store.insertAudit(client, "hold", hold.id, "held", "confirmed", user.id);
      await store.insertAudit(client, "booking", booking.id, null, "confirmed", user.id);
      const invoiceRow = await store.getInvoice(client, invoice.id);
      const bookingRow: store.BookingRow = {
        id: booking.id,
        ref: booking.ref,
        kitchen_id: kitchen!.id,
        member_id: member!.id,
        series_id: null,
        date: hold.date,
        state: "confirmed",
        rate_card_id: quote.rate_card_id,
        cancellation_window_hours: rateCard.cancellation_window_hours,
        total_cents: quote.total_cents,
        pack_quarters: quote.pack_quarters,
        quarters: quote.quarters,
        lines: quote.lines,
        starts_at: startsAt,
        ends_at: endsAt,
        confirmed_at: now,
        cancelled_at: null,
        invoice_id: invoice.id,
        created_at: now,
      };
      const response = {
        booking: bookingJson(bookingRow, cells, stations),
        invoice: await invoiceJson(invoiceRow!),
      };
      const responseBody = JSON.stringify(response);
      await storeIdempotency(client, user.id, key, "POST", requestPath, sha, 201, responseBody);
      await client.query("COMMIT");
      res.status(201).type("json").send(responseBody);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (postedKillbillInvoiceId) {
        await ctx.killbill.reverseInvoice(postedKillbillInvoiceId).catch(() => undefined);
      }
      if (unitStarted) {
        await pool.query(`UPDATE holds SET state = 'released' WHERE id = $1`, [hold.id]).catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  });

  // ---------- series ----------

  interface OccurrencePlan {
    date: string;
    cells: Cell[];
    quote: Quote;
    startsAt: Date;
    endsAt: Date;
  }

  function seriesDates(firstDate: string, weeks: number): string[] {
    const dates: string[] = [];
    let current = firstDate;
    for (let i = 0; i < weeks; i++) {
      if (i > 0) {
        current = addDays(current, 7);
      }
      dates.push(current);
    }
    return dates;
  }

  async function planSeries(
    db: store.Db,
    kitchen: store.KitchenRow,
    member: store.MemberRow,
    stationIds: string[],
    start: string,
    end: string,
    firstDate: string,
    weeks: number,
    usePack: boolean
  ): Promise<OccurrencePlan[]> {
    const stations = await store.getStations(db, kitchen.id);
    const byId = new Map(stations.map((station) => [station.id, station]));
    const rateCard = (await store.getRateCardInForce(db, kitchen.id, todayIn(kitchen)))!;
    const dates = seriesDates(firstDate, weeks);
    let packLeft = usePack ? await store.packBalance(db, member.id) : 0;
    const mtdBase = new Map<string, number>();
    const plannedByMonth = new Map<string, number>();
    const plans: OccurrencePlan[] = [];
    for (const date of dates) {
      const cells = cellsForRange(stationIds, start, end);
      const month = monthOf(date);
      if (!mtdBase.has(month)) {
        mtdBase.set(month, await store.monthToDateQuarters(db, member.id, month));
      }
      const mtd = mtdBase.get(month)! + (plannedByMonth.get(month) ?? 0);
      const { quote } = priceCells({
        cells: cells.map((cell) => ({ station: byId.get(cell.station_id)!, startQ: quarterOf(cell.start) })),
        monthToDateQuarters: mtd,
        packBalanceQuarters: packLeft,
        usePack,
        rateCard,
        month,
      });
      packLeft -= quote.pack_quarters;
      plannedByMonth.set(month, (plannedByMonth.get(month) ?? 0) + quote.quarters);
      plans.push({
        date,
        cells,
        quote,
        startsAt: kitchenInstant(date, start, kitchen.timezone),
        endsAt:
          end === "24:00"
            ? kitchenInstant(addDays(date, 1), "00:00", kitchen.timezone)
            : kitchenInstant(date, end, kitchen.timezone),
      });
    }
    return plans;
  }

  function parseSeriesBody(body: Record<string, unknown>): {
    stationIds: string[];
    start: string;
    end: string;
    firstDate: string;
    weeks: number;
    usePack: boolean;
  } {
    if (!Array.isArray(body.station_ids)) {
      throw validation({ station_ids: "Choose some stations." });
    }
    const stationIds: string[] = [];
    const stationSet = new Set<string>();
    for (const raw of body.station_ids) {
      if (typeof raw !== "string") {
        throw validation({ station_ids: "Those stations are not in this kitchen." });
      }
      if (!stationSet.has(raw)) {
        stationSet.add(raw);
        stationIds.push(raw);
      }
    }
    if (stationIds.length === 0) {
      throw validation({ station_ids: "Choose some stations." });
    }
    const { start, end } = wallRange(body.start, body.end);
    const firstDate = parseDate(body.first_date, "first_date");
    const weeks = weeksValue(body.weeks);
    const usePack = body.use_pack === true;
    return { stationIds, start, end, firstDate, weeks, usePack };
  }

  async function checkSeriesGuards(
    db: store.Db,
    kitchen: store.KitchenRow,
    member: store.MemberRow,
    plans: OccurrencePlan[]
  ): Promise<void> {
    const today = todayIn(kitchen);
    const nowMinutes = timeHourMinutes(kitchenTime(new Date(), kitchen.timezone));
    const cutoffMinutes = timeHourMinutes(kitchen.same_day_cutoff);
    for (const plan of plans) {
      checkHorizon(plan.date, today, "first_date");
      if (plan.date === today) {
        const firstCell = Math.min(...plan.cells.map((cell) => quarterOf(cell.start)));
        if (nowMinutes >= cutoffMinutes) {
          throw sameDayClosed();
        }
        if (240 + firstCell * 15 <= nowMinutes) {
          throw cellInPast();
        }
      }
      if (!(await isCovered(db, member, kitchen, plan.date))) {
        throw complianceBlocked();
      }
    }
  }

  router.post("/series/quote", async (req, res) => {
    const body = await quoteOrHoldBody(req);
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, user.kitchen_id);
    const member = await resolveActorMember(user, body.member_id);
    const parsed = parseSeriesBody(body);
    const stations = await store.getStations(pool, kitchen.id);
    const knownIds = new Set(stations.map((station) => station.id));
    if (parsed.stationIds.some((id) => !knownIds.has(id))) {
      throw validation({ station_ids: "Those stations are not in this kitchen." });
    }
    const plans = await planSeries(pool, kitchen, member, parsed.stationIds, parsed.start, parsed.end, parsed.firstDate, parsed.weeks, parsed.usePack);
    await checkSeriesGuards(pool, kitchen, member, plans);
    const conflicts: string[] = [];
    const taken: Array<Record<string, string>> = [];
    for (const plan of plans) {
      const occupied = await store.occupiedCells(pool, kitchen.id, plan.date);
      const takenHere = store.takenCellsOf(plan.cells, occupied);
      if (takenHere.length > 0) {
        conflicts.push(plan.date);
        for (const cell of takenHere) {
          taken.push({ date: plan.date, station_id: cell.station_id, start: cell.start });
        }
      }
    }
    if (conflicts.length > 0) {
      throw seriesConflict(conflicts, taken);
    }
    const totalCents = plans.reduce((sum, plan) => sum + plan.quote.total_cents, 0);
    res.json({
      occurrences: plans.map((plan) => ({ date: plan.date, starts_at: plan.startsAt.toISOString(), ends_at: plan.endsAt.toISOString(), quote: quoteJson(plan.quote) })),
      total_cents: totalCents,
      total: formatMoney(totalCents),
    });
  });

  router.post("/series", async (req, res) => {
    const { parsed, sha } = await readIdempotentJsonBody(req);
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, user.kitchen_id);
    const member = await resolveActorMember(user, parsed.member_id);
    const key = checkIdempotencyKey(Array.isArray(req.headers["idempotency-key"]) ? req.headers["idempotency-key"][0] : req.headers["idempotency-key"]);
    const stored = await findIdempotency(pool, user.id, key);
    if (stored) {
      if (stored.method === "POST" && stored.path === "/api/series" && stored.body_sha256 === sha) {
        sendReplay(res, stored);
        return;
      }
      throw idempotencyKeyReused();
    }
    if (typeof parsed.quoted_total_cents !== "number" || !Number.isInteger(parsed.quoted_total_cents) || parsed.quoted_total_cents < 0) {
      throw validation({ quoted_total_cents: "Send the quoted total in cents." });
    }
    const seriesBody = parseSeriesBody(parsed);
    const stations = await store.getStations(pool, kitchen.id);
    const knownIds = new Set(stations.map((station) => station.id));
    if (seriesBody.stationIds.some((id) => !knownIds.has(id))) {
      throw validation({ station_ids: "Those stations are not in this kitchen." });
    }
    const client = await pool.connect();
    let postedKillbillInvoiceId: string | null = null;
    try {
      await client.query("BEGIN");
      for (const date of seriesDates(seriesBody.firstDate, seriesBody.weeks).sort()) {
        await lockKitchenDate(client, kitchen.id, date);
      }
      const underLock = await findIdempotency(client, user.id, key);
      if (underLock) {
        await client.query("COMMIT");
        if (underLock.method === "POST" && underLock.path === "/api/series" && underLock.body_sha256 === sha) {
          sendReplay(res, underLock);
          return;
        }
        throw idempotencyKeyReused();
      }
      const plans = await planSeries(client, kitchen, member, seriesBody.stationIds, seriesBody.start, seriesBody.end, seriesBody.firstDate, seriesBody.weeks, seriesBody.usePack);
      await checkSeriesGuards(client, kitchen, member, plans);
      const conflicts: string[] = [];
      const taken: Array<Record<string, string>> = [];
      for (const plan of plans) {
        const occupied = await store.occupiedCells(client, kitchen.id, plan.date);
        const takenHere = store.takenCellsOf(plan.cells, occupied);
        if (takenHere.length > 0) {
          conflicts.push(plan.date);
          for (const cell of takenHere) {
            taken.push({ date: plan.date, station_id: cell.station_id, start: cell.start });
          }
        }
      }
      if (conflicts.length > 0) {
        throw seriesConflict(conflicts, taken);
      }
      const totalCents = plans.reduce((sum, plan) => sum + plan.quote.total_cents, 0);
      if (totalCents !== parsed.quoted_total_cents) {
        throw quoteChanged({
          occurrences: plans.map((plan) => ({ date: plan.date, starts_at: plan.startsAt.toISOString(), ends_at: plan.endsAt.toISOString(), quote: quoteJson(plan.quote) })),
          total_cents: totalCents,
          total: formatMoney(totalCents),
        });
      }
      if (seriesBody.usePack) {
        const balance = await store.packBalance(client, member.id);
        if (balance <= 0) {
          throw validation({ use_pack: "No pack hours left." });
        }
      }
      const rateCard = (await store.getRateCardInForce(client, kitchen.id, todayIn(kitchen)))!;
      const seriesId = `series-${randomBytes(12).toString("hex")}`;
      const invoice = await store.nextInvoiceRef(client);
      await client.query(
        `INSERT INTO series (id, kitchen_id, member_id, weekday, start_time, end_time, station_ids, weeks, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [seriesId, kitchen.id, member.id, dayOfWeek(seriesBody.firstDate, kitchen.timezone), seriesBody.start, seriesBody.end, JSON.stringify(seriesBody.stationIds), seriesBody.weeks]
      );
      const bookings: Array<{ row: store.BookingRow; cells: Cell[]; quote: Quote }> = [];
      const allLines: Line[] = [];
      const chargeLines: Array<{ ref: string; line: Line }> = [];
      const bookingIds: string[] = [];
      for (const plan of plans) {
        const booking = await store.nextBookingRef(client);
        bookingIds.push(booking.id);
        await insertBooking(client, {
          id: booking.id,
          ref: booking.ref,
          memberId: member.id,
          kitchenId: kitchen.id,
          seriesId,
          date: plan.date,
          rateCardId: plan.quote.rate_card_id,
          cancellationWindowHours: rateCard.cancellation_window_hours,
          quote: plan.quote,
          startsAt: plan.startsAt,
          endsAt: plan.endsAt,
          invoiceId: invoice.id,
          cells: plan.cells,
        });
        await insertPackDraw(client, member.id, booking.id, plan.quote.pack_quarters);
        allLines.push(...plan.quote.lines);
        chargeLines.push(...plan.quote.lines.filter((line) => line.paid_by === "cash" && line.amount_cents > 0).map((line) => ({ ref: booking.ref, line })));
        bookings.push({
          row: {
            id: booking.id,
            ref: booking.ref,
            kitchen_id: kitchen.id,
            member_id: member.id,
            series_id: seriesId,
            date: plan.date,
            state: "confirmed",
            rate_card_id: plan.quote.rate_card_id,
            cancellation_window_hours: rateCard.cancellation_window_hours,
            total_cents: plan.quote.total_cents,
            pack_quarters: plan.quote.pack_quarters,
            quarters: plan.quote.quarters,
            lines: plan.quote.lines,
            starts_at: plan.startsAt,
            ends_at: plan.endsAt,
            confirmed_at: new Date(),
            cancelled_at: null,
            invoice_id: invoice.id,
            created_at: new Date(),
          },
          cells: plan.cells,
          quote: plan.quote,
        });
      }
      postedKillbillInvoiceId = await postBookingCharges(member, chargeLines);
      const email = seriesEmail(
        member.contact_email,
        kitchen.name,
        bookings.map((entry) => ({
          ref: entry.row.ref,
          date: entry.row.date,
          hours: entry.quote.hours,
          total: entry.quote.total,
          blocks: blocksOf(entry.cells, stations).map((block) => ({
            station: String(block.station),
            start: String(block.start),
            end: String(block.end),
            hours: String(block.hours),
          })),
          lines: entry.quote.lines,
        })),
        formatMoney(totalCents)
      );
      await sendBookingEmail(member, email.subject, email.body);
      await insertInvoice(client, {
        id: invoice.id,
        ref: invoice.ref,
        kitchenId: kitchen.id,
        memberId: member.id,
        kind: "series",
        bookingIds,
        lines: allLines,
        totalCents,
        killbillInvoiceId: postedKillbillInvoiceId,
      });
      await store.insertAudit(client, "series", seriesId, null, "booked", user.id);
      for (const booking of bookings) {
        await store.insertAudit(client, "booking", booking.row.id, null, "confirmed", user.id);
      }
      const invoiceRow = await store.getInvoice(client, invoice.id);
      const response = {
        series: {
          id: seriesId,
          weekday: dayOfWeek(seriesBody.firstDate, kitchen.timezone),
          start: seriesBody.start,
          end: seriesBody.end,
          station_ids: seriesBody.stationIds,
          weeks: seriesBody.weeks,
          booking_ids: bookingIds,
        },
        bookings: bookings.map((entry) => bookingJson(entry.row, entry.cells, stations)),
        invoice: await invoiceJson(invoiceRow!),
      };
      const responseBody = JSON.stringify(response);
      await storeIdempotency(client, user.id, key, "POST", "/api/series", sha, 201, responseBody);
      await client.query("COMMIT");
      res.status(201).type("json").send(responseBody);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (postedKillbillInvoiceId) {
        await ctx.killbill.reverseInvoice(postedKillbillInvoiceId).catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  });

  // ---------- bookings ----------

  router.get("/bookings", async (req, res) => {
    const user = await requireUser(req);
    const dateFilter = typeof req.query.date === "string" ? req.query.date : null;
    if (dateFilter !== null && !isValidDate(dateFilter)) {
      throw validation({ date: "Enter a date as YYYY-MM-DD." });
    }
    const params: unknown[] = [];
    let where = "TRUE";
    if (user.role === "member") {
      params.push(user.member_id);
      where = `member_id = $${params.length}`;
    } else {
      params.push(user.kitchen_id);
      where = `kitchen_id = $${params.length}`;
    }
    if (dateFilter !== null) {
      params.push(dateFilter);
      where += ` AND date = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT id, ref, kitchen_id, member_id, series_id, date::text AS date, state::text AS state, rate_card_id,
         cancellation_window_hours, total_cents, pack_quarters, quarters, lines, starts_at, ends_at, confirmed_at,
         cancelled_at, invoice_id, created_at
       FROM bookings WHERE ${where} ORDER BY date, starts_at, ref`,
      params
    );
    const stations = await store.getStations(pool, user.kitchen_id);
    const bookings = [];
    for (const row of result.rows) {
      const booking = row as unknown as store.BookingRow;
      const cells = await store.getBookingCells(pool, booking.id);
      bookings.push(bookingJson(booking, cells, stations));
    }
    res.json({ bookings });
  });

  router.get("/bookings/:bookingId", async (req, res) => {
    const user = await requireUser(req);
    const booking = await store.getBooking(pool, req.params.bookingId!);
    if (!booking || booking.kitchen_id !== user.kitchen_id || (user.role === "member" && booking.member_id !== user.member_id)) {
      throw notFound();
    }
    const cells = await store.getBookingCells(pool, booking.id);
    const stations = await store.getStations(pool, booking.kitchen_id);
    res.json({ booking: bookingJson(booking, cells, stations) });
  });

  // The one place the booking transitions are decided.
  function bookingTransition(from: string, to: string): boolean {
    const legal: Record<string, string[]> = {
      confirmed: ["checked_in", "no_show", "cancelled"],
      checked_in: ["completed"],
      completed: [],
      no_show: [],
      cancelled_in_window: [],
      cancelled_late: [],
    };
    return (legal[from] ?? []).includes(to);
  }

  router.post("/bookings/:bookingId/cancel", async (req, res) => {
    await readJsonBody(req);
    const user = await requireUser(req);
    const booking = await store.getBooking(pool, req.params.bookingId!);
    if (!booking || booking.kitchen_id !== user.kitchen_id || (user.role === "member" && booking.member_id !== user.member_id)) {
      throw notFound();
    }
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    if (!bookingTransition(booking.state, "cancelled")) {
      throw invalidTransition(booking.state, "cancelled");
    }
    const inWindow = Date.now() <= booking.starts_at.getTime() - booking.cancellation_window_hours * 3600000;
    const member = await store.getMember(pool, booking.member_id);
    const kitchen = await store.getKitchen(pool, booking.kitchen_id);
    const draws = await store.getDrawsForBooking(pool, booking.id);
    const packQuarters = draws.reduce((sum, draw) => sum + draw.quarters, 0);
    const amountCents = inWindow ? booking.total_cents : 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lockResult = await client.query("SELECT state::text AS state FROM bookings WHERE id = $1 FOR UPDATE", [booking.id]);
      const freshState = lockResult.rows[0]!.state as string;
      if (freshState !== booking.state || !bookingTransition(freshState, "cancelled")) {
        throw invalidTransition(freshState, "cancelled");
      }
      await store.lockMember(client, member!.id);
      if (inWindow && amountCents > 0) {
        if (!ctx.status.isUp("billing")) {
          throw billingUnavailable();
        }
        try {
          const accountId = await ctx.killbill.ensureAccount(member!.id, member!.business, member!.contact_email);
          await ctx.killbill.postCredit(accountId, amountCents, `${booking.ref} cancelled in window`);
        } catch {
          ctx.status.markDown("billing");
          throw billingUnavailable();
        }
      }
      const email = cancellationEmail(member!.contact_email, { ref: booking.ref, packQuarters, totalCents: amountCents }, inWindow);
      if (!ctx.status.isUp("mail")) {
        throw mailUnavailable();
      }
      try {
        await ctx.mail.send(member!.contact_email, email.subject, email.body);
      } catch {
        ctx.status.markDown("mail");
        throw mailUnavailable();
      }
      if (inWindow) {
        for (const draw of draws) {
          const movementId = await store.nextMovementId(client);
          await client.query(
            `INSERT INTO movements (id, member_id, kind, quarters, booking_id, reverses, invoice_id, created_at)
             VALUES ($1, $2, 'refund', $3, $4, $5, NULL, now())`,
            [movementId, member!.id, draw.quarters, booking.id, draw.id]
          );
          await client.query(`INSERT INTO movement_entries (movement_id, account, quarters) VALUES ($1, 'member_pack', $2), ($1, 'hours_used', $3)`, [
            movementId,
            draw.quarters,
            -draw.quarters,
          ]);
        }
      }
      const newState = inWindow ? "cancelled_in_window" : "cancelled_late";
      await client.query("UPDATE bookings SET state = $1, cancelled_at = now() WHERE id = $2", [newState, booking.id]);
      await store.insertAudit(client, "booking", booking.id, booking.state, newState, user.id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const fresh = await store.getBooking(pool, booking.id);
    const cells = await store.getBookingCells(pool, booking.id);
    const stations = await store.getStations(pool, booking.kitchen_id);
    res.json({
      booking: bookingJson(fresh!, cells, stations),
      refund: { pack_quarters: packQuarters, amount_cents: amountCents, amount: formatMoney(amountCents) },
    });
    void kitchen;
  });

  async function dayOp(req: Request, res: Response, to: "checked_in" | "completed" | "no_show"): Promise<void> {
    await readJsonBody(req);
    const user = await requireUser(req);
    if (user.role !== "operator") {
      const booking = await store.getBooking(pool, req.params.bookingId!);
      if (!booking || booking.kitchen_id !== user.kitchen_id || (user.role === "member" && booking.member_id !== user.member_id)) {
        throw notFound();
      }
      throw forbidden();
    }
    const booking = await store.getBooking(pool, req.params.bookingId!);
    if (!booking || booking.kitchen_id !== user.kitchen_id) {
      throw notFound();
    }
    if (!bookingTransition(booking.state, to)) {
      throw invalidTransition(booking.state, to);
    }
    const kitchen = await store.getKitchen(pool, booking.kitchen_id);
    const today = todayIn(kitchen!);
    if (to !== "completed" && today < booking.date) {
      throw bookingDayNotReached();
    }
    await withTx(async (tx) => {
      const lockResult = await tx.query("SELECT state::text AS state FROM bookings WHERE id = $1 FOR UPDATE", [booking.id]);
      const freshState = lockResult.rows[0]!.state as string;
      if (freshState !== booking.state || !bookingTransition(freshState, to)) {
        throw invalidTransition(freshState, to);
      }
      if (to !== "completed" && today < booking.date) {
        throw bookingDayNotReached();
      }
      await tx.query("UPDATE bookings SET state = $1 WHERE id = $2", [to, booking.id]);
      await store.insertAudit(tx, "booking", booking.id, booking.state, to, user.id);
    });
    const fresh = await store.getBooking(pool, booking.id);
    const cells = await store.getBookingCells(pool, booking.id);
    const stations = await store.getStations(pool, booking.kitchen_id);
    res.json({ booking: bookingJson(fresh!, cells, stations) });
  }

  router.post("/bookings/:bookingId/check-in", async (req, res) => {
    await dayOp(req, res, "checked_in");
  });

  router.post("/bookings/:bookingId/complete", async (req, res) => {
    await dayOp(req, res, "completed");
  });

  router.post("/bookings/:bookingId/no-show", async (req, res) => {
    await dayOp(req, res, "no_show");
  });

  // ---------- pack ----------

  router.get("/members/:memberId/pack", async (req, res) => {
    const user = await requireUser(req);
    const member = await store.getMember(pool, req.params.memberId!);
    if (!member || member.kitchen_id !== user.kitchen_id || (user.role === "member" && member.id !== user.member_id)) {
      throw notFound();
    }
    const balance = await store.packBalance(pool, member.id);
    const movements = await store.getMovements(pool, member.id);
    res.json({ balance_quarters: balance, balance_hours: formatHours(balance), movements: movements.map(movementJson) });
  });

  router.post("/members/:memberId/packs", async (req, res) => {
    const { sha } = await readIdempotentJsonBody(req);
    const user = await requireUser(req);
    const member = await store.getMember(pool, req.params.memberId!);
    if (!member || member.kitchen_id !== user.kitchen_id || (user.role === "member" && member.id !== user.member_id)) {
      throw notFound();
    }
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const key = checkIdempotencyKey(Array.isArray(req.headers["idempotency-key"]) ? req.headers["idempotency-key"][0] : req.headers["idempotency-key"]);
    const stored = await findIdempotency(pool, user.id, key);
    if (stored) {
      if (stored.method === "POST" && stored.path === `/api/members/${req.params.memberId}/packs` && stored.body_sha256 === sha) {
        sendReplay(res, stored);
        return;
      }
      throw idempotencyKeyReused();
    }
    const kitchen = await store.getKitchen(pool, member.kitchen_id);
    const rateCard = await store.getRateCardInForce(pool, kitchen!.id, todayIn(kitchen!));
    if (!rateCard) {
      throw new ApiError(500, "no_rate_card", "No rate card is in force.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await store.lockMember(client, member.id);
      const underLock = await findIdempotency(client, user.id, key);
      if (underLock) {
        await client.query("COMMIT");
        if (underLock.method === "POST" && underLock.path === `/api/members/${req.params.memberId}/packs` && underLock.body_sha256 === sha) {
          sendReplay(res, underLock);
          return;
        }
        throw idempotencyKeyReused();
      }
      const invoice = await store.nextInvoiceRef(client);
      if (!ctx.status.isUp("billing")) {
        throw billingUnavailable();
      }
      let killbillInvoiceId: string | null = null;
      try {
        const accountId = await ctx.killbill.ensureAccount(member.id, member.business, member.contact_email);
        const posted = await ctx.killbill.postCharges(accountId, [
          { description: `${invoice.ref} · 20-hour pack`, amountCents: rateCard.pack_price_cents },
        ]);
        killbillInvoiceId = posted.invoiceId;
      } catch {
        ctx.status.markDown("billing");
        throw billingUnavailable();
      }
      const movementId = await store.nextMovementId(client);
      await insertInvoice(client, {
        id: invoice.id,
        ref: invoice.ref,
        kitchenId: kitchen!.id,
        memberId: member.id,
        kind: "pack",
        bookingIds: [],
        lines: [{ description: "20-hour pack", amount_cents: rateCard.pack_price_cents }],
        totalCents: rateCard.pack_price_cents,
        killbillInvoiceId,
      });
      await client.query(
        `INSERT INTO movements (id, member_id, kind, quarters, booking_id, reverses, invoice_id, created_at)
         VALUES ($1, $2, 'purchase', 80, NULL, NULL, $3, now())`,
        [movementId, member.id, invoice.id]
      );
      await client.query(`INSERT INTO movement_entries (movement_id, account, quarters) VALUES ($1, 'member_pack', 80), ($1, 'pack_sales', -80)`, [movementId]);
      await store.insertAudit(client, "pack", movementId, null, "purchased", user.id);
      const balance = await store.packBalance(client, member.id);
      const invoiceRow = await store.getInvoice(client, invoice.id);
      const movementRow: store.MovementRow = {
        id: movementId,
        member_id: member.id,
        kind: "purchase",
        quarters: 80,
        booking_id: null,
        reverses: null,
        invoice_id: invoice.id,
        created_at: new Date(),
        entries: [
          { account: "member_pack", quarters: 80 },
          { account: "pack_sales", quarters: -80 },
        ],
      };
      const response = { movement: movementJson(movementRow), invoice: await invoiceJson(invoiceRow!), balance_quarters: balance };
      const responseBody = JSON.stringify(response);
      await storeIdempotency(client, user.id, key, "POST", `/api/members/${req.params.memberId}/packs`, sha, 201, responseBody);
      await client.query("COMMIT");
      res.status(201).type("json").send(responseBody);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  // ---------- invoices ----------

  router.get("/invoices", async (req, res) => {
    const user = await requireUser(req);
    const result = await pool.query(
      `SELECT id, ref, kitchen_id, member_id, kind::text AS kind, booking_ids, lines, total_cents, killbill_invoice_id, issued_at
       FROM invoices WHERE ${user.role === "member" ? "member_id = $1" : "kitchen_id = $1"} ORDER BY issued_at, ref`,
      [user.role === "member" ? user.member_id : user.kitchen_id]
    );
    const invoices = [];
    for (const row of result.rows) {
      invoices.push(await invoiceJson(row as unknown as store.InvoiceRow));
    }
    res.json({ invoices });
  });

  router.get("/invoices/:invoiceId", async (req, res) => {
    const user = await requireUser(req);
    const invoice = await store.getInvoice(pool, req.params.invoiceId!);
    if (!invoice || invoice.kitchen_id !== user.kitchen_id || (user.role === "member" && invoice.member_id !== user.member_id)) {
      throw notFound();
    }
    res.json({ invoice: await invoiceJson(invoice) });
  });

  // ---------- documents ----------

  function detectContentType(bytes: Buffer): string | null {
    if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") {
      return "application/pdf";
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
      return "image/png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    return null;
  }

  function safeFileName(name: string | undefined): string | null {
    if (!name || name.length === 0 || name.length > 200) {
      return null;
    }
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      return null;
    }
    for (const ch of name) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code === 127) {
        return null;
      }
    }
    return name;
  }

  router.get("/documents", async (req, res) => {
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const docs =
      user.role === "operator"
        ? await store.getDocumentsFor(pool, user.kitchen_id, null)
        : await store.getDocumentsFor(pool, user.kitchen_id, user.member_id!);
    const kitchen = await store.getKitchen(pool, user.kitchen_id);
    res.json({ documents: docs.map((doc) => documentJson(doc, kitchen!)) });
  });

  interface UploadParts {
    type: string;
    expiresOn: string | undefined;
    memberId: string | undefined;
    file: { name: string | undefined; bytes: Buffer };
  }

  function parseUpload(req: Request): Promise<UploadParts> {
    return new Promise((resolve, reject) => {
      const contentType = req.headers["content-type"] ?? "";
      const mime = contentType.split(";")[0]!.trim().toLowerCase();
      if (mime !== "multipart/form-data") {
        reject(unsupportedMediaType());
        return;
      }
      const bb = busboy({ headers: req.headers, limits: { fileSize: FILE_PART_LIMIT + 1 } });
      const parts: UploadParts = { type: "", expiresOn: undefined, memberId: undefined, file: { name: undefined, bytes: Buffer.alloc(0) } };
      let total = 0;
      let partTooBig = false;
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        req.unpipe(bb);
        reject(error instanceof ApiError ? error : new Error("upload failed"));
      };
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > UPLOAD_BODY_LIMIT) {
          fail(payloadTooLarge());
        }
      });
      bb.on("field", (name, value) => {
        if (name === "type") {
          parts.type = value;
        } else if (name === "expires_on") {
          parts.expiresOn = value;
        } else if (name === "member_id") {
          parts.memberId = value;
        }
      });
      bb.on("file", (name, stream, info) => {
        if (name !== "file") {
          stream.resume();
          return;
        }
        parts.file.name = info.filename;
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          if (chunks.reduce((sum, c) => sum + c.length, 0) > FILE_PART_LIMIT) {
            partTooBig = true;
            stream.resume();
          }
        });
        stream.on("close", () => {
          if (partTooBig) {
            fail(fileTooLarge());
            return;
          }
          parts.file.bytes = Buffer.concat(chunks);
        });
      });
      bb.on("error", () => fail(new Error("upload failed")));
      bb.on("close", () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(parts);
      });
      req.pipe(bb);
    });
  }

  router.post("/documents", async (req, res) => {
    const parts = await parseUpload(req);
    const user = await requireUser(req);
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    let member: store.MemberRow;
    if (user.role === "operator") {
      const target = await store.getMember(pool, parts.memberId ?? "");
      if (!target || target.kitchen_id !== user.kitchen_id) {
        throw notFound();
      }
      member = target;
    } else {
      member = (await store.getMember(pool, user.member_id!))!;
    }
    const type = parts.type;
    if (type !== "insurance" && type !== "food_handler" && type !== "kitchen_agreement") {
      throw validation({ type: "Choose a document type." });
    }
    if (user.role === "member" && type === "kitchen_agreement") {
      throw forbidden();
    }
    const kitchen = await store.getKitchen(pool, member.kitchen_id);
    const today = todayIn(kitchen!);
    let expiresOn: string | null = null;
    if (type === "kitchen_agreement") {
      if (parts.expiresOn !== undefined && parts.expiresOn.length > 0) {
        throw validation({ expires_on: "Signed kitchen-use agreements never expire." });
      }
    } else {
      if (parts.expiresOn === undefined || !isValidDate(parts.expiresOn)) {
        throw validation({ expires_on: "Choose an expiry date from today onward." });
      }
      if (parts.expiresOn < today) {
        throw validation({ expires_on: "Choose an expiry date from today onward." });
      }
      expiresOn = parts.expiresOn;
    }
    const fileName = safeFileName(parts.file.name);
    if (!fileName) {
      throw validation({ file: "That file name is not allowed. Rename the file and try again." });
    }
    if (parts.file.bytes.length === 0) {
      throw validation({ file: "That file name is not allowed. Rename the file and try again." });
    }
    const contentType = detectContentType(parts.file.bytes);
    if (!contentType) {
      throw new ApiError(415, "unsupported_type", "Upload a PDF, PNG or JPEG file.");
    }
    if (!ctx.status.isUp("files")) {
      throw filesUnavailable();
    }
    const documentId = `doc-${randomBytes(12).toString("hex")}`;
    const storageKey = `documents/${member.kitchen_id}/${member.id}/${documentId}`;
    try {
      await ctx.storage.put(storageKey, parts.file.bytes, contentType);
    } catch {
      ctx.status.markDown("files");
      throw filesUnavailable();
    }
    await pool.query(
      `INSERT INTO documents (id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes,
         content_type, storage_key, reject_reason, uploaded_at, verified_at, reminded_at)
       VALUES ($1, $2, $3, $4, 'uploaded', $5, $6, $7, $8, $9, NULL, now(), NULL, NULL)`,
      [documentId, member.kitchen_id, member.id, type, expiresOn, fileName, parts.file.bytes.length, contentType, storageKey]
    );
    await store.insertAudit(pool, "document", documentId, null, "uploaded", user.id);
    const doc = await store.getDocument(pool, documentId);
    res.status(201).json({ document: documentJson(doc!, kitchen!) });
  });

  router.get("/documents/:documentId", async (req, res) => {
    const user = await requireUser(req);
    const doc = await store.getDocument(pool, req.params.documentId!);
    if (!doc || doc.kitchen_id !== user.kitchen_id || (user.role === "member" && doc.member_id !== user.member_id)) {
      throw notFound();
    }
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    const kitchen = await store.getKitchen(pool, doc.kitchen_id);
    res.json({ document: documentJson(doc, kitchen!) });
  });

  router.get("/documents/:documentId/file", async (req, res) => {
    const user = await requireUser(req);
    const doc = await store.getDocument(pool, req.params.documentId!);
    if (!doc || doc.kitchen_id !== user.kitchen_id || (user.role === "member" && doc.member_id !== user.member_id)) {
      throw notFound();
    }
    if (user.role === "bookkeeper") {
      throw forbidden();
    }
    if (!ctx.status.isUp("files")) {
      throw filesUnavailable();
    }
    const object = await ctx.storage.get(doc.storage_key ?? "");
    if (!object) {
      throw notFound();
    }
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.original_name.replace(/["\\]/g, "")}"`);
    res.send(object.body);
  });

  router.post("/documents/:documentId/verify", async (req, res) => {
    await readJsonBody(req);
    const user = await requireUser(req);
    if (user.role !== "operator") {
      const doc = await store.getDocument(pool, req.params.documentId!);
      if (!doc || doc.kitchen_id !== user.kitchen_id || (user.role === "member" && doc.member_id !== user.member_id)) {
        throw notFound();
      }
      throw forbidden();
    }
    const doc = await store.getDocument(pool, req.params.documentId!);
    if (!doc || doc.kitchen_id !== user.kitchen_id) {
      throw notFound();
    }
    const kitchen = await store.getKitchen(pool, doc.kitchen_id);
    const readState = store.documentReadState(doc, kitchen!, new Date());
    if (doc.state !== "uploaded" || readState === "expired") {
      throw invalidTransition(readState, "verified");
    }
    await withTx(async (tx) => {
      const lockResult = await tx.query("SELECT state::text AS state FROM documents WHERE id = $1 FOR UPDATE", [doc.id]);
      const freshState = lockResult.rows[0]!.state as string;
      if (freshState !== "uploaded") {
        throw invalidTransition(freshState, "verified");
      }
      await tx.query("UPDATE documents SET state = 'verified', verified_at = now() WHERE id = $1", [doc.id]);
      await store.insertAudit(tx, "document", doc.id, "uploaded", "verified", user.id);
    });
    const fresh = await store.getDocument(pool, doc.id);
    res.json({ document: documentJson(fresh!, kitchen!) });
  });

  router.post("/documents/:documentId/reject", async (req, res) => {
    const body = await readJsonBody(req);
    const user = await requireUser(req);
    if (user.role !== "operator") {
      const doc = await store.getDocument(pool, req.params.documentId!);
      if (!doc || doc.kitchen_id !== user.kitchen_id || (user.role === "member" && doc.member_id !== user.member_id)) {
        throw notFound();
      }
      throw forbidden();
    }
    const doc = await store.getDocument(pool, req.params.documentId!);
    if (!doc || doc.kitchen_id !== user.kitchen_id) {
      throw notFound();
    }
    const reason = body.reason;
    if (typeof reason !== "string" || reason.length < 1 || reason.length > 300) {
      throw validation({ reason: "Give a reason of 1 to 300 characters." });
    }
    const kitchen = await store.getKitchen(pool, doc.kitchen_id);
    const readState = store.documentReadState(doc, kitchen!, new Date());
    if (doc.state !== "uploaded" || readState === "expired") {
      throw invalidTransition(readState, "rejected");
    }
    await withTx(async (tx) => {
      const lockResult = await tx.query("SELECT state::text AS state FROM documents WHERE id = $1 FOR UPDATE", [doc.id]);
      const freshState = lockResult.rows[0]!.state as string;
      if (freshState !== "uploaded") {
        throw invalidTransition(freshState, "rejected");
      }
      await tx.query("UPDATE documents SET state = 'rejected', reject_reason = $2 WHERE id = $1", [doc.id, reason]);
      await store.insertAudit(tx, "document", doc.id, "uploaded", "rejected", user.id);
    });
    const fresh = await store.getDocument(pool, doc.id);
    res.json({ document: documentJson(fresh!, kitchen!) });
  });

  // ---------- rate cards ----------

  router.get("/kitchens/:kitchenId/rate-cards", async (req, res) => {
    const user = await requireUser(req);
    if (user.role === "member") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const cards = await store.getRateCards(pool, kitchen.id);
    res.json({ rate_cards: cards.map((card) => rateCardJson(card, todayIn(kitchen))) });
  });

  router.post("/kitchens/:kitchenId/rate-cards", async (req, res) => {
    const body = await readJsonBody(req);
    const user = await requireUser(req);
    if (user.role !== "operator") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const stations = await store.getStations(pool, kitchen.id);
    const today = todayIn(kitchen);
    const effectiveFrom = body.effective_from;
    if (typeof effectiveFrom !== "string" || !isValidDate(effectiveFrom)) {
      throw validation({ effective_from: "Choose today or a later date." });
    }
    if (effectiveFrom < today) {
      throw validation({ effective_from: "Choose today or a later date." });
    }
    const tiers = body.tier_rates_cents;
    if (!Array.isArray(tiers) || tiers.length !== 4 || tiers.some((tier) => typeof tier !== "number" || !Number.isInteger(tier) || tier <= 0)) {
      throw validation({ tier_rates_cents: "Enter an amount in dollars and cents." });
    }
    const surchargesRaw = body.station_surcharges_cents;
    if (typeof surchargesRaw !== "object" || surchargesRaw === null || Array.isArray(surchargesRaw)) {
      throw validation({ station_surcharges_cents: "Enter an amount for every station." });
    }
    const surcharges: Record<string, number> = {};
    for (const station of stations) {
      const value = (surchargesRaw as Record<string, unknown>)[station.id];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw validation({ station_surcharges_cents: "Enter an amount for every station." });
      }
      surcharges[station.id] = value;
    }
    const window = body.cancellation_window_hours;
    if (typeof window !== "number" || !Number.isInteger(window) || window < 0 || window > 336) {
      throw validation({ cancellation_window_hours: "Choose a window of 0 to 336 hours." });
    }
    const packPrice = body.pack_price_cents;
    if (typeof packPrice !== "number" || !Number.isInteger(packPrice) || packPrice <= 0) {
      throw validation({ pack_price_cents: "Enter an amount in dollars and cents." });
    }
    const duplicate = await pool.query("SELECT 1 FROM rate_cards WHERE kitchen_id = $1 AND effective_from = $2", [kitchen.id, effectiveFrom]);
    if (duplicate.rows.length > 0) {
      throw rateCardExists();
    }
    const id = `rc-${randomBytes(8).toString("hex")}`;
    await pool.query(
      `INSERT INTO rate_cards (id, kitchen_id, effective_from, tier_rates_cents, station_surcharges_cents,
         cancellation_window_hours, pack_price_cents, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [id, kitchen.id, effectiveFrom, JSON.stringify(tiers), JSON.stringify(surcharges), window, packPrice]
    );
    await store.insertAudit(pool, "rate_card", id, null, "added", user.id);
    const card = (await store.getRateCards(pool, kitchen.id)).find((entry) => entry.id === id)!;
    res.status(201).json({ rate_card: rateCardJson(card, today) });
  });

  // ---------- reports ----------

  function csvField(value: string): string {
    if (/[",\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  async function buildUsageReport(kitchen: store.KitchenRow, month: string): Promise<Record<string, unknown>> {
    const first = `${month}-01`;
    const y = Number.parseInt(month.slice(0, 4), 10);
    const m = Number.parseInt(month.slice(5, 7), 10);
    const lastDate = new Date(Date.UTC(y, m, 0));
    const last = `${month}-${String(lastDate.getUTCDate()).padStart(2, "0")}`;
    const members = await store.getMembers(pool, kitchen.id);
    const memberReport: Array<Record<string, unknown>> = [];
    for (const member of members) {
      const booked = await pool.query(
        `SELECT COALESCE(SUM(quarters), 0) AS q FROM bookings WHERE member_id = $1 AND date >= $2 AND date <= $3`,
        [member.id, first, last]
      );
      const cancelled = await pool.query(
        `SELECT COALESCE(SUM(quarters), 0) AS q FROM bookings WHERE member_id = $1 AND date >= $2 AND date <= $3 AND state = 'cancelled_in_window'`,
        [member.id, first, last]
      );
      const billed = await pool.query(
        `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM invoices WHERE member_id = $1 AND issued_at::date >= $2 AND issued_at::date <= $3`,
        [member.id, first, last]
      );
      const refunded = await pool.query(
        `SELECT COALESCE(SUM(total_cents), 0) AS cents FROM bookings WHERE member_id = $1 AND date >= $2 AND date <= $3 AND state = 'cancelled_in_window'`,
        [member.id, first, last]
      );
      const balance = await store.packBalance(pool, member.id);
      memberReport.push({
        member_id: member.id,
        business: member.business,
        booked_hours: formatHours(Number.parseInt(booked.rows[0]!.q, 10)),
        cancelled_in_window_hours: formatHours(Number.parseInt(cancelled.rows[0]!.q, 10)),
        billed_cents: Number.parseInt(billed.rows[0]!.cents, 10),
        refunded_cents: Number.parseInt(refunded.rows[0]!.cents, 10),
        pack_balance_hours: formatHours(balance),
      });
    }
    const stations = await store.getStations(pool, kitchen.id);
    const stationReport: Array<Record<string, unknown>> = [];
    for (const station of stations) {
      const booked = await pool.query(
        `SELECT COALESCE(SUM(1), 0) AS q FROM booking_cells c JOIN bookings b ON b.id = c.booking_id
         WHERE c.station_id = $1 AND b.kitchen_id = $2 AND c.date >= $3 AND c.date <= $4`,
        [station.id, kitchen.id, first, last]
      );
      stationReport.push({ station_id: station.id, name: station.name, booked_hours: formatHours(Number.parseInt(booked.rows[0]!.q, 10)) });
    }
    const invoices = await pool.query(
      `SELECT i.id, i.ref, i.kind::text AS kind, i.member_id, i.booking_ids, i.lines, i.total_cents, i.killbill_invoice_id, i.issued_at, m.business
       FROM invoices i JOIN members m ON m.id = i.member_id
       WHERE i.kitchen_id = $1 AND i.issued_at::date >= $2 AND i.issued_at::date <= $3
       ORDER BY i.issued_at, i.ref`,
      [kitchen.id, first, last]
    );
    const invoiceReport = invoices.rows.map((row) => ({
      invoice_id: row.id,
      ref: row.ref,
      kind: row.kind,
      member_id: row.member_id,
      business: row.business,
      killbill_invoice_id: row.killbill_invoice_id ?? null,
      total_cents: row.total_cents,
      issued_on: kitchenDate(new Date(row.issued_at), kitchen.timezone),
    }));
    const totalBookedQuarters = memberReport.reduce((sum: number, entry: Record<string, unknown>) => sum + Math.round(Number(entry.booked_hours) * 4), 0);
    const totalBilled = invoiceReport.reduce((sum: number, entry: { total_cents: number }) => sum + entry.total_cents, 0);
    const totalRefunded = memberReport.reduce((sum: number, entry: Record<string, unknown>) => sum + Number(entry.refunded_cents), 0);
    return {
      kitchen: { id: kitchen.id, name: kitchen.name, timezone: kitchen.timezone },
      month,
      members: memberReport,
      stations: stationReport,
      invoices: invoiceReport,
      totals: {
        booked_hours: formatHours(totalBookedQuarters),
        billed_cents: totalBilled,
        refunded_cents: totalRefunded,
      },
    };
  }

  router.get("/kitchens/:kitchenId/reports/usage", async (req, res) => {
    const user = await requireUser(req);
    if (user.role === "member") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const month = monthValue(typeof req.query.month === "string" ? req.query.month : undefined);
    res.json(await buildUsageReport(kitchen, month));
  });

  router.get("/kitchens/:kitchenId/reports/usage.csv", async (req, res) => {
    const user = await requireUser(req);
    if (user.role === "member") {
      throw forbidden();
    }
    const kitchen = await requireKitchen(user, req.params.kitchenId!);
    const month = monthValue(typeof req.query.month === "string" ? req.query.month : undefined);
    await buildUsageReport(kitchen, month);
    const rows: string[] = ["invoice_ref,kind,member,booking_ref,date,station,tier,paid_by,hours,amount"];
    const monthEnd = new Date(Date.UTC(Number.parseInt(month.slice(0, 4), 10), Number.parseInt(month.slice(5, 7), 10), 0));
    const last = `${month}-${String(monthEnd.getUTCDate()).padStart(2, "0")}`;
    const invoiceRows = await pool.query(
      `SELECT i.id, i.ref, i.kind::text AS kind, i.booking_ids, i.lines, i.killbill_invoice_id, i.issued_at, m.business
       FROM invoices i JOIN members m ON m.id = i.member_id
       WHERE i.kitchen_id = $1 AND i.issued_at::date >= $2 AND i.issued_at::date <= $3
       ORDER BY i.issued_at, i.ref`,
      [kitchen.id, `${month}-01`, last]
    );
    for (const invoice of invoiceRows.rows) {
      const bookingRef = invoice.kind === "booking" ? (await pool.query("SELECT ref FROM bookings WHERE id = $1", [invoice.booking_ids[0]])).rows[0]?.ref ?? "" : "";
      const bookingDate =
        invoice.kind === "booking" ? (await pool.query("SELECT date::text AS date FROM bookings WHERE id = $1", [invoice.booking_ids[0]])).rows[0]?.date ?? "" : "";
      for (const rawLine of invoice.lines as unknown[]) {
        const line = rawLine as Record<string, unknown>;
        if (typeof line.description === "string" && line.amount_cents !== undefined) {
          rows.push(
            [
              invoice.ref,
              invoice.kind,
              invoice.business,
              "",
              kitchenDate(new Date(invoice.issued_at), kitchen.timezone),
              "",
              "",
              "",
              "20.00",
              (line.amount_cents as number) / 100 >= 0 ? ((line.amount_cents as number) / 100).toFixed(2) : "0.00",
            ]
              .map(csvField)
              .join(",")
          );
          continue;
        }
        rows.push(
          [
            invoice.ref,
            invoice.kind,
            invoice.business,
            bookingRef,
            invoice.kind === "booking" ? bookingDate : "",
            String(line.station),
            String(line.tier),
            String(line.paid_by),
            String(line.hours),
            ((line.amount_cents as number) / 100).toFixed(2),
          ]
            .map(csvField)
            .join(",")
        );
      }
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pilotlight-usage-${kitchen.id}-${month}.csv"`);
    res.send(rows.join("\r\n") + "\r\n");
  });

  return expressRouter;
}
