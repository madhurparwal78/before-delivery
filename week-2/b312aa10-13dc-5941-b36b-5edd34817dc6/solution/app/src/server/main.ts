import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { migrate, pool, tx } from "./db.js";
import { apiError, variantError, handle, loadClient, refuseInvalid, route } from "./http.js";
import { BODIES, REQUIRED, bodyObject, keyErrors } from "./bodies.js";
import { EMAIL } from "./text.js";
import "./inspector.js";
import { authenticate, clearedCookie, sessionBody, sessionCookie, signIn, signOut } from "./auth.js";
import { seed } from "./seed.js";
import { applyDueLapses } from "./states.js";
import { deliverBilling, probeBilling } from "./billing.js";
import { deliverMail, listenForMail } from "./mail.js";
import { probeStorage } from "./storage.js";
import { markService, onServiceReturn, serviceUp } from "./status.js";
import { queueExpiryNotices, storePendingSeedObjects } from "./documents.js";
import { queuedStorageCount, storeQueuedReports } from "./sanitation.js";
import { kitchenBody } from "./kitchen.js";
import "./bookings.js";
import "./invoices.js";
import "./reports.js";

route("GET", "/api/health", async () => ({ status: 200, body: { status: "ok" } }), { auth: false });

route("POST", "/api/session", async (ctx) => {
  const body = bodyObject(ctx.body);
  const errors = keyErrors(Object.keys(body), BODIES.session);
  const { email, password } = body;
  if (!errors.email && (typeof email !== "string" || !EMAIL.test(email.trim()))) errors.email = "Enter a valid email address.";
  // The brief words a missing password like one that is not text.
  if (errors.password === REQUIRED || typeof password !== "string" || password === "") errors.password = "Enter your password.";
  refuseInvalid(errors);
  const result = await signIn(email as string, password as string, ctx.headers.cookie);
  if (result.kind === "throttled") {
    throw variantError(429, "rate_limited", [Math.ceil(result.retryAfterSeconds / 60)], {}, { "Retry-After": String(result.retryAfterSeconds) });
  }
  if (result.kind === "invalid") throw apiError(401, "invalid_credentials");
  return { status: 200, body: sessionBody(result.session), headers: { "Set-Cookie": sessionCookie(result.token) } };
}, { auth: false });

route("GET", "/api/session", async (ctx) => ({ status: 200, body: sessionBody(ctx.session!) }));

route("DELETE", "/api/session", async (ctx) => {
  await signOut(ctx.headers.cookie);
  return { status: 204, headers: { "Set-Cookie": clearedCookie } };
});

route("GET", "/api/service-status", async (ctx) => {
  const kitchen = ctx.session!.kitchen.id;
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM billing_items WHERE kitchen_id = $1 AND recorded_at IS NULL",
    [kitchen],
  );
  return {
    status: 200,
    body: {
      billing: serviceUp("billing") ? "up" : "down", storage: serviceUp("storage") ? "up" : "down",
      queued: { billing: rows[0].n, storage: await queuedStorageCount(kitchen) },
    },
  };
});

const MONITOR_MS = 5000;
const MAIL_MS = 2000;

async function storageWork(): Promise<void> {
  await storePendingSeedObjects();
  await storeQueuedReports();
}

function background(name: string, work: () => Promise<void>): void {
  work().catch((error: Error) => console.error(`${name}: ${error.message}`));
}

async function monitor(): Promise<void> {
  const [billing, storage] = await Promise.all([probeBilling(), probeStorage()]);
  markService("billing", billing);
  markService("storage", storage);
  if (billing) await deliverBilling();
  if (storage) await storageWork();
}

async function sweep(): Promise<void> {
  await applyDueLapses(pool, null);
  await tx((client) => queueExpiryNotices(client, null));
  await pool.query("DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'");
}

async function main(): Promise<void> {
  await migrate();
  await seed();
  await loadClient(join(dirname(fileURLToPath(import.meta.url)), "client"), async (cookieHeader) => {
    const session = await authenticate(cookieHeader);
    return session && { session: sessionBody(session), kitchen: await kitchenBody(pool, session) };
  });
  createServer((req, res) => void handle(req, res)).listen(config.port, "0.0.0.0", () => {
    console.log(`Lineboard listening on ${config.port}`);
  });
  onServiceReturn((service) => background(`${service} recovery`, service === "billing" ? deliverBilling : storageWork));
  background("monitor", monitor);
  background("notices", () => tx((client) => queueExpiryNotices(client, null)));
  setInterval(() => background("monitor", monitor), MONITOR_MS);
  background("mail listener", listenForMail);
  setInterval(() => background("mail", deliverMail), MAIL_MS);
  setInterval(() => background("sweep", sweep), config.sweepSeconds * 1000);
}

main().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
