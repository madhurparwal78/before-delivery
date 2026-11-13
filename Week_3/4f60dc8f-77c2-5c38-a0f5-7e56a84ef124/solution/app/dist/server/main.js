// Entry point: binds the port at once, prepares Postgres, PocketBase and Meilisearch in the background, and serves pages and the API.
import { createServer } from "node:http";
import { config } from "./config.js";
import { prepareContent, publishedContent } from "./content.js";
import { ensureSchema, pool } from "./db.js";
import { isUuid } from "./domain/engagements.js";
import { startMeasurementWorker } from "./domain/measurement.js";
import { startOverdueCheck } from "./domain/invoices.js";
import { reviewTokenLive } from "./domain/review.js";
import { clientBrand } from "./domain/sessions.js";
import { dispatchApi, parseCookies, redirect, sendPage, serveAsset } from "./http.js";
import { startOutbox } from "./outbox.js";
import { rebuildIndex } from "./search.js";
import { seed } from "./seed.js";
import "./routes/public.js";
import "./routes/client.js";
import "./routes/studio.js";
const prepare = () => ensureSchema(seed);
async function servePage(req, res, url) {
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/")
        return sendPage(res, 200, {}, await publishedContent().catch(() => null));
    if (["/start", "/sign-in", "/studio"].includes(path) || /^\/studio\/engagements\/[^/]+$/.test(path))
        return sendPage(res, 200);
    const work = /^\/work\/([^/]+)$/.exec(path);
    if (work) {
        const content = await publishedContent().catch(() => null);
        const slug = decodeURIComponent(work[1] ?? "");
        return sendPage(res, !content || content.case_studies.some((s) => s.slug === slug) ? 200 : 404, {}, content);
    }
    const review = /^\/review\/([^/]+)$/.exec(path);
    if (review) {
        await prepare();
        return sendPage(res, (await reviewTokenLive(review[1] ?? "", new Date())) ? 200 : 404, { "Referrer-Policy": "no-referrer" });
    }
    const owned = /^\/(?:account\/engagements|rig)\/([^/]+)$/.exec(path);
    if (path === "/account" || owned) {
        await prepare();
        const brandId = await clientBrand(parseCookies(req.headers.cookie));
        if (!brandId)
            return redirect(res, `/sign-in?next=${encodeURIComponent(url.pathname + url.search)}`);
        if (owned) {
            const id = owned[1] ?? "";
            const mine = isUuid(id) && (await pool.query("SELECT 1 FROM engagements WHERE id = $1 AND brand_id = $2", [id, brandId])).rowCount === 1;
            return sendPage(res, mine ? 200 : 404);
        }
        return sendPage(res, 200);
    }
    return sendPage(res, 404);
}
const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handle = async () => {
        if (url.pathname.startsWith("/api/")) {
            if (url.pathname !== "/api/health")
                await prepare();
            return dispatchApi(req, res, url);
        }
        if ((req.method === "GET" || req.method === "HEAD") && serveAsset(url.pathname, res))
            return;
        return servePage(req, res, url);
    };
    handle().catch((error) => {
        console.error(error);
        if (!res.headersSent) {
            res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "unavailable", message: "The studio is starting up. Please try again in a moment." }));
        }
    });
});
server.requestTimeout = 0;
server.listen(config.port, "0.0.0.0", () => console.log(`Gloamwork Shot Rig listening on ${config.port}`));
/** Retries a preparation step every few seconds until it succeeds; a service down at boot never stops the app. */
function untilReady(step, every) {
    step().catch(() => setTimeout(() => untilReady(step, every), every).unref());
}
untilReady(prepare, 2_000);
untilReady(async () => {
    await prepareContent();
    await rebuildIndex();
}, 3_000);
setInterval(() => void rebuildIndex().catch(() => undefined), 60_000).unref();
startOutbox();
startMeasurementWorker();
startOverdueCheck();
