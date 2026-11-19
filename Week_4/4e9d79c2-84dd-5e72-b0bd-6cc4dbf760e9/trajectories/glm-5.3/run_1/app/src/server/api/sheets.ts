import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson, readText } from "../http.js";
import { vehiclesFor, isoDate } from "../repo.js";
import { isoInstant, foldName } from "../domain.js";
import { penniesToString, splitEvenly, type Pennies } from "../money.js";
import { seatGridFor, WHEELCHAIR_SEATS, adultsNeeded, cancellationDays, cancellationCharge } from "../hours.js";
import { s3Put, objectKeyForPassengers } from "../s3.js";
import { parseCsv, csvBody, fileHeaders } from "../csv.js";
import { vehicleMoney } from "./hires.js";
import { parseBidPrice } from "./bids.js";
import { parseLocalDate, serverNowMinute } from "../validation.js";
import { ukDateString } from "../uktime.js";
import { sendQuoteMail } from "./hires.js";
import { rateTableForDate, quoteEndFor } from "./rate-helpers.js";

interface Strings {
  yourQuote: string;
  quoteSent: string;
  accepted: string;
  deposit: string;
  balance: string;
  travel: string;
  route: string;
  out: string;
  return: string;
  party: string;
  vehicles: string;
  total: string;
  depositDue: string;
  validUntil: string;
  payBy: string;
  accept: string;
  acceptThisQuote: string;
  yourFullName: string;
  confirmAcceptance: string;
  close: string;
  nameMismatch: string;
  quoteAccepted: string;
  sentDeposit: string;
  checkingPayment: string;
  endedLine: string;
  askUs: string;
  cancelled: string;
  downloadQuote: string;
  language: string;
  ended: string;
  person: string;
  people: string;
  vehicle: string;
  vehiclesWord: string;
}

const STR: Record<string, Strings> = {
  en: {
    yourQuote: "Your quote",
    quoteSent: "Quote sent",
    accepted: "Accepted",
    deposit: "Deposit",
    balance: "Balance",
    travel: "Travel",
    route: "Route",
    out: "Out",
    return: "Return",
    party: "Party",
    vehicles: "Vehicles",
    total: "Total",
    depositDue: "Deposit due",
    validUntil: "Valid until",
    payBy: "Pay by bank transfer quoting",
    accept: "Accept",
    acceptThisQuote: "Accept this quote",
    yourFullName: "Your full name",
    confirmAcceptance: "Confirm acceptance",
    close: "Close",
    nameMismatch: "That name does not match this quote.",
    quoteAccepted: "Quote accepted.",
    sentDeposit: "I've sent the deposit",
    checkingPayment: "We're checking your payment",
    endedLine: "This quote ended on",
    askUs: "Ask us for a new one.",
    cancelled: "This booking was cancelled.",
    downloadQuote: "Download quote",
    language: "Language",
    ended: "This page has ended.",
    person: "person",
    people: "people",
    vehicle: "vehicle",
    vehiclesWord: "vehicles",
  },
  pl: {
    yourQuote: "Twoja wycena",
    quoteSent: "Wycena wysłana",
    accepted: "Zaakceptowana",
    deposit: "Zaliczka",
    balance: "Pozostała kwota",
    travel: "Podróż",
    route: "Trasa",
    out: "Wyjazd",
    return: "Powrót",
    party: "Grupa",
    vehicles: "Pojazdy",
    total: "Razem",
    depositDue: "Zaliczka do zapłaty",
    validUntil: "Ważna do",
    payBy: "Zapłać przelewem, podając numer",
    accept: "Akceptuję",
    acceptThisQuote: "Akceptacja wyceny",
    yourFullName: "Imię i nazwisko",
    confirmAcceptance: "Potwierdzam",
    close: "Zamknij",
    nameMismatch: "To nazwisko nie zgadza się z tą wyceną.",
    quoteAccepted: "Wycena zaakceptowana.",
    sentDeposit: "Zaliczka wysłana",
    checkingPayment: "Sprawdzamy Twoją płatność",
    endedLine: "Ta wycena wygasła",
    askUs: "Poproś nas o nową.",
    cancelled: "Ta rezerwacja została anulowana.",
    downloadQuote: "Pobierz wycenę",
    language: "Język",
    ended: "Ta strona wygasła.",
    person: "osoba",
    people: "osoby",
    vehicle: "pojazd",
    vehiclesWord: "pojazdy",
  },
  ur: {
    yourQuote: "آپ کا کوٹیشن",
    quoteSent: "کوٹیشن بھیج دیا گیا",
    accepted: "قبول کر لیا گیا",
    deposit: "پیشگی رقم",
    balance: "بقایا رقم",
    travel: "سفر",
    route: "راستہ",
    out: "روانگی",
    return: "واپسی",
    party: "مسافر",
    vehicles: "گاڑیاں",
    total: "کل رقم",
    depositDue: "واجب الادا پیشگی رقم",
    validUntil: "تک کارآمد",
    payBy: "کا حوالہ دے کر بینک ٹرانسفر سے ادائیگی کریں",
    accept: "قبول کریں",
    acceptThisQuote: "یہ کوٹیشن قبول کریں",
    yourFullName: "آپ کا پورا نام",
    confirmAcceptance: "قبولیت کی تصدیق کریں",
    close: "بند کریں",
    nameMismatch: "یہ نام اس کوٹیشن سے مطابقت نہیں رکھتا۔",
    quoteAccepted: "کوٹیشن قبول کر لی گئی۔",
    sentDeposit: "میں نے پیشگی رقم بھیج دی ہے",
    checkingPayment: "ہم آپ کی ادائیگی کی جانچ کر رہے ہیں",
    endedLine: "یہ کوٹیشن ختم ہو گیا",
    askUs: "ہم سے نیا کوٹیشن مانگیں۔",
    cancelled: "یہ بکنگ منسوخ کر دی گئی۔",
    downloadQuote: "کوٹیشن ڈاؤن لوڈ کریں",
    language: "زبان",
    ended: "یہ صفحہ ختم ہو چکا ہے۔",
    person: "فرد",
    people: "افراد",
    vehicle: "گاڑی",
    vehiclesWord: "گاڑیاں",
  },
};

export function stringsFor(lang: string): Strings {
  return STR[lang] ?? STR.en;
}




/** Polish plural counts per the published table. */
export function polishCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function englishCount(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}

export function urduCount(n: number, one: string, many: string): string {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}

export function dateForLang(lang: string, date: string): string {
  const [y, m, d] = date.split("-");
  if (lang === "pl") return `${d}.${m}.${y}`;
  if (lang === "ur") return `${d}/${m}/${y}`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return `${DAYS[dt.getUTCDay()]} ${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function registerSheetApi(app: Express, ctx: Ctx): void {
  // ---- Customer quote page ----
  app.get("/api/q/:token", async (req: Request, res: Response) => {
    const token = req.params.token;
    const answer = await quotePageAnswer(ctx, token, null);
    res.json(answer);
  });

  app.post("/api/q/:token/accept", async (req: Request, res: Response) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const answer = await quotePageAnswer(ctx, req.params.token, (data) => {
      if (foldName(name) !== foldName(String(data.customer.name ?? ""))) {
        throw errors.invalid({ name: stringsFor(data.language).nameMismatch }, stringsFor(data.language).nameMismatch);
      }
    });
    if (answer.cancelled) throw errors.state("bookingCancelled", stringsFor(answer.language).cancelled);
    const now = new Date();
    const endsAt = answer.endsAt ? new Date(answer.endsAt) : null;
    const alreadyAccepted = answer.state === "accepted";
    if (!alreadyAccepted && endsAt && now.getTime() > endsAt.getTime()) {
      throw errors.state(
        "quoteEnded",
        `${stringsFor(answer.language).endedLine} ${dateForLang(answer.language, String(answer.endedLineDate))}. ${stringsFor(answer.language).askUs}`
      );
    }
    if (!alreadyAccepted) {
      await ctx.db.query("UPDATE hires SET stage='accepted', enquiry_state='won' WHERE id=$1", [answer.hireId]);
      await ctx.db.query("UPDATE enquiries SET state='won' WHERE desk_id=$1 AND reference=$2", [answer.deskId, answer.reference]);
    }
    const after = await quotePageAnswer(ctx, req.params.token, null);
    res.json(after);
  });

  app.post("/api/q/:token/deposit-sent", async (req: Request, res: Response) => {
    void req.body;
    const answer = await quotePageAnswer(ctx, req.params.token, null);
    if (answer.cancelled) throw errors.state("bookingCancelled", stringsFor(answer.language).cancelled);
    if (answer.state !== "accepted") {
      throw errors.state("quoteEnded", stringsFor(answer.language).ended);
    }
    await ctx.db.query("UPDATE hires SET deposit_said_sent=NOW() WHERE id=$1", [answer.hireId]);
    const after = await quotePageAnswer(ctx, req.params.token, null);
    res.json(after);
  });

  // ---- Passengers and seats ----
  app.post("/api/hires/:id/passengers/import", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/csv") throw errors.unsupportedType();
    const text = await readText(req, 1_000_000);
    const parsed = parseCsv(text, ["Name", "Group", "Needs"]);
    if (!parsed) throw errors.invalid({ file: "The first line has to read Name,Group,Needs." });
    if (parsed.rows.length > 500) throw errors.invalid({ file: "This file has more than 500 rows." }, "This file has more than 500 rows.");
    const nameIdx = parsed.header.indexOf("name");
    const groupIdx = parsed.header.indexOf("group");
    const needsIdx = parsed.header.indexOf("needs");
    const listId = "LS-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    let position = 0;
    for (const cells of parsed.rows) {
      const name = (cells[nameIdx] ?? "").trim();
      if (!name) continue;
      const group = (cells[groupIdx] ?? "").trim();
      const needs = (cells[needsIdx] ?? "").trim();
      const folded = foldName(name);
      const listedTwice = seen.has(folded);
      seen.add(folded);
      position++;
      const id = "PS-" + hire.rows[0].reference + "-" + position + "-" + Math.random().toString(36).slice(2, 6);
      const wheelchair = /wheelchair/i.test(needs);
      await ctx.db.query(
        `INSERT INTO passengers (id, desk_id, hire_id, name, "group", needs, listed_twice, wheelchair, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, deskId, hire.rows[0].id, name, group, needs, listedTwice, wheelchair, position]
      );
      out.push({ id, name, group, needs, listedTwice, wheelchair });
    }
    const key = objectKeyForPassengers(deskId, String(hire.rows[0].id), listId);
    try {
      await s3Put(ctx.cfg, key, Buffer.from(text, "utf8"), "text/csv");
    } catch {
      throw errors.provider("The file store is unavailable right now. Nothing was saved.");
    }
    await ctx.db.query("INSERT INTO passenger_files (id, desk_id, hire_id, object_key, created_at) VALUES ($1,$2,$3,$4,NOW())", [
      listId,
      deskId,
      hire.rows[0].id,
      key,
    ]);
    await autoSeatPassengers(ctx, deskId, String(hire.rows[0].id));
    res.status(201).json({ listId, objectKey: key, passengers: out });
  });

  app.post("/api/hires/:id/passengers", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const group = typeof body.group === "string" ? body.group : "";
    const needs = typeof body.needs === "string" ? body.needs : "";
    if (!name) throw errors.invalid({ name: "Enter your name." });
    const all = await ctx.db.query("SELECT name FROM passengers WHERE desk_id=$1 AND hire_id=$2", [deskId, hire.rows[0].id]);
    const listedTwice = all.rows.some((x) => foldName(String(x.name)) === foldName(name));
    const wheelchair = /wheelchair/i.test(needs);
    const position = all.rows.length + 1;
    const id = "PS-" + hire.rows[0].reference + "-" + position + "-" + Math.random().toString(36).slice(2, 6);
    await ctx.db.query(
      `INSERT INTO passengers (id, desk_id, hire_id, name, "group", needs, listed_twice, wheelchair, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, deskId, hire.rows[0].id, name, group, needs, listedTwice, wheelchair, position]
    );
    await autoSeatPassengers(ctx, deskId, String(hire.rows[0].id));
    res.status(201).json({ id, name, group, needs, listedTwice, wheelchair });
  });

  app.get("/api/hires/:id/passengers", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await passengersAnswer(ctx, deskId, String(hire.rows[0].id), String(hire.rows[0].occasion)));
  });

  app.get("/api/hires/:id/seats", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await seatsAnswer(ctx, deskId, String(hire.rows[0].id)));
  });

  app.put("/api/hires/:id/seats", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const vehicleId = typeof body.vehicleId === "string" ? body.vehicleId : "";
    const passengerId = typeof body.passengerId === "string" ? body.passengerId : "";
    const seat = typeof body.seat === "string" ? body.seat : "";
    const vehicle = await ctx.db.query("SELECT * FROM vehicles WHERE desk_id=$1 AND id=$2 AND hire_id=$3", [deskId, vehicleId, hire.rows[0].id]);
    if (!vehicle.rows[0]) throw errors.notFound();
    const passenger = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND id=$2 AND hire_id=$3", [deskId, passengerId, hire.rows[0].id]);
    if (!passenger.rows[0]) throw errors.notFound();
    const grid = seatGridFor(Number(vehicle.rows[0].seats));
    if (!grid.includes(seat)) throw errors.invalid({ seat: "We can't find that." });
    if (passenger.rows[0].wheelchair && !WHEELCHAIR_SEATS.includes(seat)) {
      throw errors.state("wheelchairSeat", "Wheelchair users sit only in 2A and 2B.");
    }
    const occupied = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND vehicle_id=$2 AND seat=$3 AND id<>$4", [
      deskId,
      vehicleId,
      seat,
      passengerId,
    ]);
    if (occupied.rows[0]) {
      const other = occupied.rows[0];
      const oldSeat = passenger.rows[0].seat;
      await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [vehicleId, String(oldSeat ?? ""), other.id]);
    }
    await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [vehicleId, seat, passengerId]);
    res.json(await seatsAnswer(ctx, deskId, String(hire.rows[0].id)));
  });

  app.get("/api/hires/:id/passengers/download", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const customer = await ctx.db.query("SELECT name FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
    const passengers = await ctx.db.query("SELECT p.*, v.seats AS vehicle_seats FROM passengers p LEFT JOIN vehicles v ON v.id=p.vehicle_id WHERE p.desk_id=$1 AND p.hire_id=$2 ORDER BY p.position", [deskId, hire.rows[0].id]);
    const rows = passengers.rows.map((x) => [String(x.name), String(x.group ?? ""), String(x.needs ?? ""), x.vehicle_seats ? String(x.vehicle_seats) : "", x.seat ? String(x.seat) : ""]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.set(fileHeaders(String(customer.rows[0]?.name ?? "customer") + " passengers", "csv"));
    res.send(csvBody(["Name", "Group", "Needs", "Vehicle", "Seat"], rows));
  });

  // ---- Changes ----
  app.post("/api/hires/:id/changes/preview", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    res.json(await changesAnswer(ctx, deskId, hire.rows[0], body, true));
  });

  app.post("/api/hires/:id/changes", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    if (hire.rows[0].stage !== "accepted") throw errors.state("beforeAcceptance", "This hire has no accepted quote yet.");
    const preview = await changesAnswer(ctx, deskId, hire.rows[0], body, false);
    await applyChange(ctx, deskId, hire.rows[0], body);
    const after = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hire.rows[0].id]);
    res.status(201).json({ ...preview, id: String(after.rows[0].id), quotePath: after.rows[0].quote_path ? String(after.rows[0].quote_path) : null });
  });

  app.get("/api/hires/:id/changes", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const changes = await ctx.db.query("SELECT * FROM hire_changes WHERE desk_id=$1 AND hire_id=$2 ORDER BY at", [deskId, hire.rows[0].id]);
    res.json({ changes: changes.rows.map(changeOut), cancellation: null });
  });

  // ---- Cancellations ----
  app.post("/api/hires/:id/cancel/preview", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    res.json(await cancellationAnswer(ctx, deskId, hire.rows[0], body));
  });

  app.post("/api/hires/:id/cancel", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    if (hire.rows[0].cancelled) {
      const existing = await ctx.db.query("SELECT * FROM cancellations WHERE desk_id=$1 AND hire_id=$2", [deskId, hire.rows[0].id]);
      res.json({ cancellation: cancellationOut(existing.rows[0]) });
      return;
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const answer = (await cancellationAnswer(ctx, deskId, hire.rows[0], body)).cancellation as Record<string, unknown>;
    await ctx.db.query("UPDATE hires SET cancelled=TRUE, cancelled_at=NOW() WHERE id=$1", [hire.rows[0].id]);
    await ctx.db.query("INSERT INTO cancellations (id, desk_id, hire_id, notice_at, by, lines) VALUES ($1,$2,$3,$4,$5,$6)", [
      answer.id,
      deskId,
      hire.rows[0].id,
      new Date(String(answer.noticeAt)),
      answer.by,
      JSON.stringify(answer.lines),
    ]);
    res.json({ cancellation: answer });
  });
}

function changeOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id),
    at: isoInstant(r.at as Date),
    old: r.old_data,
    new: r.new_data,
    priceMoved: Boolean(r.price_moved),
  };
}

function cancellationOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id),
    noticeAt: isoInstant(r.notice_at as Date),
    by: String(r.by),
    lines: r.lines,
  };
}

interface QuotePageAnswer extends Record<string, unknown> {
  language: string;
  cancelled: boolean;
  state: string;
  hireId: string;
  deskId: string;
  reference: string;
  endsAt: string | null;
  endedLineDate: string | null;
}

export async function quotePageAnswer(
  ctx: Ctx,
  token: string,
  check: ((data: QuotePageData) => void) | null
): Promise<QuotePageAnswer> {
  const t = await ctx.db.query("SELECT * FROM quote_tokens WHERE token=$1", [token]);
  if (!t.rows[0]) throw errors.notFound();
  const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [t.rows[0].hire_id]);
  if (!hire.rows[0]) throw errors.notFound();
  if (t.rows[0].replaced_at) throw errors.ended();
  const deskId = String(t.rows[0].desk_id);
  const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.rows[0].customer_id]);
  if (!customer.rows[0] || customer.rows[0].state === "erased") throw errors.ended();
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [hire.rows[0].reference]);
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.rows[0].id));
  const money = await vehicleMoney(ctx, deskId, vehicles);
  const now = new Date();
  const endsAt = hire.rows[0].quote_ends_at ? (hire.rows[0].quote_ends_at as Date) : null;
  const accepted = hire.rows[0].stage === "accepted" || hire.rows[0].stage === "deposit" || hire.rows[0].stage === "balance";
  const stageValue = stageFor(hire.rows[0], money.paymentState, vehicles, now);
  const language = String(customer.rows[0].language ?? "en");
  let state: string;
  if (accepted) state = "accepted";
  else if (endsAt && now.getTime() > endsAt.getTime()) state = "ended";
  else state = "open";
  let total = 0;
  let depositTotal = 0;
  for (const v of vehicles) {
    total += v.total;
    depositTotal += v.deposit;
  }
  const departInstant = hire.rows[0].depart_instant as Date;
  const data: QuotePageData = {
    hireId: String(hire.rows[0].id),
    deskId,
    customer: { name: String(customer.rows[0].name) },
    language,
  };
  if (check) check(data);
  return {
    hireId: data.hireId,
    deskId: data.deskId,
    reference: String(hire.rows[0].reference),
    language,
    state,
    stage: stageValue,
    stops: stops.rows.map((x) => String(x.text)),
    departAt: { date: String(hire.rows[0].depart_date), time: String(hire.rows[0].depart_time) },
    departInstant: isoInstant(departInstant),
    returnAt: hire.rows[0].return_date ? { date: String(hire.rows[0].return_date), time: String(hire.rows[0].return_time) } : null,
    returnInstant: hire.rows[0].return_instant ? isoInstant(hire.rows[0].return_instant as Date) : null,
    people: Number((await ctx.db.query("SELECT people FROM enquiries WHERE desk_id=$1 AND reference=$2", [deskId, hire.rows[0].reference])).rows[0]?.people ?? 0),
    vehicles: vehicles.map((v) => ({ seats: v.seats, total: penniesToString(v.total), deposit: penniesToString(v.deposit) })),
    total: penniesToString(total),
    depositTotal: penniesToString(depositTotal),
    validUntil: endsAt ? ukDateString(new Date(endsAt.getTime() - 1000)) : null,
    endsAt: endsAt ? isoInstant(endsAt) : null,
    depositSaidSent: Boolean(hire.rows[0].deposit_said_sent),
    cancelled: Boolean(hire.rows[0].cancelled),
    endedLineDate: endsAt ? ukDateString(new Date(endsAt.getTime() - 1000)) : null,
  };
}

interface QuotePageData {
  hireId: string;
  deskId: string;
  customer: { name: string };
  language: string;
}

function stageFor(hire: Record<string, unknown>, paymentState: string, vehicles: { departInstant: Date | null }[], now: Date): string {
  if (vehicles.some((v) => v.departInstant && v.departInstant.getTime() <= now.getTime())) return "travel";
  if (hire.stage === "accepted" || hire.stage === "deposit" || hire.stage === "balance") {
    if (paymentState === "paidInFull") return "balance";
    if (paymentState === "depositPaid") return "deposit";
    return "accepted";
  }
  return "quoteSent";
}

async function autoSeatPassengers(ctx: Ctx, deskId: string, hireId: string): Promise<void> {
  const hire = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hireId]);
  if (!hire.rows[0]) return;
  const vehicles = await vehiclesFor(ctx.db, deskId, hireId);
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  const seated = new Set(
    (await ctx.db.query("SELECT vehicle_id, seat FROM passengers WHERE desk_id=$1 AND hire_id=$2 AND seat IS NOT NULL", [deskId, hireId])).rows.map(
      (x) => `${x.vehicle_id}|${x.seat}`
    )
  );
  let vehicleIndex = 0;
  for (const p of passengers.rows) {
    if (p.seat) continue;
    const wheelchair = Boolean(p.wheelchair);
    if (wheelchair) {
      const v = vehicles.find((x) => x.seats === 16 || x.seats === 49) ?? vehicles[0];
      if (!v) continue;
      for (const s of WHEELCHAIR_SEATS) {
        if (!seated.has(`${v.id}|${s}`)) {
          await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [v.id, s, p.id]);
          seated.add(`${v.id}|${s}`);
          break;
        }
      }
      continue;
    }
    while (vehicleIndex < vehicles.length) {
      const v = vehicles[vehicleIndex];
      const grid = seatGridFor(v.seats);
      let placed = false;
      for (const s of grid) {
        if (WHEELCHAIR_SEATS.includes(s) && (v.seats === 16 || v.seats === 49)) continue;
        if (!seated.has(`${v.id}|${s}`)) {
          await ctx.db.query("UPDATE passengers SET vehicle_id=$1, seat=$2 WHERE id=$3", [v.id, s, p.id]);
          seated.add(`${v.id}|${s}`);
          placed = true;
          break;
        }
      }
      if (placed) break;
      vehicleIndex++;
    }
  }
}

async function passengersAnswer(ctx: Ctx, deskId: string, hireId: string, occasion: string): Promise<Record<string, unknown>> {
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  const rows = passengers.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    group: x.group ? String(x.group) : "",
    needs: x.needs ? String(x.needs) : "",
    listedTwice: Boolean(x.listed_twice),
    wheelchair: Boolean(x.wheelchair),
  }));
  let adultsNeededCount = 0;
  let adults = 0;
  let pupils = 0;
  if (occasion === "school") {
    for (const r of rows) {
      if (String(r.group).toLowerCase() === "adult") adults++;
      else pupils++;
    }
    adultsNeededCount = adultsNeeded(pupils);
  }
  const adultsShort = Math.max(0, adultsNeededCount - adults);
  return { passengers: rows, adultsNeeded: adultsNeededCount, adultsShort };
}

async function seatsAnswer(ctx: Ctx, deskId: string, hireId: string): Promise<Record<string, unknown>> {
  const vehicles = await vehiclesFor(ctx.db, deskId, hireId);
  const passengers = await ctx.db.query("SELECT * FROM passengers WHERE desk_id=$1 AND hire_id=$2 ORDER BY position", [deskId, hireId]);
  const byId = new Map(passengers.rows.map((x) => [String(x.id), x]));
  const out: Record<string, unknown>[] = [];
  for (const v of vehicles) {
    const grid = seatGridFor(v.seats);
    const seated = new Map<string, string>();
    for (const p of passengers.rows) {
      if (p.vehicle_id === v.id && p.seat) seated.set(String(p.seat), String(p.id));
    }
    const gridOut = grid.map((s) => ({ seat: s, passengerId: seated.get(s) ?? null }));
    const seatedIds = [...seated.values()];
    const seatedRows = seatedIds.map((id) => byId.get(id)!).filter(Boolean);
    const split = splitEvenly(v.total, seatedRows.length);
    out.push({
      id: v.id,
      seats: v.seats,
      grid: gridOut,
      split: seatedRows.map((p, i) => ({ passengerId: String(p.id), name: String(p.name), amount: penniesToString(split[i] ?? 0) })),
    });
  }
  return { vehicles: out };
}

async function changesAnswer(ctx: Ctx, deskId: string, hire: Record<string, unknown>, body: Record<string, unknown>, preview: boolean): Promise<Record<string, unknown>> {
  if (hire.stage !== "accepted" && hire.stage !== "deposit" && hire.stage !== "balance") {
    throw errors.state("beforeAcceptance", "This hire has no accepted quote yet.");
  }
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [hire.reference]);
  const oldAnswer = {
    departAt: { date: String(hire.depart_date), time: String(hire.depart_time) },
    stops: stops.rows.map((x) => String(x.text)),
    vehicles: vehicles.map((v) => ({ id: v.id, boughtPrice: v.bought === null ? null : penniesToString(v.bought), marginPercent: v.margin, total: penniesToString(v.total), deposit: penniesToString(v.deposit) })),
    total: penniesToString(vehicles.reduce((s, v) => s + v.total, 0)),
  };
  const departAt = body.departAt ? parseLocalDate(body.departAt, "departAt") : null;
  const newStops = Array.isArray(body.stops) ? body.stops.map(String) : null;
  const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
  const rate = await rateTableForDate(ctx, deskId, String(hire.depart_date));
  const newVehicles: Record<string, unknown>[] = [];
  const priceMovedList: { vehicleId: string; refundsDue: number; owed: number }[] = [];
  for (const v of vehicles) {
    const change = vehiclesIn.find((x) => typeof (x as Record<string, unknown>).id === "string" && String((x as Record<string, unknown>).id) === v.id) as
      | Record<string, unknown>
      | undefined;
    const bought = change && typeof change.boughtPrice === "string" ? parseBidPrice(change.boughtPrice) : v.bought;
    const margin = change && typeof change.marginPercent === "string" ? change.marginPercent : v.margin ?? "15";
    const { quoteVehicleMoney } = await import("../rules.js");
    const money = bought !== null ? quoteVehicleMoney(bought, margin, v.seats, rate.deposits) : null;
    const newTotal = money?.total ?? v.total;
    const paid = await paidFor(ctx, deskId, v.id);
    const depositOld = v.deposit;
    const refundsDue = Math.max(0, paid - Math.max(newTotal, depositOld));
    const owed = Math.max(0, newTotal - paid);
    newVehicles.push({
      id: v.id,
      boughtPrice: bought === null ? null : penniesToString(bought),
      marginPercent: margin,
      total: penniesToString(newTotal),
      deposit: penniesToString(money?.deposit ?? depositOld),
    });
    priceMovedList.push({ vehicleId: v.id, refundsDue, owed });
  }
  const priceMoved = newVehicles.some((nv, i) => String(nv.total) !== penniesToString(vehicles[i].total)) || departAt !== null || newStops !== null;
  return {
    old: oldAnswer,
    new: {
      departAt: departAt ? { date: departAt.date, time: departAt.time } : oldAnswer.departAt,
      stops: newStops ?? oldAnswer.stops,
      vehicles: newVehicles,
      total: penniesToString(newVehicles.reduce((s: number, v) => s + Math.round(Number(v.total) * 100), 0)),
    },
    priceMoved,
    lines: priceMovedList,
    preview,
  };
}

async function paidFor(ctx: Ctx, deskId: string, vehicleId: string): Promise<Pennies> {
  const r = await ctx.db.query("SELECT COALESCE(SUM(amount_pennies),0) AS s FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2 AND account='clientMoney'", [deskId, vehicleId]);
  return Number(r.rows[0].s);
}

async function applyChange(ctx: Ctx, deskId: string, hire: Record<string, unknown>, body: Record<string, unknown>): Promise<void> {
  const departAt = body.departAt ? parseLocalDate(body.departAt, "departAt") : null;
  if (departAt) {
    await ctx.db.query("UPDATE hires SET depart_date=$1, depart_time=$2, depart_instant=$3 WHERE id=$4", [departAt.date, departAt.time, departAt.instant, hire.id]);
    await ctx.db.query("UPDATE runs SET depart_date=$1, depart_time=$2, depart_instant=$3, told_at=NULL WHERE hire_id=$4", [departAt.date, departAt.time, departAt.instant, hire.id]);
    await ctx.db.query("UPDATE vehicles SET depart_date=$1, depart_time=$2, depart_instant=$3 WHERE hire_id=$4", [departAt.date, departAt.time, departAt.instant, hire.id]);
  }
  const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
  const rate = await rateTableForDate(ctx, deskId, isoDate(hire.depart_date));
  const { quoteVehicleMoney } = await import("../rules.js");
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const changedIds = new Set<string>();
  for (const v of vehicles) {
    const change = vehiclesIn.find((x) => typeof (x as Record<string, unknown>).id === "string" && String((x as Record<string, unknown>).id) === v.id) as
      | Record<string, unknown>
      | undefined;
    if (!change) continue;
    changedIds.add(v.id);
    const bought = typeof change.boughtPrice === "string" ? parseBidPrice(change.boughtPrice) : v.bought;
    const margin = typeof change.marginPercent === "string" ? change.marginPercent : v.margin ?? "15";
    const money = bought !== null ? quoteVehicleMoney(bought, margin, v.seats, rate.deposits) : null;
    await ctx.db.query(
      "UPDATE vehicles SET bought_pennies=$1, margin_percent=$2, selling_pennies=$3, vat_pennies=$4, total_pennies=$5, deposit_pennies=$6 WHERE id=$7",
      [bought, margin, money?.selling ?? v.selling, money?.vat ?? v.vat, money?.total ?? v.total, money?.deposit ?? v.deposit, v.id]
    );
  }
  await ctx.db.query("INSERT INTO hire_changes (id, desk_id, hire_id, at, old_data, new_data, price_moved) VALUES ($1,$2,$3,NOW(),$4,$5,$6)", [
    "CH-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    deskId,
    hire.id,
    JSON.stringify(body.old ?? null),
    JSON.stringify(body.new ?? null),
    Boolean(body.priceMoved),
  ]);
  // A moved price ends the old private page and issues a fresh one.
  const priceMoved = changedIds.size > 0 || departAt !== null;
  if (priceMoved) {
    await ctx.db.query("UPDATE quote_tokens SET replaced_at=NOW() WHERE desk_id=$1 AND hire_id=$2 AND replaced_at IS NULL", [deskId, hire.id]);
    const token = "q" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const now = new Date();
    const endsAt = quoteEndFor(now, ctx.cfg.quoteValidSeconds);
    await ctx.db.query("UPDATE hires SET quote_path=$1, quote_sent_at=$2, quote_ends_at=$3 WHERE id=$4", [token, now, endsAt, hire.id]);
    await ctx.db.query("INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,$4,$5)", [
      token,
      deskId,
      hire.id,
      Number(hire.quote_version),
      now,
    ]);
    const customer = await ctx.db.query("SELECT * FROM customers WHERE id=$1", [hire.customer_id]);
    const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
    const total = vehicles.reduce((s, v) => s + v.total, 0);
    await sendQuoteMail(ctx, String(customer.rows[0]?.email ?? ""), String(hire.reference), String(customer.rows[0]?.language ?? "en"), total, endsAt, token);
  }
}

async function cancellationAnswer(ctx: Ctx, deskId: string, hire: Record<string, unknown>, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const notice = parseLocalDate(body.noticeAt ?? {}, "noticeAt");
  const by = body.by === "arranger" ? "arranger" : "customer";
  const departDate = String(hire.depart_date);
  const now = serverNowMinute();
  const departInstant = hire.depart_instant as Date;
  if (notice.instant.getTime() >= departInstant.getTime() && departInstant.getTime() <= now.getTime()) {
    throw errors.state("departureGone", "This departure has already gone.");
  }
  const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.id));
  const lines: Record<string, unknown>[] = [];
  for (const v of vehicles) {
    const days = cancellationDays(departDate, notice.date);
    const paid = await paidFor(ctx, deskId, v.id);
    let charge: Pennies;
    let refundsDue = 0;
    let owed = 0;
    if (by === "arranger") {
      charge = 0;
      refundsDue = paid;
    } else {
      charge = cancellationCharge(days, v.total, v.deposit);
      if (paid > charge) refundsDue = paid - charge;
      if (paid < charge) owed = charge - paid;
    }
    lines.push({ vehicleId: v.id, days, charge: penniesToString(charge), paid: penniesToString(paid), refundsDue: penniesToString(refundsDue), owed: penniesToString(owed) });
  }
  return {
    cancellation: {
      id: "CX-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
      noticeAt: isoInstant(notice.instant),
      by,
      lines,
    },
  };
}
