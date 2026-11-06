import { LOCALES, type Locale } from "../shared/domain.ts";
import { bookingView, findBooking, findBookingWhere, refundBooking, type BookingRow } from "./bookings.ts";
import { checkout, type Replyable } from "./checkout.ts";
import { creditBalance, creditMovements } from "./credit.ts";
import { isUniqueViolation, one, query, transaction } from "./db.ts";
import { bookingLink } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { accountView, auditEntries, createEnquiry, enquiries, issueGoodwill, lookup, outboxMessages, replyToEnquiry } from "./finance.ts";
import { buyGift, giftForRedemption, purchasedGift, redeemGift } from "./gifts.ts";
import { createHold, holdView, ownHold, quoteHold, releaseHold, type Owner } from "./holds.ts";
import { cookie, json, route, type Context, type Reply } from "./http.ts";
import { newToken, sha256 } from "./ids.ts";
import { isBillingUp } from "./killbill.ts";
import { activeMembership, changeMembership, joinMembership } from "./membership.ts";
import { enqueue, isMailUp, nextMailNumber, wakeOutbox } from "./outbox.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { acceptKillBillFigure, reconciliation, reconciliationCsv } from "./reconciliation.ts";
import { checkInBooking, checkInTicket, doorList, doorScreenings } from "./door.ts";
import { addWeeklyScreenings, createSeason, programmerSeasons, publicSeason, transitionSeason } from "./programme.ts";
import { findScreening, occupancy, screeningView } from "./screenings.ts";
import { stageSeasons } from "./seasons.ts";
import { COOKIE_YEAR_S as YEAR_S, endSession, GUEST_COOKIE, LOCALE_COOKIE, SESSION_COOKIE, startSession, type AccountRow, type Session } from "./sessions.ts";
import { resendStepup, startStepup, verifyStepup } from "./stepup.ts";
import { isoToronto } from "./time.ts";
import { safePath } from "./safe-path.ts";
import { Fields } from "./validate.ts";

let ready = false;
export const markReady = (): void => {
  ready = true;
};

/** The anonymous guest cookie that scopes holds and retry keys; issued on first use. */
function guestOf(ctx: Context): { owner: Owner; scope: string; cookies: string[] } {
  if (ctx.session) return { owner: { accountId: ctx.session.account.id, guestId: null }, scope: `account:${ctx.session.account.id}`, cookies: [] };
  const existing = ctx.cookies[GUEST_COOKIE];
  const guestId = existing && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : newToken();
  return { owner: { accountId: null, guestId }, scope: `guest:${guestId}`, cookies: existing === guestId ? [] : [cookie(GUEST_COOKIE, guestId, YEAR_S)] };
}

const session = (ctx: Context): Session => {
  if (!ctx.session) throw new ApiError("unauthenticated");
  return ctx.session;
};

function idempotent(result: Replyable, cookies: string[]): Reply {
  return { status: result.status, body: result.text, headers: result.replayed ? { "Idempotent-Replayed": "true" } : {}, cookies };
}

const header = (ctx: Context, name: string): string | undefined => {
  const value = ctx.headers[name];
  return typeof value === "string" ? value : undefined;
};

// Health, status and locale.
route("GET", "/api/health", "anyone", async () => (ready ? json(200, { status: "ok" }) : json(503, { status: "starting" })));
route("GET", "/api/status", "anyone", async () => json(200, { billing: isBillingUp() ? "up" : "down", mail: isMailUp() ? "up" : "down", checked_at: isoToronto(new Date()) }));
route("POST", "/api/locale", "anyone", async (ctx) => {
  const fields = new Fields(ctx.body);
  const locale = fields.choice("locale", LOCALES);
  fields.done();
  if (ctx.session) await query("UPDATE accounts SET locale = $2 WHERE id = $1", [ctx.session.account.id, locale]);
  return { status: 204, cookies: [cookie(LOCALE_COOKIE, locale, YEAR_S)] };
});

// Programme.
route("GET", "/api/seasons", "anyone", async (ctx) => json(200, { seasons: await stageSeasons(ctx.locale, new Date()) }));
route("GET", "/api/seasons/:slug", "anyone", async (ctx) => json(200, await publicSeason(ctx.params.slug ?? "", ctx.locale, new Date())));
route("GET", "/api/screenings/:id", "anyone", async (ctx) => {
  const now = new Date();
  const screening = await findScreening(ctx.params.id ?? "");
  const season = screening ? await one<{ lifecycle: string }>("SELECT lifecycle FROM seasons WHERE slug = $1", [screening.season_slug]) : undefined;
  if (!screening || season?.lifecycle === "draft") throw new ApiError("not_found");
  const occupied = (await occupancy([screening.id], now)).get(screening.id) ?? { sold: new Set<string>(), held: new Map<string, string>() };
  const { owner } = guestOf(ctx);
  const mine = await query<{ id: string }>(
    "SELECT id FROM holds WHERE screening_id = $1 AND ((account_id IS NOT NULL AND account_id = $2) OR (guest_id IS NOT NULL AND guest_id = $3))",
    [screening.id, owner.accountId, owner.guestId],
  );
  return json(200, { screening: screeningView(screening, occupied, new Set(mine.map((h) => h.id))) });
});

// Holds and checkout.
route("POST", "/api/holds", "anyone", async (ctx) => {
  const guest = guestOf(ctx);
  const hold = await createHold(ctx.body, ctx.session, guest.owner);
  return json(201, { hold: holdView(hold, new Date()) }, {}, guest.cookies);
});
route("GET", "/api/holds/:id", "anyone", async (ctx) => {
  const now = new Date();
  return json(200, { hold: holdView(await ownHold(ctx.params.id ?? "", guestOf(ctx).owner, now), now) });
});
route("POST", "/api/holds/:id/quote", "anyone", async (ctx) => json(200, await quoteHold(ctx.params.id ?? "", ctx.body, ctx.session, guestOf(ctx).owner)));
route("DELETE", "/api/holds/:id", "anyone", async (ctx) => json(200, await releaseHold(ctx.params.id ?? "", guestOf(ctx).owner)));
route("POST", "/api/checkout", "anyone", async (ctx) => {
  const guest = guestOf(ctx);
  return idempotent(await checkout(ctx.body, ctx.session, guest.owner, guest.scope, header(ctx, "idempotency-key"), ctx.locale), guest.cookies);
});

// Bookings.
const ownedBy = (s: Session) => (row: BookingRow): boolean => row.account_id === s.account.id;
route("GET", "/api/bookings", "patron", async (ctx) => {
  const rows = await findBookingWhere("b.account_id = $1 ORDER BY b.paid_at DESC", [session(ctx).account.id]);
  return json(200, { bookings: await Promise.all(rows.map((row) => bookingView(row))) });
});
route("GET", "/api/bookings/:ref", "patron", async (ctx) => {
  const row = await findBooking(ctx.params.ref ?? "");
  if (!row || !ownedBy(session(ctx))(row)) throw new ApiError("not_found");
  return json(200, { booking: await bookingView(row) });
});
route("POST", "/api/bookings/:ref/refund", "patron", async (ctx) => {
  const s = session(ctx);
  const refund = await refundBooking(ctx.params.ref ?? "", ownedBy(s), () => ({ actor: s.account.number ?? "", reason: "Requested by the patron", emailReason: { kind: "patron" } }));
  const { audit_id: _audit, ...shape } = refund;
  return json(200, { refund: shape });
});

async function guestBooking(token: string): Promise<BookingRow> {
  const found = /^[A-Za-z0-9_-]{43}$/.test(token) ? (await findBookingWhere("b.guest_token_hash = $1", [sha256(token)]))[0] : undefined;
  if (!found) throw new ApiError("not_found");
  return found;
}
route("GET", "/api/guest/bookings/:token", "anyone", async (ctx) => json(200, { booking: await bookingView(await guestBooking(ctx.params.token ?? "")) }));
route("POST", "/api/guest/bookings/:token/refund", "anyone", async (ctx) => {
  const row = await guestBooking(ctx.params.token ?? "");
  const refund = await refundBooking(row.ref, (r) => r.guest_token_hash === row.guest_token_hash, () => ({ actor: "guest", reason: "Requested by the patron", emailReason: { kind: "patron" } }));
  const { audit_id: _audit, ...shape } = refund;
  return json(200, { refund: shape });
});
route("POST", "/api/guest/booking-links", "anyone", async (ctx) => {
  const fields = new Fields(ctx.body);
  const ref = fields.text("booking_ref", 1, 20);
  const email = fields.email("email");
  fields.done();
  await transaction(async (tx) => {
    const row = await findBooking(ref, tx, true);
    if (!row || row.account_id !== null || row.state === "refunded" || row.email.toLowerCase() !== email.toLowerCase()) return;
    const token = newToken();
    await tx.query("UPDATE bookings SET guest_token_hash = $2 WHERE ref = $1", [row.ref, sha256(token)]);
    const n = await nextMailNumber(tx, `booking-link:${row.ref}`);
    await enqueue(tx, { key: `booking-link:${row.ref}:${n}`, kind: "booking-link", to: row.email, ...bookingLink(row.locale, row.ref, token) });
  });
  wakeOutbox();
  return json(202, { status: "accepted" });
});

// Gifts.
route("POST", "/api/gifts", "anyone", async (ctx) => {
  const guest = guestOf(ctx);
  return idempotent(await buyGift(ctx.body, ctx.session, guest.scope, header(ctx, "idempotency-key"), ctx.locale), guest.cookies);
});
route("GET", "/api/gifts/:ref", "patron", async (ctx) => json(200, await purchasedGift(ctx.params.ref ?? "", session(ctx))));
route("GET", "/api/gift-redemptions/:token", "anyone", async (ctx) => json(200, await giftForRedemption(ctx.params.token ?? "")));
route("POST", "/api/gift-redemptions/:token/redeem", "patron", async (ctx) => json(201, await redeemGift(ctx.params.token ?? "", session(ctx))));

// Membership, credit and step-up.
route("GET", "/api/membership", "patron", async (ctx) => json(200, { membership: await activeMembership(session(ctx).account.id, new Date()) }));
route("POST", "/api/membership", "patron", async (ctx) => json(201, await joinMembership(session(ctx), ctx.body)));
route("POST", "/api/membership/change", "patron", async (ctx) => json(200, await changeMembership(session(ctx), ctx.body)));
route("GET", "/api/me/credit", "patron", async (ctx) => {
  const number = session(ctx).account.number ?? "";
  return json(200, { balance_cents: await creditBalance(number), movements: await creditMovements(number) });
});
route("POST", "/api/stepup/start", "patron", async (ctx) => json(201, await startStepup(session(ctx), ctx.body)));
route("POST", "/api/stepup/resend", "patron", async (ctx) => json(200, await resendStepup(session(ctx), ctx.body)));
route("POST", "/api/stepup/verify", "patron", async (ctx) => json(200, await verifyStepup(session(ctx), ctx.body)));

// Accounts.
const ACCOUNT_COLUMNS = "id, number, email, name, role, locale, kb_account_id";
route("POST", "/api/auth/signup", "anyone", async (ctx) => {
  const fields = new Fields(ctx.body);
  const email = fields.email("email");
  if (email && await one("SELECT 1 FROM accounts WHERE lower(email) = lower($1)", [email])) throw new ApiError("email_taken");
  const name = fields.text("name", 1, 80);
  const password = fields.text("password", 10, 128);
  const locale = fields.choice("locale", LOCALES);
  fields.done();
  let account: AccountRow | undefined;
  try {
    account = await one<AccountRow>(
      `INSERT INTO accounts (number, email, name, password_hash, role, locale) VALUES ('A-' || nextval('account_number_seq'), $1, $2, $3, 'patron', $4) RETURNING ${ACCOUNT_COLUMNS}`,
      [email, name, await hashPassword(password), locale],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError("email_taken");
    throw error;
  }
  if (!account) throw new Error("account not created");
  const token = await startSession(account.id);
  return json(201, { account: { number: account.number, name: account.name, email: account.email, locale: account.locale, role: account.role } }, {}, [cookie(SESSION_COOKIE, token)]);
});
route("POST", "/api/auth/signin", "anyone", async (ctx) => {
  const fields = new Fields(ctx.body);
  const email = fields.text("email", 1, 254);
  const password = fields.text("password", 1, 128);
  fields.done();
  const row = await one<AccountRow & { password_hash: string }>(`SELECT ${ACCOUNT_COLUMNS}, password_hash FROM accounts WHERE lower(email) = lower($1)`, [email]);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new ApiError("invalid_credentials");
  const { password_hash: _hash, ...account } = row;
  const token = await startSession(account.id);
  const next = typeof ctx.body.next === "string" && safePath(ctx.body.next) ? ctx.body.next : `/${account.locale}/${account.role === "patron" ? "account" : "staff"}`;
  return json(200, { account: { number: account.number, name: account.name, email: account.email, locale: account.locale, role: account.role }, redirect: next }, {}, [cookie(SESSION_COOKIE, token)]);
});
route("POST", "/api/auth/signout", "signed-in", async (ctx) => {
  await endSession(session(ctx));
  return { status: 204, cookies: [cookie(SESSION_COOKIE, "", 0)] };
});
route("GET", "/api/me", "signed-in", async (ctx) => json(200, { account: await accountView(session(ctx).account, new Date()) }));
route("POST", "/api/enquiries", "anyone", async (ctx) => json(201, await createEnquiry(ctx.body, ctx.locale)));

// Door.
route("GET", "/api/door/screenings", "door", async () => json(200, await doorScreenings(new Date())));
route("GET", "/api/door/screenings/:id/list", "door", async (ctx) => json(200, await doorList(ctx.params.id ?? "")));
route("POST", "/api/door/tickets/:code/check-in", "door", async (ctx) => json(200, await checkInTicket(ctx.params.code ?? "")));
route("POST", "/api/door/bookings/:ref/check-in", "door", async (ctx) => json(200, await checkInBooking(ctx.params.ref ?? "")));

// Programming.
route("GET", "/api/programmer/seasons", "programmer", async (ctx) => json(200, await programmerSeasons(ctx.locale, new Date())));
route("POST", "/api/programmer/seasons", "programmer", async (ctx) => json(201, await createSeason(ctx.body, ctx.locale)));
route("POST", "/api/programmer/seasons/:slug/screenings", "programmer", async (ctx) => json(201, await addWeeklyScreenings(ctx.params.slug ?? "", ctx.body)));
route("POST", "/api/programmer/seasons/:slug/transition", "programmer", async (ctx) => json(200, await transitionSeason(ctx.params.slug ?? "", ctx.body, session(ctx), ctx.locale)));

// Finance.
route("GET", "/api/finance/lookup", "finance", async (ctx) => json(200, await lookup(ctx.url.searchParams.get("q") ?? "")));
route("POST", "/api/finance/bookings/:ref/refund", "finance", async (ctx) => {
  const s = session(ctx);
  const fields = new Fields(ctx.body);
  const reason = fields.text("reason", 3, 500);
  const refund = await refundBooking(ctx.params.ref ?? "", () => true, () => ({ actor: s.account.email, reason, emailReason: { kind: "box-office" } }), () => fields.done());
  const { audit_id, ...shape } = refund;
  return json(200, { refund: shape, audit_id });
});
route("POST", "/api/finance/credits", "finance", async (ctx) => json(201, await issueGoodwill(session(ctx), ctx.body)));
route("GET", "/api/finance/audit", "finance", async () => json(200, await auditEntries()));
for (const method of ["PUT", "PATCH", "DELETE"]) {
  route(method, "/api/finance/audit/:id", "finance", async () => {
    throw new ApiError("method_not_allowed", {}, { allow: "GET" });
  });
}
route("GET", "/api/finance/reconciliation", "finance", async (ctx) => json(200, await reconciliation(ctx.url.searchParams.get("date"))));
route("GET", "/api/finance/reconciliation.csv", "finance", async (ctx) => {
  const { date, csv } = await reconciliationCsv(ctx.url.searchParams.get("date"));
  return { status: 200, text: csv, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="halide-takings-${date}.csv"` } };
});
route("POST", "/api/finance/reconciliation/accept", "finance", async (ctx) => json(200, await acceptKillBillFigure(session(ctx), ctx.body)));
route("GET", "/api/finance/outbox", "finance", async () => json(200, await outboxMessages()));
route("GET", "/api/finance/enquiries", "finance", async () => json(200, await enquiries()));
route("POST", "/api/finance/enquiries/:ref/reply", "finance", async (ctx) => json(201, await replyToEnquiry(session(ctx), ctx.params.ref ?? "", ctx.body)));

/** `GET /locale/<en|fr>?next=` (the language button without scripts). */
export function localeRedirect(locale: Locale, next: string | null): Reply {
  const target = next !== null && safePath(next) ? (/^\/(en|fr)(\/|$)/.test(next) ? `/${locale}${next.slice(3)}` : `/${locale}${next}`) : `/${locale}/`;
  return { status: 303, headers: { Location: target }, cookies: [cookie(LOCALE_COOKIE, locale, YEAR_S)] };
}

