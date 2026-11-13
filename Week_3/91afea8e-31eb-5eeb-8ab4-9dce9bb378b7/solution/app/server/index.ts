import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { isPageRoute } from "../shared/routes.js";
import { config } from "./config.js";
import { one } from "./db.js";
import { unknownApiRoute } from "./http.js";
import { startJobs } from "./jobs.js";
import { registerAccount } from "./routes/account.js";
import { accountView, registerAuth } from "./routes/auth.js";
import { registerCart } from "./routes/cart.js";
import { registerCatalogue } from "./routes/catalogue.js";
import { registerOrders } from "./routes/orders.js";
import { registerSeller } from "./routes/seller.js";
import { registerSharing } from "./routes/sharing.js";
import { registerSupport } from "./routes/support.js";
import { applySchema } from "./schema.js";
import { COOKIE, parseCookies, resolveActor, type Role } from "./session.js";
import { seed } from "./seed.js";
import { prepareBucket } from "./services/s3.js";

const CLIENT_ROOT = "./dist/client";
let ready = false;

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "same-origin");
});

app.get("/api/health", (c) => (ready ? c.json({ status: "ok" }) : c.json({ status: "starting" }, 503)));

registerAuth(app);
registerAccount(app);
registerCatalogue(app);
registerCart(app);
registerSharing(app);
registerOrders(app);
registerSeller(app);
registerSupport(app);
app.all("/api/*", unknownApiRoute);

app.use("/assets/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
});
app.use("*", serveStatic({ root: CLIENT_ROOT }));

const indexHtml = readFileSync(`${CLIENT_ROOT}/index.html`, "utf8");

/** What the page needs to know about the visitor, so the browser never probes `/api/me` as a stranger. */
async function bootState(cookieHeader: string | undefined): Promise<Record<string, unknown>> {
  const cookies = parseCookies(cookieHeader);
  try {
    const actor = await resolveActor(cookies[COOKIE.access], Date.now());
    if (actor) {
      const account = await one<{ id: string; name: string; first_name: string; role: Role; balance_paise: number }>(
        "SELECT id, name, first_name, role, balance_paise FROM accounts WHERE id = $1",
        [actor.accountId],
      );
      if (account) return { account: accountView(account), balance_paise: account.balance_paise };
    }
  } catch {
    return { probe: true };
  }
  return cookies[COOKIE.session] ? { probe: true } : { guest: true };
}

app.get("*", async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.includes(".")) return c.notFound();
  const boot = JSON.stringify(await bootState(c.req.header("cookie"))).replace(/</g, "\\u003c");
  return c.html(indexHtml.replace("__BOOT__", boot), isPageRoute(path) ? 200 : 404);
});

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" });

async function prepare(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      await seed();
      ready = true;
      break;
    } catch (error) {
      console.error("waiting for Postgres", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await prepareBucket();
  startJobs();
}

void prepare();
