import { Router } from "express";
import type { Config } from "./config.js";
import { query } from "./db.js";
import {
  accountFromRequest, createSession, destroySession, hashPassword, requireAccount, setSessionCookie, clearSessionCookie, validEmail,
} from "./auth.js";
import { conflict, unauthenticated, validation } from "./errors.js";
import { newId } from "./ids.js";
import { fetchReservation, reservationWithDocs } from "./reservations.js";
import { venueDate, depositsOpen, nowIso } from "./time.js";
import type { ReservationState } from "./domain.js";

export function makeAuthRouter(cfg: Config): Router {
  const router = Router();

  // POST /api/auth/signup
  router.post("/auth/signup", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const name = body.name;
      const email = body.email;
      const password = body.password;
      const kind = body.kind;
      const clinicName = body.clinic_name;
      const errors: Record<string, string> = {};
      if (typeof name !== "string" || name.length < 1 || name.length > 120) errors.name = "Enter a name of 1 to 120 characters.";
      if (!validEmail(email)) errors.email = "Enter a valid email address.";
      if (typeof password !== "string" || password.length < 10 || password.length > 128) errors.password = "Choose a password of 10 to 128 characters.";
      if (kind !== "practitioner" && kind !== "clinic") errors.kind = "Choose practitioner or clinic.";
      if (kind === "clinic" && (typeof clinicName !== "string" || clinicName.length < 1 || clinicName.length > 120)) {
        errors.clinic_name = "Enter a clinic name of 1 to 120 characters.";
      }
      if (Object.keys(errors).length > 0) {
        res.status(422).json({ error: "validation", message: "Some fields need attention.", errors });
        return;
      }
      const normalizedEmail = String(email).toLowerCase();
      const { rows: existing } = await query("SELECT id FROM accounts WHERE email = $1", [normalizedEmail]);
      if (existing.length > 0) {
        res.status(409).json({ error: "email_taken", message: "That email already has an account." });
        return;
      }
      const id = newId("acc");
      const { rowCount } = await query(
        `INSERT INTO accounts (id, name, email, password_hash, role, clinic_name) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING`,
        [id, name, normalizedEmail, hashPassword(password), kind, kind === "clinic" ? clinicName : null]
      );
      if (!rowCount) {
        res.status(409).json({ error: "email_taken", message: "That email already has an account." });
        return;
      }
      const token = await createSession(id);
      setSessionCookie(res, token);
      res.status(201).json({ account: { id, name, email: normalizedEmail, role: kind } });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/auth/signin
  router.post("/auth/signin", async (req, res, next) => {
    try {
      const email = req.body?.email;
      const password = req.body?.password;
      if (typeof email !== "string" || typeof password !== "string") {
        res.status(422).json({
          error: "validation",
          message: "Some fields need attention.",
          errors: { email: typeof email === "string" ? "Enter your password." : "Enter your email.", password: "Enter your password." },
        });
        return;
      }
      const { rows } = await query<{ id: string; name: string; email: string; role: string; password_hash: string }>(
        "SELECT id, name, email, role, password_hash FROM accounts WHERE email = $1",
        [email.toLowerCase()]
      );
      const account = rows[0];
      const ok = account && hashMatches(password, account.password_hash);
      if (!ok) {
        res.status(401).json({ error: "invalid_credentials", message: "Email or password is incorrect." });
        return;
      }
      const token = await createSession(account.id);
      setSessionCookie(res, token);
      res.json({ account: { id: account.id, name: account.name, email: account.email, role: account.role } });
    } catch (e) {
      next(e);
    }
  });

  // POST /api/auth/signout
  router.post("/auth/signout", async (req, res, next) => {
    try {
      await destroySession(req);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // GET /api/me
  router.get("/me", async (req, res, next) => {
    try {
      const account = await accountFromRequest(req);
      if (!account) throw unauthenticated();
      const venue = venueDate(cfg.benchDaysNow);
      const reservations: Record<string, unknown>[] = [];
      const groups: Record<string, unknown>[] = [];
      const { rows: mine } = await query<import("./reservations.js").ReservationRow>(
        `SELECT r.*, a.name AS buyer_name, a.role AS buyer_kind, r.licence_state AS licence_state_name
         FROM reservations r JOIN accounts a ON a.id = r.buyer_id
         WHERE (r.buyer_id = $1 OR (r.attendee_email = $2 AND r.attendee_accepted = true))
           AND r.state <> 'released'
         ORDER BY r.bench`,
        [account.id, account.email]
      );
      for (const r of mine) {
        reservations.push(await reservationWithDocs(r));
        if (r.group_id && r.buyer_id === account.id && !groups.some((g) => g.id === r.group_id)) {
          const { rows: grp } = await query<{ state: string }>("SELECT state FROM groups WHERE id = $1", [r.group_id]);
          groups.push({ id: r.group_id, state: grp[0]?.state ?? "held" });
        }
      }
      const { rows: wl } = await query<{ tier: string }>(
        "SELECT tier FROM waitlist WHERE account_id = $1 AND state = 'waitlisted'",
        [account.id]
      );
      let waitlist: { tier: string; position: number } | null = null;
      if (wl[0]) {
        const { rows: pos } = await query<{ count: number }>(
          `SELECT count(*)::int AS count FROM waitlist WHERE tier = $1 AND state = 'waitlisted' AND created_at <= $2`,
          [wl[0].tier, (await query<{ created_at: Date }>("SELECT created_at FROM waitlist WHERE account_id = $1 AND state = 'waitlisted'", [account.id])).rows[0]?.created_at]
        );
        waitlist = { tier: wl[0].tier, position: (pos[0]?.count ?? 0) };
      }
      const { rows: offers } = await query<{ id: string; bench: string; tier: string; state: string; seconds_remaining: number }>(
        `SELECT id, bench, tier, state,
                ceil(extract(epoch from (offer_expires_at - now())))::int AS seconds_remaining
         FROM waitlist WHERE account_id = $1 AND state = 'offered' AND offer_expires_at > now()`,
        [account.id]
      );
      res.json({
        account: { id: account.id, name: account.name, email: account.email, role: account.role, clinic_name: account.clinic_name },
        reservations,
        groups,
        waitlist,
        offers: offers.map((o) => ({
          id: o.id,
          bench: o.bench,
          tier: o.tier,
          state: o.state,
          seconds_remaining: Math.max(0, o.seconds_remaining),
        })),
        venue_date: venue,
        deposits_open: depositsOpen(venue),
        server_time: nowIso(),
      });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

import { scryptSync, timingSafeEqual } from "node:crypto";
function hashMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
