import { createServer } from "node:http";
import { clearedSessionCookie, sessionCookie, signIn, signOut, userJson } from "./auth.js";
import { registerBilling } from "./billing.js";
import { config } from "./config.js";
import { registerCredentials } from "./credentials.js";
import { pool } from "./db.js";
import { ApiError, validation } from "./errors.js";
import { Router, ok, send, sendError } from "./http.js";
import { registerInvoices } from "./invoices.js";
import { CHARGE_RETRY_MS, postPendingCharges } from "./killbill.js";
import { EMAIL_RETRY_MS, flushEmails } from "./mail.js";
import { registerRequests } from "./requests.js";
import { applySchema } from "./schema.js";
import { registerSeats } from "./seats.js";
import { registerStaffing } from "./staffing.js";
import { serveStatic } from "./static.js";

const router = new Router();

router.open("GET", "/api/health", async () => ok({ status: "ok" }));

router.open("POST", "/api/session", async (ctx) => {
  ctx.sameOrigin();
  const body = ctx.json();
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    throw validation({
      ...(typeof email === "string" && email ? {} : { email: "Enter your email." }),
      ...(typeof password === "string" && password ? {} : { password: "Enter your password." }),
    });
  }
  const session = await signIn(email.trim(), password);
  if (!session) throw new ApiError("invalid_credentials", "Email or password is incorrect.");
  return { status: 200, json: { user: userJson(session.user) }, headers: { "Set-Cookie": sessionCookie(session.token) } };
});

router.on("GET", "/api/me", async (ctx) => ok({ user: userJson(ctx.user) }));

router.on("DELETE", "/api/session", async (ctx) => {
  ctx.sameOrigin();
  if (ctx.sessionToken) await signOut(pool, ctx.sessionToken);
  return { status: 204, headers: { "Set-Cookie": clearedSessionCookie } };
});

registerRequests(router);
registerStaffing(router);
registerSeats(router);
registerBilling(router);
registerInvoices(router);
registerCredentials(router);

await applySchema();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://relay.invalid");
  const reply = url.pathname.startsWith("/api/") ? router.dispatch(req, url) : serveStatic(url.pathname);
  reply.then(
    (r) => send(res, r),
    (error: unknown) => sendError(res, error),
  );
});

server.listen(config.port, "0.0.0.0", () => console.log(`Crosshand Relay serving on 0.0.0.0:${config.port}`));

// Queued email and pending charges are retried from every running instance.
setInterval(flushEmails, EMAIL_RETRY_MS);
setInterval(() => void postPendingCharges(), CHARGE_RETRY_MS);
flushEmails();
void postPendingCharges();
