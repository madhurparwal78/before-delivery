import type { CitiesReply } from "../../shared/api";
import { CITIES, DISTANCES, isCity, type City } from "../../shared/towns";
import { now } from "../clock";
import { newId } from "../db";
import { priceRange } from "../domain/pricing";
import { shapeRoute } from "../domain/route";
import { apiErrors } from "../http/errors";
import { route, SESSION_COOKIE, type Route } from "../http/pipeline";
import { EMAIL_PATTERN, createMember, createSession, endSession, issueCode, memberByEmail, normaliseEmail, spendCode, takeCodeSlot } from "../services/auth";
import { getMemberRow, memberView, serverNow } from "../services/views";
import { bodyOf, memberOf, requireRole, stopsFromQuery } from "./support";
import { isInt } from "../http/guards";

const SESSION_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";

interface CodeRequest {
  email: string | null;
  codeId: string;
}

export const accountRoutes: Route[] = [
  route<CodeRequest>({
    method: "POST",
    pattern: "/api/auth/code",
    auth: "public",
    load: async (ctx) => {
      const raw = bodyOf(ctx).email;
      const email = typeof raw === "string" && raw.length <= 254 && EMAIL_PATTERN.test(raw.trim()) ? normaliseEmail(raw) : null;
      return { email, codeId: newId() };
    },
    limit: async (_ctx, request) => {
      if (request.email) await takeCodeSlot(request.email, request.codeId);
    },
    validate: async (_ctx, request) => {
      if (!request.email) throw apiErrors.validation({ email: "Enter a valid email address." });
    },
    run: async (ctx, request) => {
      await issueCode(ctx.db, request.email as string, request.codeId);
      return { status: 202, body: { sent: true } };
    },
  }),

  route({
    method: "POST",
    pattern: "/api/auth/verify",
    auth: "public",
    validate: async (ctx) => {
      const { email, code, display_name: name } = bodyOf(ctx);
      const problems: Record<string, string> = {};
      const clean = typeof email === "string" && EMAIL_PATTERN.test(email.trim()) ? normaliseEmail(email) : null;
      if (!clean) problems.email = "Enter a valid email address.";
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) problems.code = "Enter the six-digit code.";
      if (clean && !(await memberByEmail(ctx.db, clean))) {
        if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 60) problems.display_name = "Enter a display name of 1 to 60 characters.";
      }
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
    },
    run: async (ctx) => {
      const { email, code, display_name: name } = bodyOf(ctx) as { email: string; code: string; display_name?: string };
      const clean = normaliseEmail(email);
      await spendCode(ctx.db, clean, code);
      const member = (await memberByEmail(ctx.db, clean)) ?? (await createMember(ctx.db, clean, (name as string).trim()));
      const token = await createSession(ctx.db, member.id);
      return { status: 200, body: await memberView(ctx.db, member, true), headers: { "set-cookie": `${SESSION_COOKIE}=${token}; ${SESSION_ATTRIBUTES}` } };
    },
  }),

  route({
    method: "POST",
    pattern: "/api/auth/sign-out",
    run: async (ctx) => {
      if (ctx.sessionToken) await endSession(ctx.db, ctx.sessionToken);
      return { status: 204, headers: { "set-cookie": `${SESSION_COOKIE}=; ${SESSION_ATTRIBUTES}; Max-Age=0` } };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/me",
    run: async (ctx) => ({ status: 200, body: await memberView(ctx.db, memberOf(ctx), true) }),
  }),

  route({
    method: "GET",
    pattern: "/api/members/:id",
    load: async (ctx) => {
      const row = await getMemberRow(ctx.db, ctx.params.id as string);
      if (!row) throw apiErrors.notFound();
      return row;
    },
    run: async (ctx, row) => ({ status: 200, body: await memberView(ctx.db, row) }),
  }),

  route({
    method: "GET",
    pattern: "/api/cities",
    auth: "public",
    run: async () => {
      const body: CitiesReply = { cities: [...CITIES], distances: DISTANCES.map((d) => ({ ...d })), server_now: serverNow() };
      return { status: 200, body };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/price-range",
    auth: "public",
    validate: async (ctx) => {
      const stops = stopsFromQuery(ctx.url.searchParams.get("stops"));
      if (stops.length < 2 || !stops.every(isCity) || new Set(stops).size !== stops.length) {
        throw apiErrors.validation({ stops: "Choose at least two different towns." });
      }
    },
    run: async (ctx) => {
      const shape = shapeRoute(stopsFromQuery(ctx.url.searchParams.get("stops")) as City[], now());
      const range = priceRange(shape.routeKm);
      return { status: 200, body: { route_km: shape.routeKm, low_cents: range.lowCents, high_cents: range.highCents, server_now: serverNow() } };
    },
  }),

  route({
    method: "GET",
    pattern: "/api/vehicles",
    role: (ctx) => requireRole(memberOf(ctx), "driver"),
    run: async (ctx) => {
      const { rows } = await ctx.db.query("SELECT id, make_model, colour, seats FROM vehicles WHERE owner_id = $1 ORDER BY created_at, id", [memberOf(ctx).id]);
      return { status: 200, body: { vehicles: rows } };
    },
  }),

  route({
    method: "POST",
    pattern: "/api/vehicles",
    role: (ctx) => requireRole(memberOf(ctx), "driver"),
    validate: async (ctx) => {
      const { make_model: makeModel, colour, seats } = bodyOf(ctx);
      const problems: Record<string, string> = {};
      if (typeof makeModel !== "string" || makeModel.trim().length < 1 || makeModel.trim().length > 60) problems.make_model = "Enter the make and model, up to 60 characters.";
      if (typeof colour !== "string" || colour.trim().length < 1 || colour.trim().length > 30) problems.colour = "Enter the colour, up to 30 characters.";
      if (!isInt(seats) || seats < 1 || seats > 4) problems.seats = "Seats must be from 1 to 4.";
      if (Object.keys(problems).length) throw apiErrors.validation(problems);
    },
    run: async (ctx) => {
      const { make_model: makeModel, colour, seats } = bodyOf(ctx) as { make_model: string; colour: string; seats: number };
      const id = newId();
      await ctx.db.query("INSERT INTO vehicles (id, owner_id, make_model, colour, seats, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [id, memberOf(ctx).id, makeModel.trim(), colour.trim(), seats, now()]);
      return { status: 201, body: { id, make_model: makeModel.trim(), colour: colour.trim(), seats } };
    },
  }),
];

