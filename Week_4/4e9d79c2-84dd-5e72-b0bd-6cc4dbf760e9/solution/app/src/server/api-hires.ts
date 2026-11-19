import { config } from "./config.js";
import { nowSeconds, one, pool, rows, transaction, type Db, only } from "./db.js";
import {
  depositFor, hireMoney, marginText, MARGIN_COPY, parseMargin, rateById, moveEnquiryState, rateInForce, requireHire, SIZES, SIZES_COPY, vehiclesOf, vehicleTotals, type RateTable, type VehicleMoney,
} from "./domain.js";
import { ApiError, conflict, objectsIn, instantText, moneyText, newId, newToken, notFound, ok, parseMoney, refused, unavailable, route, type ApiRoute, type Ctx, type Untrusted } from "./http.js";
import { customerFor, insertStops, localJson, stopsOf, unusedReference } from "./api-enquiries.js";
import { createRuns } from "./api-runs.js";
import { awardedJson, MAIL_DOWN, operatorsOf } from "./api-operators.js";
import { renderedQuote } from "./api-documents.js";
import { sendMail, ProviderDown } from "./providers.js";
import { copyFor, dateIn, type Language } from "../shared/strings.js";
import { foldName, isEmail, isUkTelephone, missingHourGuard, money, wholeInRange } from "../shared/rules.js";
import { addDays, daysBetween, endOfUkDay, isRealDate, longDate, toInstant, ukDate, ukTime, type LocalDateTime } from "../shared/time.js";
import type { CustomerRow, HireRow, RunRow } from "./records.js";

export const AMOUNT_COPY = "Enter the amount in pounds and pence.";

const vehicleJson = (v: VehicleMoney): Record<string, unknown> => ({
  id: v.id, seats: v.seats, operatorId: v.operator_id, boughtPrice: moneyText(v.bought), marginPercent: marginText(v.margin_halves), sellingPrice: moneyText(v.selling), vat: moneyText(v.vat),
  total: moneyText(v.total), deposit: moneyText(v.deposit), departAt: localJson(v.depart_date, v.depart_time, v.depart_repeated), departInstant: instantText(v.depart_instant), runId: v.runId,
});
const quotePath = (hire: HireRow): string | null => (hire.quote_token ? `/q/${hire.quote_token}` : null);
const hireStage = (hire: HireRow): string => (hire.accepted_at !== null ? "accepted" : hire.quote_token ? "quoted" : "enquiry");
export const quoteEnds = (sentAt: number): number => (config.quoteValidSeconds ? sentAt + config.quoteValidSeconds : endOfUkDay(addDays(ukDate(sentAt), 5)));

const runsOf = async (db: Db, hireId: string): Promise<{ id: string; number: number; sheetPath: string }[]> =>
  (await rows<Pick<RunRow, "id" | "number" | "token">>(db, "SELECT id,number,token FROM runs WHERE hire_id=$1 ORDER BY number", [hireId])).map((r) => ({ id: r.id, number: r.number, sheetPath: `/r/${r.token}` }));

const hireJson = async (db: Db, hire: HireRow): Promise<Record<string, unknown>> => {
  const vehicles = await vehiclesOf(db, hire.id);
  return {
    id: hire.id, reference: hire.id, customerId: hire.customer_id, stage: hireStage(hire), enquiryState: hire.state, quotePath: quotePath(hire), sentAt: instantText(hire.quote_sent_at),
    validUntil: hire.quote_ends_at ? ukDate(hire.quote_ends_at) : null, endsAt: instantText(hire.quote_ends_at),
    vehicles: vehicles.length ? vehicles.map(vehicleJson) : (hire.plan_sizes ?? []).map((seats: number) => ({ id: null, seats })),
    runs: await runsOf(db, hire.id),
  };
};
const hireRead = async (db: Db, hire: HireRow): Promise<Record<string, unknown>> => {
  const vehicles = await vehiclesOf(db, hire.id);
  const money_ = await hireMoney(db, hire.id, vehicles);
  const first = vehicles.reduce((a, v) => Math.min(a, v.depart_instant), hire.depart_instant);
  const base = await hireJson(db, hire);
  return {
    ...base, paymentState: money_.paymentState, paid: moneyText(money_.paid), owed: moneyText(money_.owed), credit: moneyText(money_.credit), balanceDueOn: addDays(ukDate(first), -7), awarded: await awardedJson(db, hire),
    vehicles: vehicles.map((v) => ({ ...vehicleJson(v), depositPaid: moneyText(v.depositPaid), balancePaid: moneyText(v.balancePaid), refundsDue: moneyText(v.refundsDue), owedAmount: moneyText(v.owed) })),
  };
};

const quoteJson = async (db: Db, hire: HireRow): Promise<Record<string, unknown>> => {
  const vehicles = await vehiclesOf(db, hire.id);
  return {
    version: hire.quote_version, sentAt: instantText(hire.quote_sent_at), validUntil: hire.quote_ends_at ? ukDate(hire.quote_ends_at) : null, endsAt: instantText(hire.quote_ends_at), quotePath: quotePath(hire), rateTableId: hire.rate_table_id,
    vehicles: vehicles.map((v) => ({ id: v.id, seats: v.seats, boughtPrice: moneyText(v.bought), marginPercent: marginText(v.margin_halves), sellingPrice: moneyText(v.selling), vat: moneyText(v.vat), total: moneyText(v.total), deposit: moneyText(v.deposit) })),
    total: moneyText(vehicles.reduce((a, v) => a + v.total, 0)), depositTotal: moneyText(vehicles.reduce((a, v) => a + v.deposit, 0)),
  };
};

export const hireRates = (db: Db, hire: HireRow): Promise<RateTable> => (hire.rate_table_id ? rateById(db, hire.rate_table_id) : rateInForce(db, hire.desk_id, ukDate(nowSeconds())));

export const quoteMail = async (hire: HireRow, customer: CustomerRow, vehicles: VehicleMoney[]): Promise<void> => {
  const lang = customer.language as Language;
  const t = copyFor(lang);
  const total = money(vehicles.reduce((a, v) => a + v.total, 0));
  await sendMail(customer.email, t.yourQuote(hire.id), `${t.total}: ${total}\n${t.validUntil(dateIn(lang, ukDate(hire.quote_ends_at as number)))}\n\n${config.publicUrl}${quotePath(hire)}\n`);
};

/** The one way a quote page replaces another: the old address has then ended. */
export const replaceQuotePage = async (tx: Db, hire: HireRow, language: string): Promise<string> => {
  if (hire.quote_token) await tx.query("INSERT INTO replaced_tokens (token,hire_id,language) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [hire.quote_token, hire.id, language]);
  return newToken();
};
const refreshDeposits = async (tx: Db, hireId: string, rates: RateTable): Promise<void> => {
  for (const v of await vehiclesOf(tx, hireId)) await tx.query("UPDATE vehicles SET deposit=$2 WHERE id=$1", [v.id, depositFor(v.seats, v.total, rates)]);
};

const loadHire = (ctx: Ctx): Promise<HireRow> => requireHire(pool, ctx.desk!.id, ctx.params.id);

const parseVehicles = async (body: Untrusted, deskId: string): Promise<Untrusted[]> => {
  const vehicles = objectsIn(body.vehicles);
  if (body.stage === "enquiry") return vehicles;
  const operators = await operatorsOf(pool, deskId);
  for (const v of vehicles) if (v.operatorId !== undefined && !operators.some((o) => o.id === v.operatorId)) throw notFound();
  return vehicles;
};

const hireFields = (body: Untrusted): void => {
  const c = body.customer ?? {};
  const fields: Record<string, string> = {};
  if (typeof c.name !== "string" || !c.name.trim()) fields.name = "Enter your name.";
  if (typeof c.email !== "string" || !isEmail(c.email)) fields.email = "Enter a real email address.";
  if (typeof c.telephone !== "string" || !isUkTelephone(c.telephone)) fields.telephone = "Enter a UK telephone number.";
  if (!["school", "weddings", "company", "festivals"].includes(body.occasion)) fields.occasion = "Choose an occasion.";
  if (!["enquiry", "quoted", "accepted"].includes(body.stage)) fields.stage = "Choose a stage.";
  if (!Array.isArray(body.stops) || body.stops.length < 2 || body.stops.length > 7 || body.stops.some((s: unknown) => typeof s !== "string" || !s.trim())) fields.from = "Enter the pick-up address.";
  const party = body.party ?? {};
  if (!wholeInRange(party.people, 1, 400)) fields.people = "Enter between 1 and 400 people.";
  const at = missingHourGuard(body.departAt);
  if (at) fields.departAt = at;
  if (body.returnAt) {
    const back = missingHourGuard(body.returnAt);
    if (back) fields.returnAt = back;
  }
  if (body.stage !== "enquiry") {
    const vehicles = objectsIn(body.vehicles);
    for (const v of vehicles) {
      if (!SIZES.includes(v.seats)) fields.vehicles = SIZES_COPY;
      if (parseMoney(v.boughtPrice) === null) fields.vehicles = AMOUNT_COPY;
      if (parseMargin(v.marginPercent) === null) fields.vehicles = MARGIN_COPY;
    }
    if (!vehicles.length) fields.vehicles = "Add at least one vehicle.";
  }
  if (body.stage === "enquiry" && objectsIn(body.vehicles).some((v) => !SIZES.includes(v.seats))) fields.vehicles = SIZES_COPY;
  if (body.quoteSentAt) {
    const sent = missingHourGuard(body.quoteSentAt);
    if (sent) fields.quoteSentAt = sent;
  }
  if (Object.keys(fields).length) throw new ApiError(422, "invalid", Object.values(fields)[0], fields);
};


export const hireRoutes: ApiRoute[] = [
  route({
    method: "POST", path: "/api/hires", body: "json",
    run: async ({ json, desk, text }) => {
      hireFields(json);
      const vehicles = await parseVehicles(json, desk!.id);
      const now = nowSeconds();
      const hire = await transaction<HireRow>(async (tx) => {
        const reference = await unusedReference(tx);
        const language = ["en", "pl", "ur"].includes(json.customer.language) ? json.customer.language : "en";
        const customer = await customerFor(tx, desk!.id, { name: json.customer.name.trim(), email: json.customer.email, telephone: json.customer.telephone, language }, now);
        const depart: LocalDateTime = json.departAt;
        const party = { people: json.party.people, large: json.party.large ?? 0, medium: json.party.medium ?? 0, hand: json.party.hand ?? 0, wheelchairs: json.party.wheelchairs ?? 0 };
        const stage: string = json.stage;
        const sentAt = stage === "enquiry" ? null : json.quoteSentAt ? toInstant(json.quoteSentAt) : now;
        const rates = await rateInForce(tx, desk!.id, ukDate(sentAt ?? now));
        const token = stage === "enquiry" ? null : newToken();
        const sizes = vehicles.length ? vehicles.map((v) => v.seats) : null;
        const back = json.returnAt ?? null;
        await tx.query(
          `INSERT INTO hires (id,desk_id,customer_id,occasion,journey_type,state,plan_sizes,party,name,email,telephone,language,submitted_body,created_at,depart_date,depart_time,depart_repeated,depart_instant,return_date,return_time,return_repeated,return_instant,
             awarded_operator,awarded_at,quote_token,quote_sent_at,quote_ends_at,rate_table_id,accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
          [reference, desk!.id, customer.id, json.occasion, back ? "return" : "oneWay", stage === "accepted" ? "won" : stage === "quoted" ? "quoted" : "new", sizes, JSON.stringify(party), customer.name, customer.email, customer.telephone, customer.language, text, now,
            depart.date, depart.time, depart.repeatedHour ?? null, toInstant(depart), back?.date ?? null, back?.time ?? null, back?.repeatedHour ?? null, back ? toInstant(back) : null,
            stage === "enquiry" ? null : vehicles[0].operatorId ?? null, stage === "enquiry" ? null : now, token, sentAt, sentAt === null ? null : quoteEnds(sentAt), stage === "enquiry" ? null : rates.id, stage === "accepted" ? now : null],
        );
        await insertStops(tx, reference, json.stops.map((text_: string) => ({ text: text_.trim(), checked: false })));
        if (stage !== "enquiry") {
          for (const [position, v] of vehicles.entries()) {
            const figures = { seats: v.seats, bought: parseMoney(v.boughtPrice) as number, margin_halves: parseMargin(v.marginPercent) as number, charges: 0 };
            await tx.query(
              "INSERT INTO vehicles (id,hire_id,position,seats,operator_id,bought,margin_halves,deposit,depart_date,depart_time,depart_repeated,depart_instant) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
              [newId("VH"), reference, position, v.seats, v.operatorId ?? null, figures.bought, figures.margin_halves, depositFor(v.seats, vehicleTotals(figures).total, rates), depart.date, depart.time, depart.repeatedHour ?? null, toInstant(depart)],
            );
          }
        }
        if (stage === "accepted") await createRuns(tx, desk!.id, reference);
        return only<HireRow>(tx, "SELECT * FROM hires WHERE id=$1", [reference]);
      });
      return ok(await hireJson(pool, hire), 201);
    },
  }),
  route({ method: "GET", path: "/api/hires/:id", load: loadHire, run: async ({ loaded }) => ok(await hireRead(pool, loaded)) }),
  route({ method: "GET", path: "/api/hires/:id/quote", load: loadHire, run: async ({ loaded }) => ok(await quoteJson(pool, loaded)) }),
  route({
    method: "POST", path: "/api/hires/:id/quote/preview", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      const typed = objectsIn(json.vehicles);
      const rates = await hireRates(pool, loaded);
      const out = typed.map((v) => {
        const margin = parseMargin(v.marginPercent);
        if (margin === null) throw refused(MARGIN_COPY, "marginPercent");
        const bought = parseMoney(v.boughtPrice);
        if (bought === null) throw refused(AMOUNT_COPY, "boughtPrice");
        const { selling, vat, total } = vehicleTotals({ seats: v.seats, bought, margin_halves: margin, charges: 0 });
        const deposit = depositFor(v.seats, total, rates);
        return { seats: v.seats, sellingPrice: moneyText(selling), vat: moneyText(vat), total: moneyText(total), deposit: moneyText(deposit), totalPennies: total, depositPennies: deposit };
      });
      return ok({
        vehicles: out.map(({ totalPennies: _t, depositPennies: _d, ...v }) => v),
        total: moneyText(out.reduce((a, v) => a + v.totalPennies, 0)), depositTotal: moneyText(out.reduce((a, v) => a + v.depositPennies, 0)),
      });
    },
  }),
  route({
    method: "PUT", path: "/api/hires/:id/quote", body: "json", load: loadHire,
    run: async ({ json, desk, loaded }) => {
      const typed = objectsIn(json.vehicles);
      for (const v of typed) if (parseMargin(v.marginPercent) === null) throw refused(MARGIN_COPY, "marginPercent");
      return transaction(async (tx) => {
        const hire = await requireHire(tx, desk!.id, loaded.id, true);
        if (hire.accepted_at !== null) throw conflict("quoteLocked", "This quote is accepted. Use Changes instead.");
        if (json.version !== hire.quote_version) throw new ApiError(412, "staleEdit", `Someone changed this quote at ${ukTime(hire.quote_changed_at ?? hire.quote_sent_at ?? hire.created_at)}. Your edit is still here. Reload to see theirs.`);
        const now = nowSeconds();
        for (const v of typed) await tx.query("UPDATE vehicles SET margin_halves=$3 WHERE id=$1 AND hire_id=$2", [v.id, hire.id, parseMargin(v.marginPercent)]);
        await refreshDeposits(tx, hire.id, await hireRates(tx, hire));
        const saved = await only<HireRow>(tx, "UPDATE hires SET quote_version=quote_version+1,quote_edited=true,quote_changed_at=$2 WHERE id=$1 RETURNING *", [hire.id, now]);
        return ok(await quoteJson(tx, saved));
      });
    },
  }),
  route({
    method: "POST", path: "/api/hires/:id/quote/send", body: "json", load: loadHire,
    run: async ({ desk, loaded }) => {
      const customer = await only<CustomerRow>(pool, "SELECT * FROM customers WHERE id=$1", [loaded.customer_id]);
      const { hire, mail } = await transaction<{ hire: HireRow; mail: boolean }>(async (tx) => {
        const current = await requireHire(tx, desk!.id, loaded.id, true);
        const vehicles = await vehiclesOf(tx, current.id);
        if (!vehicles.length) throw conflict("notAwarded", "Award this hire before sending its quote.");
        if (current.accepted_at !== null) throw conflict("quoteLocked", "This quote is accepted. Use Changes instead.");
                if (current.quote_token && !current.quote_edited) {
          if (current.quote_mailed) return { hire: current, mail: false };
          await moveEnquiryState(tx, current.id, "quoted");
          return { hire: await only<HireRow>(tx, "SELECT * FROM hires WHERE id=$1", [current.id]), mail: true };
        }
        const now = nowSeconds();
        const rates = await rateInForce(tx, desk!.id, ukDate(now));
        await refreshDeposits(tx, current.id, rates);
        const token = await replaceQuotePage(tx, current, customer.language);
        await moveEnquiryState(tx, current.id, "quoted");
        return {
          hire: await only<HireRow>(tx, "UPDATE hires SET quote_token=$2,quote_sent_at=$3,quote_ends_at=$4,rate_table_id=$5,quote_mailed=false,quote_edited=false,deposit_said_sent=false WHERE id=$1 RETURNING *", [current.id, token, now, quoteEnds(now), rates.id]),
          mail: true,
        };
      });
      if (mail) {
        await quoteMail(hire, customer, await vehiclesOf(pool, hire.id)).catch(() => { throw unavailable("mailDown", MAIL_DOWN); });
        await pool.query("UPDATE hires SET quote_mailed=true WHERE id=$1", [hire.id]);
      }
      return ok(await quoteJson(pool, hire));
    },
  }),
  route({
    method: "GET", path: "/api/rates",
    run: async ({ desk }) => {
      const tables = await rows<RateTable>(pool, "SELECT * FROM rate_tables WHERE desk_id=$1 ORDER BY effective_from", [desk!.id]);
      const inForce = await rateInForce(pool, desk!.id, ukDate(nowSeconds()));
      return ok({ tables: tables.map(rateJson), inForce: inForce.id });
    },
  }),
  route({
    method: "POST", path: "/api/rates", body: "json",
    run: async ({ json, desk }) => {
      const date = json.effectiveFrom;
      if (typeof date !== "string" || !isRealDate(date)) throw refused("Enter a date as DD/MM/YYYY.", "effectiveFrom");
      if (daysBetween(ukDate(nowSeconds()), date) < 0) throw refused("A rate table can't start before today.", "effectiveFrom");
      const margin = parseMargin(json.defaultMarginPercent);
      if (margin === null) throw refused(MARGIN_COPY, "defaultMarginPercent");
      const amounts: number[] = [];
      for (const name of ["waitingRatePerHour", "secondDriverCharge", "depositMinibus", "depositMinibusHigher", "depositCoach", "depositCoachHigher"]) {
        const amount = parseMoney(json[name]);
        if (amount === null) throw refused(AMOUNT_COPY, name);
        amounts.push(amount);
      }
      const made = await one<RateTable>(pool, "INSERT INTO rate_tables (id,desk_id,effective_from,margin_halves,waiting_rate,second_driver,deposit_minibus,deposit_minibus_higher,deposit_coach,deposit_coach_higher) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (desk_id,effective_from) DO NOTHING RETURNING *",
        [newId("RT"), desk!.id, date, margin, ...amounts]);
      if (!made) throw conflict("sameDate", `A rate table already starts on ${longDate(date)}.`);
      return ok(rateJson(made), 201);
    },
  }),
  route({
    method: "GET", path: "/api/q/:token", access: "private", load: (ctx) => loadQuotePage(ctx.params.token),
    run: async ({ loaded }) => ok(await quotePageJson(pool, loaded)),
  }),
  route({
    method: "POST", path: "/api/q/:token/accept", access: "private", body: "json", load: (ctx) => loadQuotePage(ctx.params.token),
    run: async ({ json, loaded }) => {
      const customer = await only<CustomerRow>(pool, "SELECT * FROM customers WHERE id=$1", [loaded.customer_id]);
      const t = copyFor(customer.language as Language);
      if (typeof json.name !== "string" || foldName(json.name) !== foldName(customer.name ?? "")) throw new ApiError(422, "nameMismatch", t.nameMismatch, { name: t.nameMismatch });
      return transaction(async (tx) => {
        const hire = await only<HireRow>(tx, "SELECT * FROM hires WHERE id=$1 FOR UPDATE", [loaded.id]);
        if (hire.cancellation) throw conflict("bookingCancelled", t.cancelled);
        if (hire.accepted_at !== null) return ok(await quotePageJson(tx, hire));
        if (nowSeconds() > (hire.quote_ends_at as number)) throw conflict("quoteEnded", t.ended(dateIn(customer.language as Language, ukDate(hire.quote_ends_at as number))));
        await moveEnquiryState(tx, hire.id, "won");
        const accepted = await only<HireRow>(tx, "UPDATE hires SET accepted_at=$2 WHERE id=$1 RETURNING *", [hire.id, nowSeconds()]);
        await createRuns(tx, hire.desk_id, hire.id);
        return ok(await quotePageJson(tx, accepted));
      });
    },
  }),
  route({
    method: "POST", path: "/api/q/:token/deposit-sent", access: "private", body: "json", load: (ctx) => loadQuotePage(ctx.params.token),
    run: async ({ loaded }) => {
      const customer = await only<Pick<CustomerRow, "language">>(pool, "SELECT language FROM customers WHERE id=$1", [loaded.customer_id]);
      if (loaded.cancellation) throw conflict("bookingCancelled", copyFor(customer.language as Language).cancelled);
      if (loaded.accepted_at === null) throw conflict("notAccepted", "Accept this quote first.");
      return ok(await quotePageJson(pool, await only<HireRow>(pool, "UPDATE hires SET deposit_said_sent=true WHERE id=$1 RETURNING *", [loaded.id])));
    },
  }),
  route({
    method: "GET", path: "/api/q/:token/pdf", access: "private", load: (ctx) => loadQuotePage(ctx.params.token),
    run: async ({ loaded }) => {
      try {
        return { status: 200, raw: await renderedQuote(loaded), headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${loaded.id}.pdf"` } };
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("pdfDown", "The PDF service is unavailable right now. Nothing was saved.");
        throw error;
      }
    },
  }),
];

const rateJson = (t: RateTable): Record<string, unknown> => ({
  id: t.id, effectiveFrom: t.effective_from, defaultMarginPercent: marginText(t.margin_halves), waitingRatePerHour: moneyText(t.waiting_rate), secondDriverCharge: moneyText(t.second_driver),
  depositMinibus: moneyText(t.deposit_minibus), depositMinibusHigher: moneyText(t.deposit_minibus_higher), depositCoach: moneyText(t.deposit_coach), depositCoachHigher: moneyText(t.deposit_coach_higher),
});

/** The hire behind a live quote address; replaced or erased answers ended and one that never existed answers not found. */
export const quotePageByToken = async (db: Db, token: string): Promise<{ hire?: HireRow; endedLanguage?: string }> => {
  const hire = await one<HireRow>(db, "SELECT * FROM hires WHERE quote_token=$1", [token]);
  if (hire) return { hire };
  const replaced = await one<{ language: string }>(db, "SELECT language FROM replaced_tokens WHERE token=$1", [token]);
  return replaced ? { endedLanguage: replaced.language } : {};
};
const loadQuotePage = async (token: string): Promise<HireRow> => {
  const found = await quotePageByToken(pool, token);
  if (found.hire) return found.hire;
  if (found.endedLanguage) throw new ApiError(410, "pageEnded", copyFor(found.endedLanguage as Language).pageEnded);
  throw notFound();
};

/** `stage` shows the last step reached, worked out at each read. */
export const quoteStage = (hire: HireRow, firstDeparture: number, paymentState: string, now: number): string => {
  if (hire.accepted_at === null) return "quoteSent";
  if (now >= firstDeparture) return "travel";
  if (paymentState === "paidInFull") return "balance";
  return paymentState === "depositPaid" ? "deposit" : "accepted";
};
const quotePageJson = async (db: Db, hire: HireRow): Promise<Record<string, unknown>> => {
  const vehicles = await vehiclesOf(db, hire.id);
  const stops = await stopsOf(db, hire.id);
  const moneyNow = await hireMoney(db, hire.id, vehicles);
  const now = nowSeconds();
  const first = vehicles.reduce((a, v) => Math.min(a, v.depart_instant), hire.depart_instant);
  const customer = await only<Pick<CustomerRow, "language">>(db, "SELECT language FROM customers WHERE id=$1", [hire.customer_id]);
  return {
    reference: hire.id, language: customer.language, state: hire.accepted_at !== null ? "accepted" : now <= (hire.quote_ends_at as number) ? "open" : "ended", stage: quoteStage(hire, first, moneyNow.paymentState, now),
    stops: stops.map((s) => s.text), departAt: localJson(hire.depart_date, hire.depart_time, hire.depart_repeated), departInstant: instantText(hire.depart_instant),
    returnAt: localJson(hire.return_date, hire.return_time, hire.return_repeated), returnInstant: instantText(hire.return_instant), people: hire.party.people,
    vehicles: vehicles.map((v) => ({ seats: v.seats, total: moneyText(v.total), deposit: moneyText(v.deposit) })), total: moneyText(vehicles.reduce((a, v) => a + v.total, 0)), depositTotal: moneyText(vehicles.reduce((a, v) => a + v.deposit, 0)),
    validUntil: ukDate(hire.quote_ends_at as number), endsAt: instantText(hire.quote_ends_at), depositSaidSent: hire.deposit_said_sent, cancelled: Boolean(hire.cancellation),
  };
};
