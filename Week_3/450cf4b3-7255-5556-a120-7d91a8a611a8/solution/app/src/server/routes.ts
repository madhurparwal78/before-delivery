// The complete route list and the role table (brief: API, Role table). "own" routes reach a
// tenant only for their own records; the pipeline answers 404 for anyone else's.

import { PACK_HOURS, type PackHours } from "../shared/api.js";
import { isSpan, parseClock } from "../shared/clock.js";
import { CLEARED_COOKIE, confirmPassword, endSession, sessionCookie, signIn } from "./auth.js";
import { bookingOwner, cancel, checkIn, checkOut, claim, confirmHold, countClaim, dailyReport, doorList, floor, getBooking, listBookings, move, noShow, validateShape, type Span } from "./bookings.js";
import { db } from "./db.js";
import { documentFile, documentOwner, getDocument, listDocuments, upload, uploadFields, validateUpload } from "./documents.js";
import { date, FILL_IN, isUuid, text } from "./fields.js";
import { kitchen, kitchenTime } from "./kitchen.js";
import { deliverSoon } from "./mail.js";
import { listPacks, packDetail, packOwner, purchase, refund } from "./packs.js";
import { nothing, route, type RoleTable, type Route, type SignedIn } from "./pipeline.js";
import { apply, approve, listTenants, me, tenantDetail, tenantExists } from "./tenants.js";

const EVERY_ROLE: RoleTable = { owner: "yes", shift_lead: "yes", tenant: "yes" };
const STAFF_OR_OWN: RoleTable = { owner: "yes", shift_lead: "yes", tenant: "own" };
const STAFF: RoleTable = { owner: "yes", shift_lead: "yes", tenant: "no" };
const OWNER_OR_OWN: RoleTable = { owner: "yes", shift_lead: "no", tenant: "own" };
const OWNER: RoleTable = { owner: "yes", shift_lead: "no", tenant: "no" };

/** U+0000–U+001F and U+007F–U+009F, refused in application names. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

const ok = (json: unknown, status = 200) => ({ status, json });

const ofBooking = (ctx: SignedIn) => (isUuid(ctx.params.id) ? bookingOwner(ctx.params.id) : Promise.resolve(null));
const ofPack = (ctx: SignedIn) => (isUuid(ctx.params.id) ? packOwner(ctx.params.id) : Promise.resolve(null));
const ofDocument = (ctx: SignedIn) => (isUuid(ctx.params.id) ? documentOwner(ctx.params.id) : Promise.resolve(null));

async function ofTenant(id: string | null): Promise<string | null> {
  return isUuid(id) && (await tenantExists(id)) ? id : null;
}

export const routes: readonly Route[] = [
  route({
    method: "GET", path: "/api/health", access: "open",
    validate: nothing, handle: async () => ok({ status: "ok" }),
  }),

  route({
    method: "POST", path: "/api/session", access: "open", body: { kind: "json", fields: ["email", "password"] },
    validate: (ctx, errors) => ({
      email: text(ctx.json, "email", errors, { min: 1, max: 320 }),
      password: text(ctx.json, "password", errors, { min: 1, max: 65_536 }),
    }),
    handle: async (_ctx, input) => {
      const { caller, token } = await signIn(input.email, input.password);
      return { status: 200, json: { user: await me(caller) }, headers: { "Set-Cookie": sessionCookie(token) } };
    },
  }),

  route({
    method: "DELETE", path: "/api/session", access: EVERY_ROLE,
    validate: nothing, handle: async (ctx) => {
      if (ctx.token) await endSession(ctx.token);
      return { status: 204, headers: { "Set-Cookie": CLEARED_COOKIE } };
    },
  }),

  route({
    method: "POST", path: "/api/session/confirm", access: EVERY_ROLE, body: { kind: "json", fields: ["password"] },
    validate: (ctx, errors) => text(ctx.json, "password", errors, { min: 1, max: 65_536 }),
    handle: async (ctx, password) => {
      if (ctx.token) await confirmPassword(ctx.caller, ctx.token, password);
      return { status: 204 };
    },
  }),

  route({ method: "GET", path: "/api/me", access: EVERY_ROLE, validate: nothing, handle: async (ctx) => ok(await me(ctx.caller)) }),

  route({
    method: "POST", path: "/api/tenants/apply", access: "open",
    body: { kind: "json", fields: ["businessName", "contactName", "email", "password"] },
    validate: (ctx, errors) => {
      const email = text(ctx.json, "email", errors, { min: 3, max: 254 }).trim();
      if (!errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
      const name = (field: "businessName" | "contactName"): string => {
        const value = text(ctx.json, field, errors, { min: 1, max: 80 });
        if (!errors[field] && CONTROL_CHARACTER.test(value)) errors[field] = "Use letters, numbers and punctuation only.";
        return value.trim();
      };
      return {
        businessName: name("businessName"),
        contactName: name("contactName"),
        email,
        password: text(ctx.json, "password", errors, { min: 10, max: 200, tooShort: "Use at least 10 characters." }),
      };
    },
    handle: async (_ctx, input) => {
      const { token, caller } = await apply(input);
      return { status: 201, json: { user: await me(caller) }, headers: { "Set-Cookie": sessionCookie(token) } };
    },
  }),

  route({ method: "GET", path: "/api/kitchen", access: "open", validate: nothing, handle: async () => ok(kitchen(await kitchenTime(db))) }),

  route({
    method: "GET", path: "/api/floor", access: EVERY_ROLE,
    validate: (ctx, errors) => {
      const day = date(ctx.query.get("date"), "date", errors);
      const fromText = ctx.query.get("from");
      const toText = ctx.query.get("to");
      if (fromText === null && toText === null) return { day, span: null };
      const from = fromText === null ? null : parseClock(fromText);
      const to = toText === null ? null : parseClock(toText);
      if (from === null) errors.from = "Give the span start as HH:MM on the half hour.";
      if (to === null) errors.to = "Give the span end as HH:MM on the half hour.";
      if (from !== null && to !== null && !isSpan(from, to)) {
        errors.to = "The span must sit inside 05:00–23:00 on half-hour marks and start before it ends.";
      }
      const span: Span | null = from !== null && to !== null ? { from, to } : null;
      return { day, span };
    },
    handle: async (ctx, input) => ok(await floor(ctx.caller, input.day, input.span)),
  }),

  route({
    method: "GET", path: "/api/bookings", access: EVERY_ROLE,
    validate: (ctx, errors) => {
      const raw = ctx.query.get("date");
      return raw === null && ctx.caller?.role === "tenant" ? null : date(raw, "date", errors);
    },
    handle: async (ctx, day) => ok({ bookings: await listBookings(ctx.caller, day) }),
  }),

  route({
    method: "GET", path: "/api/bookings/:id", access: STAFF_OR_OWN, owner: ofBooking,
    validate: nothing, handle: async (ctx) => ok(await getBooking(ctx.caller, ctx.params.id)),
  }),

  route({
    method: "POST", path: "/api/bookings", access: "keyed",
    body: { kind: "json", fields: ["stationId", "start", "end", "shelfId"], nullIsAbsent: ["shelfId"] },
    admit: countClaim,
    validate: (ctx, errors) => validateShape(ctx.json, errors),
    handle: async (ctx, input) => ok(await claim(ctx.caller, input), 201),
  }),

  route({
    method: "POST", path: "/api/bookings/:id/move", access: "keyed", owner: ofBooking,
    body: { kind: "json", fields: ["stationId", "start", "end", "shelfId"], nullIsAbsent: ["shelfId"] },
    validate: (ctx, errors) => validateShape(ctx.json, errors, ctx.params.id),
    handle: async (ctx, input) => {
      const booking = await move(ctx.caller, ctx.params.id, input);
      deliverSoon();
      return ok(booking);
    },
  }),

  route({
    method: "POST", path: "/api/bookings/:id/confirm", access: "tenant", owner: ofBooking,
    validate: nothing, handle: async (ctx) => {
      const booking = await confirmHold(ctx.caller, ctx.params.id);
      deliverSoon();
      return ok(booking);
    },
  }),

  route({
    method: "POST", path: "/api/bookings/:id/cancel", access: "tenant", owner: ofBooking,
    validate: nothing, handle: async (ctx) => ok(await cancel(ctx.caller, ctx.params.id)),
  }),

  route({
    method: "POST", path: "/api/bookings/:id/check-in", access: STAFF, owner: ofBooking,
    validate: nothing, handle: async (ctx) => ok(await checkIn(ctx.caller, ctx.params.id)),
  }),

  route({
    method: "POST", path: "/api/bookings/:id/check-out", access: STAFF, owner: ofBooking,
    body: { kind: "json", fields: ["cleanupDone", "note"] },
    validate: (ctx, errors) => {
      if (ctx.json.cleanupDone !== true) errors.cleanupDone = "Confirm the station was cleaned and sanitised.";
      const note = ctx.json.note ?? "";
      if (typeof note !== "string") errors.note = "Write the note as text.";
      else if (note.length > 500) errors.note = "Keep the note to 500 characters.";
      return typeof note === "string" && note !== "" ? note : null;
    },
    handle: async (ctx, note) => ok(await checkOut(ctx.caller, ctx.params.id, note)),
  }),

  route({
    method: "POST", path: "/api/bookings/:id/no-show", access: STAFF, owner: ofBooking,
    validate: nothing, handle: async (ctx) => ok(await noShow(ctx.caller, ctx.params.id)),
  }),

  route({
    method: "GET", path: "/api/door", access: STAFF, refuseForeignOrigin: true,
    validate: (ctx, errors) => {
      const raw = ctx.query.get("date");
      return raw === null ? null : date(raw, "date", errors);
    },
    handle: async (_ctx, day) => ok(await doorList(day)),
  }),

  route({
    method: "GET", path: "/api/packs", access: "tenant",
    validate: nothing, handle: async (ctx) => ok({ packs: await listPacks(db, ctx.caller.tenantId) }),
  }),

  route({
    method: "POST", path: "/api/packs", access: "keyed", body: { kind: "json", fields: ["hours"] },
    stepUp: (ctx) => ctx.json.hours === 20 || ctx.json.hours === 40,
    validate: (ctx, errors): PackHours => {
      const hours = PACK_HOURS.find((h) => h === ctx.json.hours);
      if (hours === undefined) errors.hours = ctx.json.hours === undefined ? FILL_IN : "Choose 10, 20 or 40 hours.";
      return hours ?? 10;
    },
    handle: async (ctx, hours, key, print) => {
      const pack = await purchase(key, print, ctx.caller.tenantId, hours);
      deliverSoon();
      return ok(pack, 201);
    },
  }),

  route({
    method: "GET", path: "/api/packs/:id", access: OWNER_OR_OWN, owner: ofPack,
    validate: nothing, handle: async (ctx) => ok(await packDetail(db, ctx.params.id)),
  }),

  route({
    method: "POST", path: "/api/packs/:id/refund", access: OWNER, owner: ofPack, stepUp: () => true,
    body: { kind: "json", fields: ["expectedCents"] },
    validate: (ctx, errors) => {
      const expected = ctx.json.expectedCents;
      if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 0) errors.expectedCents = "Give the refundable amount in whole cents.";
      return typeof expected === "number" ? expected : 0;
    },
    handle: async (ctx, expectedCents) => ok(await refund(ctx.params.id, expectedCents)),
  }),

  route({
    method: "POST", path: "/api/documents", access: "tenant", body: { kind: "multipart", fields: uploadFields },
    validate: (ctx, errors) => validateUpload(ctx.parts, errors),
    handle: async (ctx, input) => ok(await upload(ctx.caller.tenantId, input), 201),
  }),

  route({
    method: "GET", path: "/api/documents", access: OWNER_OR_OWN,
    owner: async (ctx) => (ctx.query.has("tenantId") ? ofTenant(ctx.query.get("tenantId")) : undefined),
    validate: (ctx, errors) => {
      const named = ctx.query.get("tenantId");
      if (named === null && ctx.caller?.role !== "tenant") errors.tenantId = FILL_IN;
      return named ?? ctx.caller?.tenantId ?? "";
    },
    handle: async (_ctx, tenantId) => ok({ documents: await listDocuments(tenantId) }),
  }),

  route({
    method: "GET", path: "/api/documents/:id", access: OWNER_OR_OWN, owner: ofDocument,
    validate: nothing, handle: async (ctx) => ok(await getDocument(ctx.params.id)),
  }),

  route({
    method: "GET", path: "/api/documents/:id/file", access: OWNER_OR_OWN, owner: ofDocument,
    validate: nothing, handle: async (ctx) => {
      const file = await documentFile(ctx.params.id);
      return { status: 200, bytes: file.bytes, headers: file.headers };
    },
  }),

  route({ method: "GET", path: "/api/tenants", access: OWNER, validate: nothing, handle: async () => ok({ tenants: await listTenants() }) }),

  route({
    method: "GET", path: "/api/tenants/:id", access: OWNER, owner: (ctx) => ofTenant(ctx.params.id),
    validate: nothing, handle: async (ctx) => {
      const documents = await listDocuments(ctx.params.id);
      const packs = await Promise.all((await listPacks(db, ctx.params.id)).map((pack) => packDetail(db, pack.id)));
      return ok(await tenantDetail(ctx.params.id, packs, documents));
    },
  }),

  route({
    method: "POST", path: "/api/tenants/:id/approve", access: OWNER, owner: (ctx) => ofTenant(ctx.params.id),
    validate: nothing, handle: async (ctx) => ok(await approve(ctx.params.id)),
  }),

  route({
    method: "GET", path: "/api/reports/daily", access: OWNER, refuseForeignOrigin: true,
    validate: (ctx, errors) => date(ctx.query.get("date"), "date", errors),
    handle: async (_ctx, day) => ok(await dailyReport(day)),
  }),
];
