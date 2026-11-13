import type { Router, Request } from "express";
import type { AppContext } from "./route-context.js";
import { ApiError, sendError } from "./errors.js";
import { createSession, endSession, requireSession, setSessionCookie, clearSessionCookie, readSessionCookie, endSessionsFor } from "./session.js";
import { HOME_ROUTES } from "../shared/constants.js";
import { copy, FIELD_ERRORS } from "../shared/copy.js";
import { publicPlans } from "../shared/plans.js";
import { CATEGORIES, MARKERS } from "../shared/markers.js";
import { SERVED_STATES, NOT_SERVED, stateName, isServed } from "../shared/states.js";
import { hashPassword, newId, verifyPassword } from "./crypto.js";
import type { Person } from "./person.js";
import { instantZ } from "../shared/time.js";
import { DateTime } from "luxon";
import type { Sex, TimeZoneKey } from "../shared/enums.js";
import { membershipFor } from "./memberships.js";
import { param, query } from "./request-utils.js";

export function registerPublicRoutes(router: Router, ctx: AppContext): void {
  router.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/api/plans", (_req, res) => {
    res.json({ plans: publicPlans() });
  });

  router.get("/api/states", (_req, res) => {
    const states = Object.entries(SERVED_STATES).map(([state, name]) => ({
      state,
      name,
      served: isServed(state),
    }));
    res.json({ states });
  });

  router.get("/api/states/:code", (req, res) => {
    const code = (param(req, "code")).toLowerCase();
    const name = SERVED_STATES[code];
    if (!name) {
      sendError(res, new ApiError(404, "not_found", copy("not_found")));
      return;
    }
    const served = !NOT_SERVED.has(code);
    res.json({
      state: code,
      name,
      served,
      message: copy(served ? "state_served" : "state_not_served", { "State name": name }),
    });
  });

  router.get("/api/markers", (req, res) => {
    const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
    const query = q.trim().toLowerCase();
    const categories = CATEGORIES.map((category) => ({
      id: category.id,
      name: category.name,
      markers: MARKERS.filter(
        (m) =>
          m.categoryId === category.id &&
          (query.length === 0 ||
            m.name.toLowerCase().includes(query) ||
            m.aliases.some((a) => a.toLowerCase().includes(query)))
      ).map((m) => ({ id: m.id, name: m.name, unit: m.unit, decimals: m.decimals })),
    })).filter((category) => category.markers.length > 0);
    res.json({ categories });
  });

  router.post("/api/session", async (req, res) => {
    try {
      const body = req.body as { email?: unknown; password?: unknown };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const staff = await ctx.db.one<{
        id: string;
        name: string;
        role: string;
        password_hash: string;
        removed_at: Date | null;
      }>(`SELECT id, name, role, password_hash, removed_at FROM staff WHERE lower(email) = $1`, [email]);
      if (staff && !staff.removed_at) {
        const ok = await verifyPassword(password, staff.password_hash);
        if (ok) {
          const person: Person = { kind: "staff", id: staff.id, name: staff.name, role: staff.role as Person["role"] };
          const sessionId = await createSession(ctx.db, person, ctx.config.timers.sessionSeconds);
          setSessionCookie(res, sessionId);
          res.json({ user: { id: staff.id, name: staff.name, role: staff.role }, home: HOME_ROUTES[person.role] });
          return;
        }
      }
      const member = await ctx.db.one<{
        id: string;
        name: string;
        password_hash: string;
        account_state: string;
      }>(`SELECT id, name, password_hash, account_state FROM members WHERE lower(email) = $1`, [email]);
      if (member && member.account_state !== "erased") {
        const ok = await verifyPassword(password, member.password_hash);
        if (ok) {
          const person: Person = { kind: "member", id: member.id, name: member.name, role: "member" };
          const sessionId = await createSession(ctx.db, person, ctx.config.timers.sessionSeconds);
          setSessionCookie(res, sessionId);
          res.json({ user: { id: member.id, name: member.name, role: "member" }, home: HOME_ROUTES.member });
          return;
        }
      }
      throw new ApiError(401, "sign_in_failed", copy("sign_in_failed"));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/api/session", async (req, res) => {
    try {
      const person = await requireSession(ctx.db, req, ctx.config.timers.sessionSeconds);
      const row = await ctx.db.one<{ expires_at: Date }>(
        `SELECT expires_at FROM sessions WHERE id = $1`,
        [readSessionCookie(req)]
      );
      res.json({
        user: { id: person.id, name: person.name, role: person.role },
        home: HOME_ROUTES[person.role],
        expiresAt: row ? instantZ(row.expires_at) : null,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/api/session", async (req, res) => {
    try {
      await requireSession(ctx.db, req, ctx.config.timers.sessionSeconds);
      const token = readSessionCookie(req);
      if (token) await endSession(ctx.db, token);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/accounts", async (req, res) => {
    try {
      const fields = await validateAccountBody(req);
      if (fields) {
        sendError(res, new ApiError(422, "invalid", "Check the highlighted fields.", fields));
        return;
      }
      const body = req.body as {
        name: string;
        email: string;
        password: string;
        dateOfBirth: string;
        sex: Sex;
        state: string;
        timeZone: TimeZoneKey;
      };
      const existing = await ctx.db.one<{ id: string }>(`SELECT id FROM members WHERE lower(email) = $1`, [
        body.email.trim().toLowerCase(),
      ]);
      if (existing) {
        sendError(res, new ApiError(409, "email_taken", copy("email_taken")));
        return;
      }
      const id = newId("mem");
      const passwordHash = await hashPassword(body.password);
      await ctx.db.exec(
        `INSERT INTO members (id, name, email, password_hash, date_of_birth, sex, state, time_zone, account_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
        [
          id,
          body.name.trim(),
          body.email.trim().toLowerCase(),
          passwordHash,
          body.dateOfBirth,
          body.sex,
          body.state,
          body.timeZone,
        ]
      );
      await ctx.db.exec(`INSERT INTO memberships (member_id, state) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, [id]);
      const person: Person = { kind: "member", id, name: body.name.trim(), role: "member" };
      const sessionId = await createSession(ctx.db, person, ctx.config.timers.sessionSeconds);
      setSessionCookie(res, sessionId);
      const memberView = await memberSelfView(ctx, id);
      res.status(201).json({ member: memberView });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/me/password", async (req, res) => {
    try {
      const person = await requireSession(ctx.db, req, ctx.config.timers.sessionSeconds);
      const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
      const fields: Record<string, string> = {};
      const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const next = typeof body.newPassword === "string" ? body.newPassword : "";
      if (next.length < 12) fields["newPassword"] = FIELD_ERRORS.passwordShort;
      if (person.kind === "staff") {
        const row = await ctx.db.one<{ password_hash: string }>(`SELECT password_hash FROM staff WHERE id = $1`, [person.id]);
        if (!row || !(await verifyPassword(current, row.password_hash))) {
          fields["currentPassword"] = FIELD_ERRORS.currentPassword;
        }
      } else {
        const row = await ctx.db.one<{ password_hash: string }>(`SELECT password_hash FROM members WHERE id = $1`, [person.id]);
        if (!row || !(await verifyPassword(current, row.password_hash))) {
          fields["currentPassword"] = FIELD_ERRORS.currentPassword;
        }
      }
      if (Object.keys(fields).length > 0) {
        sendError(res, new ApiError(422, "invalid", "Check the highlighted fields.", fields));
        return;
      }
      const hash = await hashPassword(next);
      const token = readSessionCookie(req);
      if (person.kind === "staff") {
        await ctx.db.exec(`UPDATE staff SET password_hash = $1 WHERE id = $2`, [hash, person.id]);
        await endSessionsFor(ctx.db, "staff", person.id, token ?? undefined);
      } else {
        await ctx.db.exec(`UPDATE members SET password_hash = $1 WHERE id = $2`, [hash, person.id]);
        await endSessionsFor(ctx.db, "member", person.id, token ?? undefined);
      }
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });
}

async function validateAccountBody(req: Request): Promise<Record<string, string> | null> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
  const password = typeof body["password"] === "string" ? body["password"] : "";
  const dateOfBirth = typeof body["dateOfBirth"] === "string" ? body["dateOfBirth"] : "";
  const sex = typeof body["sex"] === "string" ? body["sex"] : "";
  const state = typeof body["state"] === "string" ? body["state"].toLowerCase() : "";
  const timeZone = typeof body["timeZone"] === "string" ? body["timeZone"] : "";
  if (name.length === 0) fields["name"] = FIELD_ERRORS.name;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields["email"] = FIELD_ERRORS.email;
  if (password.length < 12) fields["password"] = FIELD_ERRORS.passwordShort;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    fields["dateOfBirth"] = FIELD_ERRORS.dateOfBirthFormat;
  } else {
    const today = DateTime.now().setZone("America/Phoenix").toFormat("yyyy-MM-dd");
    const age = DateTime.fromISO(today).diff(DateTime.fromISO(dateOfBirth), "years").years;
    if (age < 18) fields["dateOfBirth"] = FIELD_ERRORS.dateOfBirth;
  }
  if (!(state in SERVED_STATES)) fields["state"] = renderStateCopy(state);
  else if (!isServed(state)) fields["state"] = renderStateCopy(state);
  if (sex !== "female" && sex !== "male") fields["sex"] = FIELD_ERRORS.chooseOption;
  if (!["newYork", "chicago", "denver", "phoenix", "losAngeles"].includes(timeZone)) {
    fields["timeZone"] = FIELD_ERRORS.chooseOption;
  }
  if (Object.keys(fields).length > 0) return fields;
  return null;
}

function renderStateCopy(state: string): string {
  const name = stateName(state);
  return copy("state_not_served", { "State name": name });
}

export async function memberSelfView(ctx: AppContext, memberId: string) {
  const member = await ctx.db.one<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    date_of_birth: string | null;
    sex: string | null;
    state: string | null;
    time_zone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    postal_code: string | null;
    gate_notes: string | null;
    account_state: string;
    erases_at: Date | null;
  }>(
    `SELECT id, name, email, phone, date_of_birth::text AS date_of_birth, sex, state, time_zone,
      address_line1, address_line2, city, postal_code, gate_notes, account_state, erases_at
     FROM members WHERE id = $1`,
    [memberId]
  );
  if (!member) throw new ApiError(404, "not_found", copy("not_found"));
  const membership = await membershipFor(ctx.db, memberId);
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    dateOfBirth: member.date_of_birth,
    sex: member.sex,
    state: member.state,
    timeZone: member.time_zone,
    address:
      member.address_line1 || member.city || member.postal_code
        ? {
            line1: member.address_line1 ?? "",
            line2: member.address_line2 ?? "",
            city: member.city ?? "",
            postalCode: member.postal_code ?? "",
          }
        : null,
    gateNotes: member.gate_notes,
    accountState: member.account_state,
    erasesAt: member.erases_at ? instantZ(member.erases_at) : null,
    membership: membership
      ? {
          state: membership.state,
          cadence: membership.cadence,
          renewalDate: membership.renewal_date,
          plusUntil: membership.plus_until,
          pendingCadence: membership.pending_cadence,
          pendingFrom: membership.pending_from,
        }
      : { state: "free", cadence: null, renewalDate: null, plusUntil: null, pendingCadence: null, pendingFrom: null },
  };
}
