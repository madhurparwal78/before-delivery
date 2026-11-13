// Entry point: listens at once (health answers immediately), then applies the schema, seed,
// PocketBase collections and Kill Bill catalog in the background, retrying any provider that is
// down until it answers (brief: Deployment; Server boundary › Booting with a provider down).
import { createServer } from "node:http";
import { config } from "./config.js";
import { migrate } from "./db.js";
import { ApiError, errorBody, fail, prepare, send } from "./http.js";
import { router } from "./routes.js";
import { serveStatic } from "./static.js";
import { seedDatabase, seedStorage } from "./seed.js";
import { AccountsUnreachable, ensureAccountsSetup } from "./pocketbase.js";
import { BillingUnreachable } from "./killbill.js";
import { StorageUnreachable } from "./storage.js";
import { ensureCatalog } from "./catalog.js";
import { publishDue } from "./curator.js";
import { runDunning } from "./membership.js";
import { deliverQueued } from "./mail.js";
function asApiError(error) {
    if (error instanceof ApiError)
        return error;
    if (error instanceof BillingUnreachable)
        return fail.billing();
    if (error instanceof StorageUnreachable)
        return fail.storage();
    if (error instanceof AccountsUnreachable)
        return fail.accounts();
    console.error(error);
    return new ApiError(500, "internal_error", "Something went wrong on our side. Please try again.");
}
async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD")
            return send(res, { status: 404, body: errorBody(fail.notFound()) });
        return serveStatic(url.pathname, res, req.method === "HEAD");
    }
    try {
        const matched = router.match(req.method ?? "GET", url.pathname);
        if (!matched)
            throw fail.notFound();
        const ctx = await prepare(req, url, matched.route.kind, matched.params);
        send(res, await matched.route.handler(ctx));
    }
    catch (error) {
        const apiError = asApiError(error);
        send(res, { status: apiError.status, body: errorBody(apiError) });
    }
}
const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
        console.error(error);
        if (!res.headersSent)
            send(res, { status: 500, body: errorBody(new ApiError(500, "internal_error", "Something went wrong on our side. Please try again.")) });
    });
});
server.listen(config.port, "0.0.0.0", () => console.log(`Sightline listening on 0.0.0.0:${config.port}`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Retries `task` every few seconds until it succeeds once. */
async function untilDone(name, task) {
    for (;;) {
        try {
            await task();
            console.log(`${name}: ready`);
            return;
        }
        catch (error) {
            console.warn(`${name}: not ready (${error instanceof Error ? error.message : String(error)}); retrying`);
            await sleep(5000);
        }
    }
}
/** Runs `task` every `everyMs`, never overlapping itself; failures wait for the next tick. */
function every(everyMs, task) {
    let running = false;
    setInterval(() => {
        if (running)
            return;
        running = true;
        task()
            .catch(() => undefined)
            .finally(() => (running = false));
    }, everyMs);
}
await untilDone("database", async () => {
    await migrate();
    await seedDatabase();
});
void untilDone("accounts", ensureAccountsSetup);
void untilDone("billing catalog", ensureCatalog);
void untilDone("storage seed", seedStorage);
every(1000, publishDue);
every(1000, runDunning);
every(2000, deliverQueued);
