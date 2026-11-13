// The API (brief: Backend › API). Each handler follows the error precedence: limits and origin
// (in `prepare`), 401, 404, 403, idempotency, then the domain module's 409, 422, 402 and 503.
import { randomBytes } from "node:crypto";
import { one, pool, rows, tx } from "./db.js";
import { ApiError, Router, assertValid, fail, fieldsOf, redirect } from "./http.js";
import { idempotent } from "./idempotency.js";
import { cachePreferences, clearedCookie, currentUser, endSession, isStaff, requireRole, requireUser, sessionCookie, startSession, } from "./signin.js";
import * as pb from "./pocketbase.js";
import { chapterDetail, publicChapter, publicEvent, publishedChapter, publishedChapters, publishedEvents, publishedTitles, search, sources } from "./archive.js";
import { EXHIBIT_SEEDS } from "./exhibit-seeds.js";
import { mediaLink, uploadMedia } from "./media.js";
import { catalogVersions, DONATION_LIMITS, hasLaterChange, schedulePriceChange, scheduledChanges, ticketPriceAt } from "./catalog.js";
import { BillingUnreachable } from "./killbill.js";
import { bookSeats, listSessions, sessionById, sessionJson } from "./sessions.js";
import { donate } from "./donations.js";
import { accountCurrency, orderById, orderJson, ORDER_SELECT } from "./payments.js";
import { cancelMembership, changeTier, join, membershipView, overdueSupporters, retryPayment, undoPending, updateCard } from "./membership.js";
import { cancelSession, refundOrder } from "./refunds.js";
import { createEvent, createSource, editItem, listItems, transition } from "./curator.js";
import { listActions, recordAction } from "./audit.js";
import { reconcile } from "./reconciliation.js";
import { objectExists, presignedUrl, StorageUnreachable } from "./storage.js";
import { COPY, TIERS, TIER_NAMES } from "../shared/copy.js";
import { CURRENCIES, isCurrency } from "../shared/money.js";
import { EXHIBIT_KEYS } from "../shared/exhibits.js";
import { lisbonDate, lisbonMidnight, parseDateEntry, parseIsoWithOffset, toLisbonIso } from "../shared/lisbon.js";
export const router = new Router();
const json = (body, status = 200) => ({ status, body });
const query = (ctx, name) => ctx.url.searchParams.get(name);
// Platform and accounts
router.add("GET", "/api/health", async () => json({ status: "ok" }));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function signedIn(user, status) {
    const token = await startSession(user);
    const preferences = await pb.readPreferences(user.id).catch(() => pb.DEFAULT_PREFERENCES);
    await cachePreferences(token, preferences);
    return { status, body: { user: { id: user.id, name: user.name, email: user.email, role: user.role } }, headers: { "Set-Cookie": sessionCookie(token) } };
}
router.add("POST", "/api/auth/register", async (ctx) => {
    const input = fieldsOf(ctx);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const email = typeof input.email === "string" ? input.email.trim() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const fields = {};
    if (!name || name.length > 100)
        fields.name = COPY.nameField;
    if (!EMAIL.test(email) || email.length > 200)
        fields.email = COPY.emailField;
    if (password.length < 10 || password.length > 72)
        fields.password = COPY.passwordField;
    assertValid(fields);
    const created = await pb.registerUser(name, email, password);
    if (created === "email_taken")
        throw fail.conflict("email_taken", COPY.emailTaken);
    return signedIn(created, 201);
});
router.add("POST", "/api/auth/login", async (ctx) => {
    const input = fieldsOf(ctx);
    const user = await pb.signIn(typeof input.email === "string" ? input.email.trim() : "", typeof input.password === "string" ? input.password : "");
    if (!user)
        throw new ApiError(401, "invalid_credentials", COPY.wrongCredentials);
    return signedIn(user, 200);
});
router.add("POST", "/api/auth/logout", async (ctx) => {
    await endSession(ctx);
    return { status: 204, headers: { "Set-Cookie": clearedCookie } };
});
const userJson = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
router.add("GET", "/api/me", async (ctx) => {
    const user = await requireUser(ctx);
    const preferences = await pb.readPreferences(user.id).then(async (fresh) => (await cachePreferences(user.token, fresh), fresh), (error) => {
        if (error instanceof pb.AccountsUnreachable)
            return user.cachedPreferences;
        throw error;
    });
    return json({ user: userJson(user), preferences });
});
router.add("PUT", "/api/me/preferences", async (ctx) => {
    const user = await requireUser(ctx);
    const input = fieldsOf(ctx);
    const fields = {};
    if (typeof input.motion !== "boolean")
        fields.motion = "Choose on or off.";
    if (typeof input.sound !== "boolean")
        fields.sound = "Choose on or off.";
    assertValid(fields);
    const preferences = await pb.writePreferences(user.id, { motion: input.motion, sound: input.sound });
    await cachePreferences(user.token, preferences);
    return json({ preferences });
});
// Exhibition
async function resolvedFor(user) {
    if (!user)
        return [];
    return pb.readPath(user.id).then((path) => path.resolved, () => []);
}
router.add("GET", "/api/chapters", async (ctx) => {
    const resolved = await resolvedFor(await currentUser(ctx));
    return json({ chapters: (await publishedChapters()).map((c) => publicChapter(c, resolved.includes(c.number))) });
});
const chapterNumber = (value) => (value !== null && /^[1-8]$/.test(value) ? Number(value) : null);
router.add("GET", "/api/chapters/:number", async (ctx) => {
    const number = chapterNumber(ctx.params.number);
    const chapter = number === null ? undefined : await publishedChapter(number);
    if (!chapter)
        throw fail.notFound();
    const resolved = await resolvedFor(await currentUser(ctx));
    return json({ chapter: await chapterDetail(chapter, resolved.includes(chapter.number)) });
});
function chapterFilter(ctx) {
    const raw = query(ctx, "chapter");
    if (raw === null || raw === "")
        return undefined;
    const number = chapterNumber(raw);
    if (number === null)
        throw fail.validation({ chapter: "Choose a chapter from 1 to 8." });
    return number;
}
router.add("GET", "/api/timeline", async (ctx) => json({ events: (await publishedEvents(chapterFilter(ctx))).map(publicEvent) }));
router.add("GET", "/api/search", async (ctx) => {
    const q = query(ctx, "q") ?? "";
    const fields = {};
    if (q.length < 2 || q.length > 100)
        fields.q = "Search with 2 to 100 characters.";
    let chapter;
    try {
        chapter = chapterFilter(ctx);
    }
    catch (error) {
        if (!(error instanceof ApiError))
            throw error;
        fields.chapter = "Choose a chapter from 1 to 8.";
    }
    assertValid(fields);
    return json({ results: await search(q, chapter) });
});
router.add("GET", "/api/sources", async () => json({ sources: await sources() }));
router.add("GET", "/api/exhibits/:key", async (ctx) => {
    const key = ctx.params.key;
    if (!EXHIBIT_KEYS.includes(key))
        throw fail.notFound();
    return json(EXHIBIT_SEEDS[key]);
});
router.add("GET", "/api/media/:id", async (ctx) => mediaLink(ctx.params.id, isStaff(await currentUser(ctx))));
// Path and bookmarks
async function visiblePath(userId) {
    const path = await pb.readPath(userId);
    const published = new Set((await publishedChapters()).map((c) => c.number));
    return { resolved: path.resolved.filter((n) => published.has(n)), last_chapter: path.last_chapter, last_exhibit: path.last_exhibit };
}
router.add("GET", "/api/me/path", async (ctx) => {
    const user = await requireUser(ctx);
    return json({ path: await visiblePath(user.id) });
});
async function publishedChapterFrom(value) {
    const chapter = typeof value === "number" && Number.isInteger(value) ? await publishedChapter(value) : undefined;
    if (!chapter)
        throw fail.notFound();
    return chapter;
}
router.add("POST", "/api/me/path/resolved", async (ctx) => {
    const user = await requireUser(ctx);
    const chapter = await publishedChapterFrom(fieldsOf(ctx).chapter);
    await tx(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`path:${user.id}`]);
        const path = await pb.readPath(user.id);
        if (!path.resolved.includes(chapter.number)) {
            await pb.writePath(user.id, { ...path, resolved: [...path.resolved, chapter.number].sort((a, b) => a - b) });
        }
    });
    return json({ path: await visiblePath(user.id) });
});
router.add("PUT", "/api/me/path/position", async (ctx) => {
    const user = await requireUser(ctx);
    const input = fieldsOf(ctx);
    const chapter = await publishedChapterFrom(input.chapter);
    if (input.exhibit !== "" && input.exhibit !== chapter.exhibit)
        throw fail.validation({ exhibit: "Choose this chapter's exhibit or none." });
    await tx(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`path:${user.id}`]);
        const path = await pb.readPath(user.id);
        await pb.writePath(user.id, { ...path, last_chapter: chapter.number, last_exhibit: input.exhibit });
    });
    return json({ path: await visiblePath(user.id) });
});
router.add("GET", "/api/me/bookmarks", async (ctx) => {
    const user = await requireUser(ctx);
    const stored = await pb.listBookmarks(user.id);
    const titles = await publishedTitles(stored.map((b) => b.target_id));
    return json({ bookmarks: stored.filter((b) => titles.has(b.target_id)).map((b) => ({ ...b, title: titles.get(b.target_id) })) });
});
router.add("POST", "/api/me/bookmarks", async (ctx) => {
    const user = await requireUser(ctx);
    const input = fieldsOf(ctx);
    const targetId = typeof input.target_id === "string" ? input.target_id : "";
    const typeMatches = (input.target_type === "chapter" && targetId.startsWith("chapter-")) || (input.target_type === "event" && targetId.startsWith("ev-"));
    const title = typeMatches ? (await publishedTitles([targetId])).get(targetId) : undefined;
    if (!title)
        throw fail.notFound();
    const { bookmark, created } = await pb.addBookmark(user.id, input.target_type, targetId);
    return json({ bookmark: { ...bookmark, title } }, created ? 201 : 200);
});
router.add("DELETE", "/api/me/bookmarks/:id", async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await pb.removeBookmark(user.id, ctx.params.id)))
        throw fail.notFound();
    return { status: 204 };
});
// Commerce
async function cardCurrency(user) {
    return (user && (await accountCurrency(user.id))) || "EUR";
}
router.add("GET", "/api/catalog", async () => {
    const versions = await catalogVersions();
    const now = Date.now();
    const current = versions.filter((v) => v.effectiveFrom <= now).at(-1);
    return json({
        currencies: CURRENCIES,
        ticket: { prices: current.ticket },
        tiers: TIERS.map((tier) => ({ tier, name: TIER_NAMES[tier], prices: current.tiers[tier], scheduled_changes: scheduledChanges(versions, tier, now) })),
        donation: {
            min_minor: Object.fromEntries(CURRENCIES.map((c) => [c, DONATION_LIMITS.min])),
            max_minor: Object.fromEntries(CURRENCIES.map((c) => [c, DONATION_LIMITS.max])),
        },
    });
});
/** The ticket price in the card currency, or null when prices cannot be read. */
async function ticketPrice(currency) {
    try {
        return { currency, minor: ticketPriceAt(await catalogVersions(), currency, Date.now()) };
    }
    catch (error) {
        if (error instanceof BillingUnreachable)
            return null;
        throw error;
    }
}
router.add("GET", "/api/sessions", async (ctx) => {
    const now = Date.now();
    const price = await ticketPrice(await cardCurrency(await currentUser(ctx)));
    return json({ server_time: toLisbonIso(now), sessions: (await listSessions()).map((s) => sessionJson(s, now, price)) });
});
const payerOf = (u) => ({ id: u.id, name: u.name, email: u.email });
router.add("POST", "/api/sessions/:id/bookings", async (ctx) => {
    const user = await requireUser(ctx);
    if (!(await sessionById(pool, ctx.params.id)))
        throw fail.notFound();
    return idempotent(ctx, user.id, () => bookSeats(payerOf(user), ctx.params.id, fieldsOf(ctx)));
});
router.add("POST", "/api/donations", async (ctx) => {
    const user = await requireUser(ctx);
    return idempotent(ctx, user.id, () => donate(payerOf(user), fieldsOf(ctx)));
});
router.add("GET", "/api/me/orders", async (ctx) => {
    const user = await requireUser(ctx);
    const orders = await rows(pool, `${ORDER_SELECT} WHERE o.user_id = $1 ORDER BY o.settled_at DESC, o.receipt_number DESC`, [user.id]);
    return json({ orders: orders.map(orderJson) });
});
router.add("GET", "/api/orders/:id/receipt", async (ctx) => {
    const user = await requireUser(ctx);
    const order = await orderById(pool, ctx.params.id);
    if (!order || (order.user_id !== user.id && user.role !== "manager"))
        throw fail.notFound();
    const key = `receipts/${order.receipt_number}.pdf`;
    const stored = await objectExists(key).catch((error) => {
        if (error instanceof StorageUnreachable)
            return false;
        throw error;
    });
    if (!stored)
        throw fail.storage();
    return redirect(presignedUrl(key));
});
router.add("GET", "/api/me/membership", async (ctx) => {
    const user = await requireUser(ctx);
    // account_currency: the Kill Bill account currency once fixed (even by a declined first attempt), so
    // the booking and plan dialogs can disable the other currencies.
    return json({ membership: await membershipView(user.id), account_currency: await accountCurrency(user.id) });
});
router.add("POST", "/api/me/membership", async (ctx) => {
    const user = await requireUser(ctx);
    return idempotent(ctx, user.id, () => join(payerOf(user), fieldsOf(ctx)));
});
router.add("POST", "/api/me/membership/change", async (ctx) => {
    const user = await requireUser(ctx);
    return idempotent(ctx, user.id, () => changeTier(payerOf(user), fieldsOf(ctx)));
});
router.add("POST", "/api/me/membership/cancel", async (ctx) => {
    const user = await requireUser(ctx);
    return idempotent(ctx, user.id, () => cancelMembership(payerOf(user)));
});
router.add("POST", "/api/me/membership/undo", async (ctx) => {
    const user = await requireUser(ctx);
    return idempotent(ctx, user.id, () => undoPending(payerOf(user)));
});
router.add("PUT", "/api/me/membership/card", async (ctx) => updateCard(payerOf(await requireUser(ctx)), fieldsOf(ctx)));
router.add("POST", "/api/me/membership/retry", async (ctx) => {
    const user = await requireUser(ctx);
    return idempotent(ctx, user.id, () => retryPayment(payerOf(user)));
});
// Studio
const CURATORS = ["curator", "lead_curator"];
router.add("GET", "/api/curator/items", async (ctx) => {
    await requireRole(ctx, CURATORS);
    return json(await listItems(query(ctx, "type") || null, query(ctx, "status") || null));
});
router.add("POST", "/api/curator/events", async (ctx) => createEvent(await requireRole(ctx, CURATORS), fieldsOf(ctx)));
router.add("PATCH", "/api/curator/items/:id", async (ctx) => editItem(await requireRole(ctx, CURATORS), ctx.params.id, fieldsOf(ctx)));
router.add("POST", "/api/curator/items/:id/transitions", async (ctx) => transition(await requireRole(ctx, CURATORS), ctx.params.id, fieldsOf(ctx)));
router.add("POST", "/api/curator/sources", async (ctx) => createSource(await requireRole(ctx, CURATORS), fieldsOf(ctx)));
router.add("POST", "/api/curator/media", async (ctx) => uploadMedia(await requireRole(ctx, CURATORS), ctx.upload), "multipart");
// Box office
const MANAGER = ["manager"];
router.add("POST", "/api/manager/sessions", async (ctx) => {
    const user = await requireRole(ctx, MANAGER);
    const input = fieldsOf(ctx);
    const fields = {};
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (title.length < 3 || title.length > 120)
        fields.title = COPY.sessionTitleField;
    const starts = typeof input.starts_at === "string" ? parseIsoWithOffset(input.starts_at) : null;
    if (starts === null || starts <= Date.now())
        fields.starts_at = COPY.afterNow;
    const duration = input.duration_minutes;
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 15 || duration > 240)
        fields.duration_minutes = COPY.durationField;
    const capacity = input.capacity;
    if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 200)
        fields.capacity = COPY.capacityField;
    assertValid(fields);
    const id = `ses-${randomBytes(6).toString("hex")}`;
    const session = await tx(async (db) => {
        await db.query("INSERT INTO guided_sessions (id, title, starts_at, duration_minutes, capacity) VALUES ($1, $2, $3, $4, $5)", [id, title, new Date(starts), duration, capacity]);
        await recordAction(db, user.email, "session_created", "session", id, { title, starts_at: input.starts_at, capacity });
        return sessionById(db, id);
    });
    return json({ session: sessionJson(session, Date.now(), await ticketPrice("EUR")) }, 201);
});
router.add("POST", "/api/manager/sessions/:id/cancel", async (ctx) => {
    const user = await requireRole(ctx, MANAGER);
    if (!(await sessionById(pool, ctx.params.id)))
        throw fail.notFound();
    return idempotent(ctx, user.id, () => cancelSession(ctx.params.id, fieldsOf(ctx).reason, user.email));
});
const ORDER_KINDS = ["ticket", "donation", "membership_join", "membership_upgrade"];
router.add("GET", "/api/manager/orders", async (ctx) => {
    await requireRole(ctx, MANAGER);
    const currency = query(ctx, "currency") || null;
    const kind = query(ctx, "kind") || null;
    const fields = {};
    if (currency !== null && !isCurrency(currency))
        fields.currency = "Choose EUR, GBP, USD or JPY.";
    if (kind !== null && !ORDER_KINDS.includes(kind))
        fields.kind = "Choose ticket, donation, membership_join or membership_upgrade.";
    assertValid(fields);
    const orders = await rows(pool, `${ORDER_SELECT} WHERE ($1::text IS NULL OR o.currency = $1) AND ($2::text IS NULL OR o.kind = $2) ORDER BY o.settled_at DESC, o.receipt_number DESC`, [
        currency,
        kind,
    ]);
    const ids = orders.map((o) => o.id);
    const refunds = await rows(pool, "SELECT * FROM refunds WHERE order_id = ANY($1) ORDER BY at, id", [ids]);
    const notes = await rows(pool, "SELECT * FROM order_notes WHERE order_id = ANY($1) ORDER BY at, id", [ids]);
    return json({
        orders: orders.map((o) => ({
            ...orderJson(o),
            user_email: o.user_email,
            killbill_invoice_id: o.killbill_invoice_id,
            killbill_payment_id: o.killbill_payment_id,
            refunds: refunds.filter((r) => r.order_id === o.id).map((r) => ({ id: r.id, amount_minor: r.amount_minor, reason: r.reason, at: r.at.toISOString() })),
            notes: notes.filter((n) => n.order_id === o.id).map((n) => ({ id: n.id, text: n.text, author_email: n.author_email, at: n.at.toISOString() })),
        })),
    });
});
router.add("POST", "/api/manager/orders/:id/refunds", async (ctx) => {
    const user = await requireRole(ctx, MANAGER);
    if (!(await orderById(pool, ctx.params.id)))
        throw fail.notFound();
    const input = fieldsOf(ctx);
    return idempotent(ctx, user.id, () => refundOrder(ctx.params.id, input.amount_minor, typeof input.reason === "string" ? input.reason.trim() : input.reason, user.email));
});
router.add("POST", "/api/manager/orders/:id/notes", async (ctx) => {
    const user = await requireRole(ctx, MANAGER);
    if (!(await orderById(pool, ctx.params.id)))
        throw fail.notFound();
    const text = fieldsOf(ctx).text;
    if (typeof text !== "string" || !text.trim() || text.length > 500)
        throw fail.validation({ text: "Write a note of 1 to 500 characters." });
    const note = await tx(async (db) => {
        const id = randomBytes(8).toString("hex");
        const row = await one(db, "INSERT INTO order_notes (id, order_id, text, author_email) VALUES ($1, $2, $3, $4) RETURNING at", [id, ctx.params.id, text.trim(), user.email]);
        await recordAction(db, user.email, "order_note", "order", ctx.params.id, { note_id: id });
        return { id, text: text.trim(), author_email: user.email, at: row.at.toISOString() };
    });
    return json({ note }, 201);
});
router.add("GET", "/api/manager/dunning", async (ctx) => {
    await requireRole(ctx, MANAGER);
    return json({ overdue: await overdueSupporters() });
});
router.add("GET", "/api/manager/reconciliation", async (ctx) => {
    await requireRole(ctx, MANAGER);
    const month = query(ctx, "month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        throw fail.validation({ month: "Choose a month as YYYY-MM." });
    return json(await reconcile(month));
});
const isTier = (v) => typeof v === "string" && TIERS.includes(v);
router.add("POST", "/api/manager/plan-prices", async (ctx) => {
    const user = await requireRole(ctx, MANAGER);
    const input = fieldsOf(ctx);
    const fields = {};
    if (!isTier(input.tier))
        fields.tier = "Choose Reader, Fellow or Patron.";
    if (!isCurrency(input.currency))
        fields.currency = "Choose EUR, GBP, USD or JPY.";
    const effectiveOn = typeof input.effective_on === "string" ? parseDateEntry(input.effective_on) : null;
    if (effectiveOn === null)
        fields.effective_on = COPY.afterToday;
    assertValid(fields);
    const amount = input.amount_minor;
    const later = {};
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > 1_000_000)
        later.amount_minor = "Enter a price from 1 to 1,000,000 minor units.";
    if (lisbonMidnight(effectiveOn) <= lisbonMidnight(lisbonDate(Date.now())))
        later.effective_on = COPY.afterToday;
    const tier = input.tier;
    const currency = input.currency;
    if (hasLaterChange(await catalogVersions(), tier, currency, lisbonMidnight(effectiveOn)))
        throw fail.conflict("price_change_conflict", COPY.priceConflict);
    assertValid(later);
    if ((await schedulePriceChange(tier, currency, amount, effectiveOn)) === "conflict")
        throw fail.conflict("price_change_conflict", COPY.priceConflict);
    const change = { tier, currency, amount_minor: amount, effective_on: effectiveOn };
    await recordAction(pool, user.email, "price_change", "tier", tier, change);
    return json({ change }, 201);
});
router.add("GET", "/api/manager/audit", async (ctx) => {
    await requireRole(ctx, ["manager", "lead_curator"]);
    return json({ actions: await listActions(pool) });
});
