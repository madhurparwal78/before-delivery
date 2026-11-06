import { config } from "../config.js";
import { allow, crateId, CUSTOMER, signedIn } from "../context.js";
import { query } from "../db.js";
import { addCans, cartJson, readCrate, removeCan, updateCrate, CRATE_SIZE } from "../domain/crate.js";
import { buildQuote, loadPricing, quoteJson } from "../domain/quote.js";
import { stockFigures } from "../domain/stock.js";
import { ApiError, accountsUnavailable, bool, int, notFound, str, validation } from "../http.js";
import { createReview, literal, realtimeUp, reviews } from "../pocketbase.js";
// ---- flavours and quote -------------------------------------------------------------------
export async function listFlavours() {
    const [pricing, stock] = await Promise.all([loadPricing(), stockFigures()]);
    return {
        status: 200,
        body: {
            flavours: pricing.flavours.map((f) => ({
                slug: f.slug,
                name: f.name,
                can_price_cents: f.canPriceCents,
                limited: f.limited,
                subscribable: !f.limited,
                stock_left: stock.find((s) => s.flavour === f.slug)?.available ?? 0,
            })),
        },
    };
}
export async function quote(ctx) {
    const pricing = await loadPricing();
    const fields = {};
    const province = str(ctx.body, "province");
    if (!province || !pricing.provinces.some((p) => p.code === province))
        fields.province = "We don't ship to that province yet.";
    const subscribe = bool(ctx.body, "subscribe");
    if (subscribe === undefined)
        fields.subscribe = "Say whether to subscribe and save.";
    const raw = ctx.body.cans;
    const cans = [];
    if (!Array.isArray(raw)) {
        fields.cans = "List the cans to quote.";
    }
    else {
        for (const item of raw) {
            const entry = item !== null && typeof item === "object" && !Array.isArray(item) ? item : {};
            const flavour = typeof entry.flavour === "string" ? entry.flavour : "";
            const quantity = typeof entry.quantity === "number" && Number.isInteger(entry.quantity) ? entry.quantity : 0;
            if (!pricing.flavours.some((f) => f.slug === flavour))
                fields.cans = "Pick flavours from the shop.";
            else if (quantity < 1)
                fields.cans = "Each flavour needs at least 1 can.";
            else
                cans.push({ flavour, quantity });
        }
        if (!fields.cans && cans.reduce((a, c) => a + c.quantity, 0) > CRATE_SIZE)
            fields.cans = "A crate holds up to 12 cans.";
    }
    if (subscribe && cans.some((c) => pricing.flavours.find((f) => f.slug === c.flavour)?.limited)) {
        fields.subscribe = "Limited drops can't be added to a subscription.";
    }
    if (Object.keys(fields).length > 0 || !province || subscribe === undefined)
        throw validation(fields);
    return { status: 200, body: quoteJson(buildQuote(pricing, province, subscribe, cans)) };
}
// ---- cart ---------------------------------------------------------------------------------
export async function getCart(ctx) {
    return { status: 200, body: { cart: cartJson(await readCrate(await crateId(ctx))) } };
}
export async function addToCart(ctx) {
    const id = await crateId(ctx);
    const flavour = str(ctx.body, "flavour");
    const quantity = int(ctx.body, "quantity");
    const fields = {};
    if (!flavour)
        fields.flavour = "Pick a flavour from the shop.";
    if (quantity === undefined || quantity < 1 || quantity > CRATE_SIZE)
        fields.quantity = "Add 1 to 12 cans.";
    if (!flavour || quantity === undefined || Object.keys(fields).length > 0)
        throw validation(fields);
    const added = await addCans(id, flavour, quantity);
    return {
        status: 201,
        body: { cart: cartJson(added.crate), added: { flavour, slots: added.slots }, stock_left: added.stockLeft },
    };
}
export async function removeFromCart(ctx) {
    const id = await crateId(ctx);
    const slot = Number(ctx.params[0]);
    if (!Number.isInteger(slot) || slot < 0 || slot >= CRATE_SIZE)
        throw notFound();
    const removed = await removeCan(id, slot);
    return { status: 200, body: { cart: cartJson(removed.crate), stock_left: removed.stockLeft } };
}
export async function patchCart(ctx) {
    const id = await crateId(ctx);
    const pricing = await loadPricing();
    const fields = {};
    const province = ctx.body.province === undefined ? undefined : str(ctx.body, "province");
    if (ctx.body.province !== undefined && (!province || !pricing.provinces.some((p) => p.code === province))) {
        fields.province = "We don't ship to that province yet.";
    }
    const subscribe = ctx.body.subscribe === undefined ? undefined : bool(ctx.body, "subscribe");
    if (ctx.body.subscribe !== undefined && subscribe === undefined)
        fields.subscribe = "Turn subscribe and save on or off.";
    const cadenceText = ctx.body.cadence === undefined ? undefined : str(ctx.body, "cadence");
    if (ctx.body.cadence !== undefined && cadenceText !== "monthly" && cadenceText !== "bimonthly") {
        fields.cadence = "Deliver every month or every two months.";
    }
    if (Object.keys(fields).length > 0)
        throw validation(fields);
    const crate = await updateCrate(id, { province, subscribe, cadence: cadenceText });
    return { status: 200, body: { cart: cartJson(crate) } };
}
// ---- reviews ------------------------------------------------------------------------------
const firstName = (name) => name.trim().split(/\s+/)[0] ?? "";
function reviewJson(r) {
    return {
        id: r.id,
        rating: r.rating,
        body: r.body,
        author_first_name: r.author_first_name,
        created_at: new Date(r.created.replace(" ", "T")).toISOString(),
    };
}
async function knownFlavour(slug) {
    const [found] = await query("SELECT 1 FROM flavours WHERE slug = $1", [slug]);
    if (!found)
        throw notFound();
}
export async function listReviews(ctx) {
    await knownFlavour(ctx.params[0]);
    const approved = await reviews(`flavour=${literal(ctx.params[0])} && status='approved'`);
    return { status: 200, body: { reviews: approved.map(reviewJson) } };
}
export async function postReview(ctx) {
    const user = await signedIn(ctx);
    const slug = ctx.params[0];
    await knownFlavour(slug);
    allow(user, CUSTOMER);
    const [bought] = await query(`SELECT 1 FROM orders o JOIN order_lines l ON l.order_number = o.number
     WHERE o.user_id = $1 AND o.status <> 'pending_payment' AND l.flavour = $2 LIMIT 1`, [user.id, slug]);
    if (!bought)
        throw new ApiError(403, "not_a_buyer", "Only customers who bought this flavour can review it.");
    const mine = await reviews(`flavour=${literal(slug)} && user=${literal(user.id)}`);
    if (mine.length > 0)
        throw new ApiError(409, "already_reviewed", "You've already reviewed this flavour.");
    const rating = int(ctx.body, "rating");
    const body = str(ctx.body, "body")?.trim();
    const fields = {};
    if (rating === undefined || rating < 1 || rating > 5)
        fields.rating = "Choose a rating from 1 to 5.";
    if (!body || body.length < 10 || body.length > 1000)
        fields.body = "Write 10 to 1,000 characters.";
    if (rating === undefined || !body || Object.keys(fields).length > 0)
        throw validation(fields);
    const review = await createReview({ flavour: slug, user: user.id, author_first_name: firstName(user.name), rating, body });
    return { status: 201, body: { review: { id: review.id, status: "pending" } } };
}
// ---- stockists ----------------------------------------------------------------------------
const EARTH_RADIUS_KM = 6371;
function distanceKm(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
export async function stockists(ctx) {
    const all = await query("SELECT name, address, city, province, lat, lng FROM stockists ORDER BY name");
    const latText = ctx.url.searchParams.get("lat");
    const lngText = ctx.url.searchParams.get("lng");
    if (latText === null && lngText === null) {
        return { status: 200, body: { stockists: all.map((s) => ({ ...s, distance_km: null })) } };
    }
    const lat = Number(latText);
    const lng = Number(lngText);
    const fields = {};
    if (latText === null || latText.trim() === "" || !Number.isFinite(lat) || lat < -90 || lat > 90)
        fields.lat = "Latitude runs from -90 to 90.";
    if (lngText === null || lngText.trim() === "" || !Number.isFinite(lng) || lng < -180 || lng > 180)
        fields.lng = "Longitude runs from -180 to 180.";
    if (Object.keys(fields).length > 0)
        throw validation(fields);
    const ranked = all
        .map((s) => ({ s, d: distanceKm(lat, lng, s.lat, s.lng) }))
        .sort((a, b) => a.d - b.d || (a.s.name < b.s.name ? -1 : 1))
        .slice(0, 5)
        .map(({ s, d }) => ({ ...s, distance_km: Math.round(d * 10) / 10 }));
    return { status: 200, body: { stockists: ranked } };
}
// ---- live feed ----------------------------------------------------------------------------
const listeners = new Set();
/** Each stream ends after this long; the browser reconnects within RETRY_MS and the page catches up on reopen. */
const STREAM_MS = 20_000;
const RETRY_MS = 1_000;
export function openLive(res) {
    if (!realtimeUp())
        throw accountsUnavailable();
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(`retry: ${RETRY_MS}\n\n`);
    listeners.add(res);
    const recycle = setTimeout(() => res.end(), STREAM_MS);
    res.on("close", () => {
        clearTimeout(recycle);
        listeners.delete(res);
    });
}
function broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners)
        res.write(frame);
}
/** Fans PocketBase realtime changes for this process's scope out to open storefront pages. */
export function relayRealtime(event) {
    const record = event.record;
    if (record.scope !== config.database)
        return;
    if (event.collection === "stock_levels") {
        broadcast("stock", { flavour: String(record.flavour), stock_left: Number(record.stock_left) });
    }
    else if (record.status === "approved") {
        broadcast("review", {
            flavour: String(record.flavour),
            review: reviewJson({
                id: String(record.id),
                rating: Number(record.rating),
                body: String(record.body),
                author_first_name: String(record.author_first_name),
                created: String(record.created),
            }),
        });
    }
}
export function liveHeartbeat() {
    for (const res of listeners)
        res.write(": keep-alive\n\n");
}
export function closeLive() {
    for (const res of listeners)
        res.end();
    listeners.clear();
}
