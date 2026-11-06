import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentUser } from "./context.js";
import { ApiError, checkOrigin, JSON_LIMIT, notFound, parseMultipart, readBody, readJson, sendError, sendJson, unsupportedType, UPLOAD_LIMIT, } from "./http.js";
import * as accounts from "./routes/accounts.js";
import * as applications from "./routes/applications.js";
import * as checkout from "./routes/checkout.js";
import * as owner from "./routes/owner.js";
import * as staff from "./routes/staff.js";
import * as storefront from "./routes/storefront.js";
import * as subscriptions from "./routes/subscriptions.js";
const route = (method, pattern, handle, body = method === "GET" || method === "DELETE" ? "none" : "json") => ({
    method,
    path: new RegExp(`^${pattern.replace(/:[a-z]+/g, "([^/]+)")}$`),
    body,
    handle,
});
const ROUTES = [
    route("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } })),
    route("POST", "/api/auth/sign-up", accounts.signUp),
    route("POST", "/api/auth/sign-in", accounts.signIn),
    route("POST", "/api/auth/sign-out", accounts.signOut),
    route("GET", "/api/me", accounts.me),
    route("GET", "/api/addresses", accounts.listAddresses),
    route("POST", "/api/addresses", accounts.createAddress),
    route("PATCH", "/api/addresses/:id", accounts.updateAddress),
    route("GET", "/api/flavours", storefront.listFlavours),
    route("GET", "/api/flavours/:slug/reviews", storefront.listReviews),
    route("POST", "/api/flavours/:slug/reviews", storefront.postReview),
    route("POST", "/api/quote", storefront.quote),
    route("GET", "/api/cart", storefront.getCart),
    route("PATCH", "/api/cart", storefront.patchCart),
    route("POST", "/api/cart/items", storefront.addToCart),
    route("DELETE", "/api/cart/items/:slot", storefront.removeFromCart),
    route("POST", "/api/checkout", checkout.checkout),
    route("GET", "/api/orders", checkout.listOrders),
    route("GET", "/api/orders/:number", checkout.getOrder),
    route("GET", "/api/orders/:number/invoice\\.pdf", checkout.invoicePdf),
    route("GET", "/api/subscriptions", subscriptions.listSubscriptions),
    route("GET", "/api/subscriptions/:id", subscriptions.getSubscription),
    route("POST", "/api/subscriptions/:id/changes", subscriptions.requestChange),
    route("GET", "/api/subscriptions/:id/changes/:change", subscriptions.getChange),
    route("PUT", "/api/subscriptions/:id/card", subscriptions.updateCard),
    route("GET", "/api/stockists", storefront.stockists),
    route("POST", "/api/retailer-applications", applications.submitApplication, "multipart"),
    route("GET", "/api/retailer-applications/:id", applications.getApplication),
    route("GET", "/api/staff/status", staff.status),
    route("GET", "/api/staff/queue", staff.queue),
    route("POST", "/api/staff/orders/:number/transitions", staff.transition),
    route("GET", "/api/staff/orders/:number", staff.staffOrderDetail),
    route("GET", "/api/staff/orders/:number/packing-slip\\.pdf", staff.packingSlip),
    route("GET", "/api/staff/stock", staff.stock),
    route("GET", "/api/staff/search", staff.search),
    route("POST", "/api/staff/orders/:number/refunds", staff.refund),
    route("POST", "/api/staff/orders/:number/resend-receipt", staff.resendReceipt),
    route("GET", "/api/owner/settings", owner.settings),
    route("PUT", "/api/owner/provinces/:code", owner.updateProvince),
    route("PUT", "/api/owner/drop", owner.updateDrop),
    route("GET", "/api/owner/dashboard", owner.dashboard),
    route("GET", "/api/owner/applications", owner.listApplications),
    route("GET", "/api/owner/applications/:id/licence", owner.licence),
    route("POST", "/api/owner/applications/:id/decision", owner.decideApplication),
    route("GET", "/api/owner/reviews", owner.pendingReviews),
    route("POST", "/api/owner/reviews/:id/decision", owner.decideReviewRoute),
];
/** A path parameter as text; null when it is not valid percent-encoding or holds a control character (it names nothing). */
function pathParam(raw) {
    try {
        const text = decodeURIComponent(raw);
        return /[\u0000-\u001f\u007f]/.test(text) ? null : text;
    }
    catch {
        return null;
    }
}
async function api(req, res, url) {
    try {
        checkOrigin(req);
        if (url.pathname === "/api/live" && req.method === "GET") {
            storefront.openLive(res);
            return;
        }
        let raw = [];
        const matched = ROUTES.find((r) => {
            const m = r.method === req.method ? r.path.exec(url.pathname) : null;
            if (m)
                raw = m.slice(1).map(pathParam);
            return m !== null;
        });
        const params = raw.filter((p) => p !== null);
        if (!matched || params.length < raw.length) {
            await readBody(req, JSON_LIMIT).catch(() => undefined);
            throw notFound();
        }
        const ctx = { req, res, url, params, body: {} };
        if (matched.body === "json")
            ctx.body = await readJson(req);
        if (matched.body === "multipart") {
            const raw = await readBody(req, UPLOAD_LIMIT);
            const type = req.headers["content-type"] ?? "";
            if (!type.toLowerCase().startsWith("multipart/form-data"))
                throw unsupportedType("Send the application as multipart/form-data.");
            ctx.form = parseMultipart(raw, type);
        }
        const reply = await matched.handle(ctx);
        if (reply.file) {
            res.writeHead(reply.status, {
                "Content-Type": reply.file.type,
                "Content-Length": reply.file.data.length,
                "Content-Disposition": `inline; filename="${reply.file.name}"`,
                "Cache-Control": "private, no-store",
            });
            res.end(reply.file.data);
            return;
        }
        sendJson(res, reply.status, reply.body);
    }
    catch (error) {
        if (error instanceof ApiError) {
            sendError(res, error);
            return;
        }
        console.error(`${req.method} ${url.pathname} failed:`, error instanceof Error ? error.message : "unknown error");
        sendError(res, new ApiError(500, "internal", "Something went wrong on our side. Try again in a moment."));
    }
}
// ---- pages and assets ---------------------------------------------------------------------
const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
const TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
};
const PAGES = [
    /^\/$/,
    /^\/box$/,
    /^\/flavours\/(guava-lime|yuzu-ginger|passionfruit-basil|cacao-orange)$/,
    /^\/checkout$/,
    /^\/orders\/CB-\d{6}\/thanks$/,
    /^\/account$/,
    /^\/account\/subscriptions\/[^/]+(\/(pause|swap|cancel|card))?$/,
    /^\/sign-in$/,
    /^\/sign-up$/,
    /^\/stockists$/,
    /^\/stockists\/apply$/,
    /^\/stockists\/applications\/[^/]+$/,
    /^\/office(\/(queue|stock|search|dashboard|settings|applications|reviews))?$/,
    /^\/office\/orders\/CB-\d{6}$/,
];
const SIGNED_IN_ONLY = /^\/(account|office|checkout|orders)(\/|$)/;
let shell = null;
async function page(req, res, url) {
    const pathname = url.pathname;
    if (pathname.startsWith("/assets/") || pathname.startsWith("/fonts/") || pathname === "/favicon.svg") {
        const decoded = pathParam(pathname);
        const file = decoded === null ? "" : path.resolve(CLIENT, `.${decoded}`);
        const ext = path.extname(file);
        if (file.startsWith(`${CLIENT}${path.sep}`) && TYPES[ext] && !file.endsWith(".map")) {
            try {
                const data = await readFile(file);
                res.writeHead(200, { "Content-Type": TYPES[ext], "Cache-Control": "public, max-age=31536000, immutable" });
                res.end(data);
                return;
            }
            catch {
                // falls through to the 404 below
            }
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
    }
    const known = PAGES.some((p) => p.test(pathname));
    if (known && SIGNED_IN_ONLY.test(pathname)) {
        const user = await currentUser(req).catch(() => "store_down");
        if (user === null) {
            res.writeHead(302, { Location: `/sign-in?next=${encodeURIComponent(pathname)}` });
            res.end();
            return;
        }
    }
    shell ??= await readFile(path.join(CLIENT, "index.html"));
    res.writeHead(known ? 200 : 404, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(shell);
}
const SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
};
export async function handle(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS))
        res.setHeader(name, value);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
        await api(req, res, url);
        return;
    }
    await page(req, res, url);
}
