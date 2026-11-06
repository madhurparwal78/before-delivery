// Lanternline Handshake Desk: one origin for the API and every screen.
import { createServer } from "node:http";
import { config } from "./config.js";
import { migrate, pool } from "./db.js";
import { Router, dispatch, write } from "./http.js";
import { startJobs } from "./jobs.js";
import { page } from "./pages.js";
import { seed } from "./seed.js";
import { loadWorkspaces } from "./workspaces.js";
import { registerCases } from "./routes/cases.js";
import { registerCounterparties } from "./routes/counterparties.js";
import { registerMessages } from "./routes/messages.js";
import { registerMonths } from "./routes/months.js";
import { registerPartner } from "./routes/partner.js";
import { registerPublic, sitemap } from "./routes/public.js";
import { registerReview } from "./routes/review.js";
import { registerRules } from "./routes/rules.js";
import { registerSession } from "./routes/session.js";

const SECURITY_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      console.error("waiting for PostgreSQL", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await seed();
  await loadWorkspaces();
  startJobs();

  const router = new Router();
  router.add("GET", "/api/health", async () => ({ status: 200, json: { status: "ok" } }));
  for (const register of [registerSession, registerPublic, registerRules, registerCounterparties, registerCases, registerReview,
    registerMessages, registerMonths, registerPartner]) {
    register(router);
  }

  createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const url = new URL(req.url ?? "/", "http://desk.invalid");
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      void dispatch(router, req, res, url);
      return;
    }
    req.resume();
    const reply = url.pathname === "/sitemap.xml"
      ? sitemap().then((xml) => ({ status: 200, body: xml, headers: { "Content-Type": "application/xml; charset=utf-8" } }))
      : page(url.pathname);
    reply.then((r) => write(res, r)).catch((error: unknown) => {
      console.error(`page ${url.pathname} failed`, error);
      write(res, { status: 500, body: "The desk could not answer.", headers: { "Content-Type": "text/plain; charset=utf-8" } });
    });
  }).listen(config.port, "0.0.0.0", () => console.log(`Lanternline Handshake Desk on ${config.publicUrl}`));
}

main().catch((error: unknown) => {
  console.error("the desk failed to start", error);
  process.exit(1);
});
