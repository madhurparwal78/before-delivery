import {
  CLEARED_COOKIE,
  accountView,
  createSession,
  endSession,
  findAccountByEmail,
  insertAccount,
  passwordMatches,
  sessionCookie,
  sessionToken,
  type Account,
} from "../auth.js";
import { many, pool, tx } from "../db.js";
import { ApiError, conflict, validation } from "../http.js";
import { freshLedger, groupView } from "../views.js";
import { waitlistPosition } from "../ledger.js";
import { isAssignee, isAttendee, isBuyer, reservationView, reservationsWhere } from "../reservations.js";
import { SOLD_STATES, depositsOpen, venueToday } from "../rules.js";
import { publicRoute, route } from "../router.js";
import { email, fields, text } from "../validate.js";

publicRoute({
  method: "POST",
  path: "/api/auth/signup",
  handle: async (ctx) => {
    const body = fields(ctx.body);
    const name = text(body.name, 1, 120);
    const address = email(body.email);
    const password = typeof body.password === "string" && body.password.length >= 10 && body.password.length <= 128 ? body.password : null;
    const kind = body.kind === "practitioner" || body.kind === "clinic" ? body.kind : null;
    const clinicName = kind === "clinic" ? text(body.clinic_name, 1, 120) : null;
    return tx(async (db) => {
      if (address && (await findAccountByEmail(db, address))) throw conflict("email_taken", "An account with this email already exists.");
      const errors: Record<string, string> = {};
      if (!name) errors.name = "Enter your name (1 to 120 characters).";
      if (!address) errors.email = "Enter a valid email address.";
      if (!password) errors.password = "Use 10 to 128 characters.";
      if (!kind) errors.kind = "Choose Practitioner or Clinic.";
      if (kind === "clinic" && !clinicName) errors.clinic_name = "Enter the clinic name (1 to 120 characters).";
      if (!name || !address || !password || !kind || Object.keys(errors).length) throw validation(errors);
      const account = await insertAccount(db, { name, email: address, password, role: kind, clinicName });
      if (!account) throw conflict("email_taken", "An account with this email already exists.");
      const token = await createSession(db, account.id);
      return { status: 201, body: { account: accountView(account) }, headers: { "Set-Cookie": sessionCookie(token) } };
    });
  },
});

publicRoute({
  method: "POST",
  path: "/api/auth/signin",
  handle: async (ctx) => {
    const body = fields(ctx.body);
    const address = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    return tx(async (db) => {
      const account = address ? await findAccountByEmail(db, address) : null;
      if (!account || !(await passwordMatches(password, account.password_hash))) {
        throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
      }
      const token = await createSession(db, account.id);
      return { status: 200, body: { account: accountView(account) }, headers: { "Set-Cookie": sessionCookie(token) } };
    });
  },
});

publicRoute({
  method: "POST",
  path: "/api/auth/signout",
  handle: async (ctx) => {
    await endSession(sessionToken(ctx.req));
    return { status: 204, headers: { "Set-Cookie": CLEARED_COOKIE } };
  },
});

async function mine(account: Account) {
  return reservationsWhere(
      pool,
      `r.buyer_id = $1 OR (r.attendee_accepted AND r.attendee_account_id = $1)
       OR ($2 AND NOT r.attendee_accepted AND lower(r.attendee_email) = $3 AND r.state = ANY($4))`,
      [account.id, account.role === "practitioner", account.email_key, SOLD_STATES],
  );
}

route({
  method: "GET",
  path: "/api/me",
  access: "signed-in",
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const { account, now } = ctx;
    const rows = await mine(account);
    const groupIds = await many<{ id: string }>(pool, "SELECT id FROM groups WHERE buyer_id = $1 ORDER BY created_at", [account.id]);
    const entries = await many<{ id: string; tier: string; state: string; bench: string | null; offer_expires_at: Date | null }>(
      pool,
      "SELECT id, tier, state, bench, offer_expires_at FROM waitlist_entries WHERE account_id = $1 ORDER BY seq",
      [account.id],
    );
    const waiting = entries.find((entry) => entry.state === "waitlisted");
    return {
      status: 200,
      body: {
        account: accountView(account),
        reservations: rows.map((row) => ({
          ...reservationView(row, now),
          relationship: [isBuyer(row, account) && "buyer", isAttendee(row, account) && "attendee", isAssignee(row, account) && "assignee"].filter(Boolean),
        })),
        groups: await Promise.all(groupIds.map((group) => groupView(pool, group.id, now))),
        waitlist: waiting ? { tier: waiting.tier, position: await waitlistPosition(pool, waiting.id) } : null,
        offers: entries
          .filter((entry) => entry.bench !== null)
          .map((entry) => ({
            id: entry.id,
            bench: entry.bench,
            tier: entry.tier,
            state: entry.state,
            seconds_remaining:
              entry.state === "offered" && entry.offer_expires_at
                ? Math.max(0, Math.ceil((entry.offer_expires_at.getTime() - now.getTime()) / 1000))
                : 0,
          })),
        venue_date: venueToday(now),
        deposits_open: depositsOpen(venueToday(now)),
        server_time: now.toISOString(),
      },
    };
  },
});
