import { config } from "./config.js";
import { nowSeconds, one, pool, rows, transaction, type Db } from "./db.js";
import { insertCustomer } from "./api-access.js";
import { isEnquiryState, largerThanNeeded, moveEnquiryState, milesFromKm, newReference, planRefusal, requireHire, suggestPlan, type Party } from "./domain.js";
import { ApiError, conflict, limitReached, fieldErrors, instantText, newId, notFound, ok, refused, searchText, unavailable, route, type ApiRoute, type Ctx, type Untrusted } from "./http.js";
import { addressFind, addressGet, ProviderDown, ProviderMissing, routeLegs } from "./providers.js";
import { readerLength, COPY, foldEmail, foldTelephone, isEmail, isUkTelephone, pickupRefusal, returnRefusal, wholeInRange } from "../shared/rules.js";
import { toInstant, ukDate, ukTime, type LocalDateTime } from "../shared/time.js";
import type { DeskRow, CustomerRow, Leg, HireRow, StopRow } from "./records.js";

const ADDRESS_DOWN = "We could not check this address. You can carry on and type it in full.";

export const localJson = (date: string | null, time: string | null, repeated: string | null): LocalDateTime | null =>
  date && time ? { date, time, ...(repeated ? { repeatedHour: repeated as LocalDateTime["repeatedHour"] } : {}) } : null;
const enquiryRow = (h: HireRow): Record<string, unknown> => ({
  id: h.id, reference: h.id, customerName: h.name, occasion: h.occasion, state: h.state,
  departAt: localJson(h.depart_date, h.depart_time, h.depart_repeated), departInstant: instantText(h.depart_instant), createdAt: instantText(h.created_at),
});

export const stopsOf = (db: Db, hireId: string): Promise<StopRow[]> => rows<StopRow>(db, "SELECT id,text,checked FROM stops WHERE hire_id=$1 ORDER BY position", [hireId]);

/** Every published enquiry rule, in one list of fields. */
const validateEnquiry = (body: Untrusted, now: number): Record<string, string> => {
  const fields: Record<string, string> = {};
  if (!["school", "weddings", "company", "festivals"].includes(body.occasion)) fields.occasion = COPY.occasion;
  if (!["oneWay", "return", "sameDayReturn", "severalStops"].includes(body.journeyType)) fields.journeyType = "Choose a journey type.";
  const stops = Array.isArray(body.stops) ? body.stops : [];
  const stopText = (s: Untrusted): string => (typeof s?.text === "string" ? s.text.trim() : "");
  if (!stopText(stops[0])) fields.from = COPY.from;
  if (stops.length < 2 || !stopText(stops[stops.length - 1])) fields.to = COPY.to;
  else if (stops.some((s: Untrusted) => !stopText(s))) fields.to = COPY.to;
  if (stops.length > 7) fields.to = "Add up to 5 stops.";
  const today = ukDate(now);
  const out = pickupRefusal(body.departAt, now, today);
  if (out) fields.departAt = out;
  if (["return", "sameDayReturn"].includes(body.journeyType) || body.returnAt) {
    const back = out ? null : returnRefusal(body.returnAt, body.departAt);
    if (back) fields.returnAt = back;
  }
  const party = body.party ?? {};
  if (!wholeInRange(party.people, 1, 400)) fields.people = COPY.people;
  for (const bag of ["large", "medium", "hand"]) if (!wholeInRange(party[bag] ?? 0, 0, 40)) fields[bag] = COPY.bags;
  if (!wholeInRange(party.wheelchairs ?? 0, 0, 10)) fields.wheelchairs = COPY.wheelchairs;
  if (body.journeyType === "severalStops" && (typeof body.details !== "string" || !body.details.trim() || readerLength(body.details) > 2000)) fields.details = COPY.details;
  if (typeof body.name !== "string" || !body.name.trim()) fields.name = COPY.name;
  if (typeof body.email !== "string" || !isEmail(body.email)) fields.email = COPY.email;
  if (typeof body.telephone !== "string" || !isUkTelephone(body.telephone)) fields.telephone = COPY.telephone;
  return fields;
};

export const insertStops = async (tx: Db, hireId: string, stops: { text: string; checked: boolean }[]): Promise<void> => {
  for (const [position, stop] of stops.entries()) await tx.query("INSERT INTO stops (id,hire_id,position,text,checked) VALUES ($1,$2,$3,$4,$5)", [newId("ST"), hireId, position, stop.text, stop.checked]);
};
export const unusedReference = async (db: Db): Promise<string> => {
  for (;;) {
    const candidate = newReference();
    if (!(await one(db, "SELECT 1 FROM hires WHERE id=$1", [candidate]))) return candidate;
  }
};
/** A customer whose folded email matches one on the desk is reused. */
export const customerFor = async (tx: Db, deskId: string, c: { name: string; email: string; telephone: string; language: string }, now: number): Promise<CustomerRow> =>
  (await one<CustomerRow>(tx, "SELECT * FROM customers WHERE desk_id=$1 AND email_folded=$2 AND state='active' ORDER BY created_at LIMIT 1", [deskId, foldEmail(c.email)]))
  ?? insertCustomer(tx, deskId, c, now);

const createEnquiry = async (deskId: string, body: Untrusted, raw: string, now: number): Promise<string> =>
  transaction(async (tx) => {
    const reference = await unusedReference(tx);
    const language = ["en", "pl", "ur"].includes(body.language) ? body.language : "en";
    const customer = await customerFor(tx, deskId, { name: body.name.trim(), email: body.email, telephone: body.telephone, language }, now);
    const party = { people: body.party.people, large: body.party.large ?? 0, medium: body.party.medium ?? 0, hand: body.party.hand ?? 0, wheelchairs: body.party.wheelchairs ?? 0 };
    const back = body.returnAt ?? null;
    await tx.query(
      `INSERT INTO hires (id,desk_id,customer_id,occasion,journey_type,party,details,name,email,telephone,language,submitted_body,created_at,depart_date,depart_time,depart_repeated,depart_instant,return_date,return_time,return_repeated,return_instant)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [reference, deskId, customer.id, body.occasion, body.journeyType, JSON.stringify(party), body.details ?? null, body.name.trim(), body.email.trim(), body.telephone, language, raw, now,
        body.departAt.date, body.departAt.time, body.departAt.repeatedHour ?? null, toInstant(body.departAt), back?.date ?? null, back?.time ?? null, back?.repeatedHour ?? null, back ? toInstant(back) : null],
    );
    await insertStops(tx, reference, body.stops.map((s: Untrusted) => ({ text: s.text.trim(), checked: s.checked === true })));
    return reference;
  });

const publicRateLimit = async (ctx: Ctx): Promise<void> => {
  let body: Untrusted;
  try {
    body = JSON.parse(ctx.raw.toString("utf8"));
  } catch {
    return;
  }
  if ((ctx.req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return;
  if (!body || typeof body !== "object" || typeof body.email !== "string" || !body.email.trim() || body.website) return;
  const now = nowSeconds();
  const list = await rows<{ at: number }>(pool, "SELECT at FROM enquiry_requests WHERE email_folded=$1 AND at>$2 ORDER BY at", [foldEmail(body.email), now - config.enquiryRateWindow]);
  if (list.length >= 5) {
    throw limitReached("tooManyRequests", (time) => `You have sent several requests. Try again after ${time}.`, list[0].at + config.enquiryRateWindow, now);
  }
};

const VALID_CURSOR = /^\d+_[A-Z0-9-]+$/;
const cursorOf = (h: HireRow): string => `${h.created_at}_${h.id}`;
export const enquiriesPage = async (deskId: string, query: URLSearchParams): Promise<{ list: HireRow[]; nextCursor: string | null; prevCursor: string | null }> => {
  const q = searchText(query);
  const where = ["h.desk_id=$1", "h.merged_into IS NULL", "c.state='active'"];
  const values: unknown[] = [deskId];
  const add = (sql: string, value: unknown): void => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
  if (query.get("state")) add("h.state=?", query.get("state"));
  if (query.get("occasion")) add("h.occasion=?", query.get("occasion"));
  if (q) add("(h.id ILIKE ? OR h.name ILIKE $" + (values.length + 1) + " OR h.email ILIKE $" + (values.length + 1) + ")", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  const after = query.get("after");
  const before = query.get("before");
  const place = (cursor: string | null): [number, string] | null => (cursor && VALID_CURSOR.test(cursor) ? [Number(cursor.split("_")[0]), cursor.split("_")[1]] : null);
  const afterPlace = place(after);
  const beforePlace = place(before);
  const base = where.join(" AND ");
  const select = `SELECT h.* FROM hires h JOIN customers c ON c.id=h.customer_id WHERE ${base}`;
  let list: HireRow[];
  if (beforePlace) {
    list = await rows<HireRow>(pool, `${select} AND (h.created_at>$${values.length + 1} OR (h.created_at=$${values.length + 1} AND h.id<$${values.length + 2})) ORDER BY h.created_at ASC, h.id DESC LIMIT 26`, [...values, ...beforePlace]);
    const more = list.length > 25;
    list = list.slice(0, 25).reverse();
    return { list, prevCursor: more ? cursorOf(list[0]) : null, nextCursor: list.length ? cursorOf(list[list.length - 1]) : null };
  }
  if (afterPlace) {
    list = await rows<HireRow>(pool, `${select} AND (h.created_at<$${values.length + 1} OR (h.created_at=$${values.length + 1} AND h.id>$${values.length + 2})) ORDER BY h.created_at DESC, h.id ASC LIMIT 26`, [...values, ...afterPlace]);
    const more = list.length > 25;
    list = list.slice(0, 25);
    return { list, nextCursor: more ? cursorOf(list[24]) : null, prevCursor: list.length ? cursorOf(list[0]) : null };
  }
  list = await rows<HireRow>(pool, `${select} ORDER BY h.created_at DESC, h.id ASC LIMIT 26`, values);
  const more = list.length > 25;
  list = list.slice(0, 25);
  return { list, nextCursor: more ? cursorOf(list[24]) : null, prevCursor: null };
};

export const duplicatesOf = async (hire: HireRow): Promise<HireRow[]> => {
  const list = await rows<HireRow>(pool, "SELECT * FROM hires WHERE desk_id=$1 AND merged_into IS NULL AND id<>$2", [hire.desk_id, hire.id]);
  return list.filter((h) => sameContact(h, hire));
};
const sameContact = (a: HireRow, b: HireRow): boolean =>
  (foldEmail(a.email ?? "") !== "" && foldEmail(a.email ?? "") === foldEmail(b.email ?? "")) || (foldTelephone(a.telephone ?? "") !== "" && foldTelephone(a.telephone ?? "") === foldTelephone(b.telephone ?? ""));

const enquiryJson = async (hire: HireRow): Promise<Record<string, unknown>> => {
  const stops = await stopsOf(pool, hire.id);
  const merged = await rows<Pick<HireRow, "id">>(pool, "SELECT id FROM hires WHERE merged_into=$1 ORDER BY created_at, id", [hire.id]);
  return {
    ...enquiryRow(hire), journeyType: hire.journey_type, stops,
    returnAt: localJson(hire.return_date, hire.return_time, hire.return_repeated), returnInstant: instantText(hire.return_instant),
    party: hire.party, details: hire.details, email: hire.email, telephone: hire.telephone, language: hire.language, submittedBody: hire.submitted_body,
    mergedReferences: merged.map((m) => m.id), duplicates: (await duplicatesOf(hire)).map((d) => ({ id: d.id, reference: d.id })),
  };
};

const STATE_REFUSED = "That did not save. Try again.";

// ---- Trip plan.
const vehicleClass = (sizes: number[]): "coach" | "minibus" => (Math.max(...sizes) >= 31 ? "coach" : "minibus");
const legsFromProvider = async (hire: HireRow, stops: { text: string }[]): Promise<Leg[]> => {
  const reply = await routeLegs(vehicleClass(hire.plan_sizes ?? suggestPlan(hire.party)), stops.map((s) => s.text));
  if (!Array.isArray(reply?.legs)) throw new ProviderDown("route");
  return reply.legs.map((leg: Untrusted) => ({ km: String(leg.km), minutes: Number(leg.minutes), miles: milesFromKm(String(leg.km)) }));
};
const tripJson = async (hire: HireRow) => {
  const stops = await stopsOf(pool, hire.id);
  const suggested = suggestPlan(hire.party as Party);
  return {
    stops, legs: hire.legs ?? [], planOutOfDate: hire.plan_out_of_date,
    plan: { sizes: hire.plan_sizes, suggested, largerThanNeeded: hire.plan_sizes ? largerThanNeeded(hire.plan_sizes, suggested) : false },
  };
};
/** The first read of a trip with no legs makes one route call. */
export const tripOnRead = async (hire: HireRow) => {
  if (hire.legs === null) {
    try {
      const legs = await legsFromProvider(hire, await stopsOf(pool, hire.id));
      await pool.query("UPDATE hires SET legs=$2,plan_out_of_date=false WHERE id=$1 AND legs IS NULL", [hire.id, JSON.stringify(legs)]);
      hire.legs = legs;
      hire.plan_out_of_date = false;
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
      await pool.query("UPDATE hires SET legs='[]',plan_out_of_date=true WHERE id=$1", [hire.id]);
      hire.legs = [];
      hire.plan_out_of_date = true;
    }
  }
  return tripJson(hire);
};
const routeFailed = (): ApiError => unavailable("routeUnavailable", "Route not updated. Showing the last good route.");
const refreshRoute = async (hire: HireRow) => {
  try {
    const legs = await legsFromProvider(hire, await stopsOf(pool, hire.id));
    await pool.query("UPDATE hires SET legs=$2,plan_out_of_date=false WHERE id=$1", [hire.id, JSON.stringify(legs)]);
    return tripJson({ ...hire, legs, plan_out_of_date: false });
  } catch (error) {
    if (!(error instanceof ProviderDown)) throw error;
    await pool.query("UPDATE hires SET plan_out_of_date=true WHERE id=$1", [hire.id]);
    throw routeFailed();
  }
};

const loadHire = (ctx: Ctx): Promise<HireRow> => requireHire(pool, ctx.desk!.id, ctx.params.id);

export const enquiryRoutes: ApiRoute[] = [
  route({
    method: "GET", path: "/api/public/clock", access: "public",
    run: async () => {
      const now = nowSeconds();
      return ok({ date: ukDate(now), time: ukTime(now), instant: instantText(now) });
    },
  }),
  route({
    method: "GET", path: "/api/public/address/find", access: "public",
    run: async ({ query }) => {
      const q = searchText(query) ?? "";
      if (readerLengthUnderThree(q)) throw refused("Enter at least 3 characters.", "q");
      try {
        const reply = await addressFind(q);
        const suggestions = Array.isArray(reply?.suggestions) ? reply.suggestions : [];
        return ok({ suggestions: suggestions.slice(0, 6).map((s: Untrusted) => ({ id: s.id, text: s.text })) });
      } catch (error) {
        if (error instanceof ProviderDown) throw unavailable("addressUnavailable", ADDRESS_DOWN);
        throw error;
      }
    },
  }),
  route({
    method: "GET", path: "/api/public/address/get/:id", access: "public",
    run: async ({ params }) => {
      try {
        const a = await addressGet(params.id);
        const postcode = printedPostcode(String(a.postcode ?? ""));
        return ok({ id: params.id, line1: a.line1, town: a.town, postcode, text: `${a.line1}, ${a.town} ${postcode}` });
      } catch (error) {
        if (error instanceof ProviderMissing) throw notFound();
        if (error instanceof ProviderDown) throw unavailable("addressUnavailable", ADDRESS_DOWN);
        throw error;
      }
    },
  }),
  route({
    method: "POST", path: "/api/public/enquiries", access: "public", body: "json", rateLimit: publicRateLimit,
    run: async ({ json, text }) => {
      const now = nowSeconds();
      if (json.website) return ok({ reference: newReference(), receivedAt: instantText(now) }, 201);
      const fields = validateEnquiry(json, now);
      if (Object.keys(fields).length) throw fieldErrors(fields);
      const desk = await one<Pick<DeskRow, "id">>(pool, "SELECT id FROM desks WHERE email_folded=$1", [foldEmail(config.publicDeskEmail)]);
      if (!desk) throw notFound();
      const reference = await createEnquiry(desk.id, json, text, now);
      await pool.query("INSERT INTO enquiry_requests (email_folded,at) VALUES ($1,$2)", [foldEmail(json.email), now]);
      return ok({ reference, receivedAt: instantText(now) }, 201);
    },
  }),
  route({
    method: "POST", path: "/api/enquiries", body: "json",
    run: async ({ json, text, desk }) => {
      const now = nowSeconds();
      const fields = validateEnquiry(json, now);
      if (Object.keys(fields).length) throw fieldErrors(fields);
      return ok({ reference: await createEnquiry(desk!.id, json, text, now), receivedAt: instantText(now) }, 201);
    },
  }),
  route({
    method: "GET", path: "/api/enquiries",
    run: async ({ query, desk }) => {
      const { list, nextCursor, prevCursor } = await enquiriesPage(desk!.id, query);
      return ok({ enquiries: list.map(enquiryRow), nextCursor, prevCursor });
    },
  }),
  route({
    method: "POST", path: "/api/enquiries/merge", body: "json",
    run: async ({ json, desk }) => {
      const ids: unknown[] = Array.isArray(json.enquiryIds) ? json.enquiryIds : [];
      if (ids.length < 2) throw refused("Choose the enquiries to merge.", "enquiryIds");
      return transaction(async (tx) => {
        const hires = [];
        for (const id of ids) hires.push(await requireHire(tx, desk!.id, String(id), true));
        const unique = [...new Map(hires.map((h) => [h.id, h])).values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
        const [kept, ...later] = unique;
        if (!later.length || later.some((h) => !sameContact(h, kept))) throw conflict("notDuplicates", "These enquiries do not share an email or telephone.");
        for (const h of later) await tx.query("UPDATE hires SET merged_into=$2 WHERE id=$1", [h.id, kept.id]);
        return ok({ kept: kept.id, merged: later.map((h) => h.id) });
      });
    },
  }),
  route({ method: "GET", path: "/api/enquiries/:id", load: loadHire, run: async ({ loaded }) => ok(await enquiryJson(loaded)) }),
  route({
    method: "PATCH", path: "/api/enquiries/:id", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      if (!isEnquiryState(json.state)) throw refused("Choose a state.", "state");
      if (json.state === loaded.state) return ok(enquiryRow(loaded));
      if (!(await moveEnquiryState(pool, loaded.id, json.state))) throw conflict("illegalState", STATE_REFUSED);
      return ok(enquiryRow(await requireHire(pool, loaded.desk_id, loaded.id)));
    },
  }),
  route({ method: "GET", path: "/api/enquiries/:id/trip", load: loadHire, run: async ({ loaded }) => ok(await tripOnRead(loaded)) }),
  route({
    method: "PUT", path: "/api/enquiries/:id/trip/stops", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      const stops = await stopsOf(pool, loaded.id);
      const order: unknown[] = Array.isArray(json.order) ? json.order : [];
      if (order.length !== stops.length || stops.some((s) => !order.includes(s.id))) throw refused("Name every stop once.", "order");
      await transaction(async (tx) => {
        for (const [position, id] of order.entries()) await tx.query("UPDATE stops SET position=$2 WHERE id=$1", [id, position]);
      });
      return ok(await refreshRoute(loaded));
    },
  }),
  route({ method: "POST", path: "/api/enquiries/:id/trip/route", body: "json", load: loadHire, run: async ({ loaded }) => ok(await refreshRoute(loaded)) }),
  route({
    method: "PUT", path: "/api/enquiries/:id/trip/plan", body: "json", load: loadHire,
    run: async ({ json, loaded }) => {
      const sizes: number[] = Array.isArray(json.sizes) ? json.sizes : [];
      const refusal = planRefusal(sizes, loaded.party);
      if (refusal) throw refused(refusal, "sizes");
      await pool.query("UPDATE hires SET plan_sizes=$2 WHERE id=$1", [loaded.id, sizes]);
      return ok(await tripJson({ ...loaded, plan_sizes: sizes }));
    },
  }),
];

const readerLengthUnderThree = (q: string): boolean => readerLength(q.trim()) < 3;
const printedPostcode = (postcode: string): string => {
  const flat = postcode.replace(/\s+/g, "").toUpperCase();
  return flat.length > 3 ? `${flat.slice(0, -3)} ${flat.slice(-3)}` : flat;
};
