import { Pool } from "pg";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp, type AppCtx } from "./app.js";
import { loadConfig, lisbonSlotInstant } from "./config.js";
import { migrate, hashPassword } from "./db.js";
import { Idempotency } from "./idempotency.js";
import { Valkey } from "./valkey.js";
import { KillBill } from "./killbill.js";
import { Mailer, lapsedEmail, queueEmail } from "./mailer.js";
import { now } from "./clock.js";
import { flushPendingEvents, publishEvent } from "./events.js";
import { offerFreedTable } from "./routes/actions.js";
import { tableIdsForTarget } from "./floor.js";
import { HOST_ACCOUNT_EMAIL, HOST_ACCOUNT_NAME, HOST_ACCOUNT_PASSWORD } from "./seed-host.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = new Pool({ connectionString: cfg.databaseUrl });

  // Wait up to 60 seconds for Postgres; exit non-zero if it never answers.
  const deadline = Date.now() + 60_000;
  let connected = false;
  while (Date.now() < deadline) {
    try {
      await pool.query("SELECT 1");
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!connected) {
    console.error("Postgres never answered");
    process.exit(1);
  }

  // Apply schema and seed data idempotently on every serve.
  await migrate(pool);
  await pool.query(
    `INSERT INTO hosts (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash`,
    [HOST_ACCOUNT_EMAIL, HOST_ACCOUNT_NAME, hashPassword(HOST_ACCOUNT_PASSWORD)],
  );

  const valkey = new Valkey(cfg);
  const killbill = new KillBill(cfg);
  const idem = new Idempotency(pool);
  const mailer = new Mailer(cfg);
  void mailer.start(pool);

  const ctx: AppCtx = { pool, valkey, killbill, idem, cfg, mailer };
  const app = createApp(ctx);

  // Serve only built assets and the API.
  app.use(express.static(distClientDir(), { index: false, fallthrough: true }));
  // The host floor page needs a session cookie to render; without one it goes to
  // sign-in with next and without ended. Whether the session is live stays the
  // server's rule, checked on every host API call.
  app.get(/^\/host\/?$/, (req, res) => {
    const cookie = req.headers.cookie ?? "";
    if (!/(?:^|;\s*)host_session=[^;]+/.test(cookie)) {
      const next = encodeURIComponent(`${req.path}${req.url.includes("?") ? `?${req.url.split("?")[1]}` : ""}`);
      res.redirect(302, `/host/sign-in?next=${next}`);
      return;
    }
    res.sendFile(htmlFor(req.path));
  });
  // Only the known pages are served; anything else answers 404 so no source,
  // lockfile, run.json or .env path is ever reachable.
  app.get(/^\/(?!\/api).*/, (req, res) => {
    if (!isPagePath(req.path)) {
      res.status(404).sendFile(htmlFor("/not-found"));
      return;
    }
    res.sendFile(htmlFor(req.path));
  });

  // Dependency probing: at least every 10 seconds.
  setInterval(() => { void valkey.ping(); }, 5_000);
  setInterval(() => { void killbill.ping(); }, 5_000);

  // Expiry loop: holds and offers end at their server expiry.
  setInterval(() => { void sweepExpiries(ctx); }, 1_000);

  const server = app.listen(cfg.publicPort, "0.0.0.0", () => {
    console.log(`listening on 0.0.0.0:${cfg.publicPort}`);
  });
  server.headersTimeout = 65_000;
  server.requestTimeout = 0;

  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
}

function distClientDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "client");
}

function htmlFor(path: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const name = pageFor(path);
  return join(here, "..", "client", `${name}.html`);
}

function pageFor(path: string): string {
  if (path === "/" || path === "") return "home";
  if (path === "/book") return "book";
  if (path === "/waitlist") return "waitlist";
  if (path.startsWith("/offer/")) return "offer";
  if (path.startsWith("/manage/")) return "manage";
  if (path === "/host/sign-in") return "host-signin";
  if (path === "/host") return "host";
  return "notfound";
}

/** Whether the path is one of the published pages (and nothing else). */
function isPagePath(path: string): boolean {
  return pageFor(path) !== "notfound";
}

/** Hold expiry, offer lapse and recovery processing. */
async function sweepExpiries(ctx: AppCtx): Promise<void> {
  const { pool, valkey, killbill, cfg } = ctx;
  const t = now();

  // Holds: within two seconds after expires_at, mark expired, remove claims, publish.
  const due = await pool.query(
    `SELECT hold_id, table_id, date, time, party_size, expires_at FROM holds
     WHERE status = 'live' AND expires_at <= $1 LIMIT 20`, [t],
  );
  for (const h of due.rows) {
    const client = await pool.connect();
    let updated = false;
    try {
      await client.query("BEGIN");
      const upd = await client.query(
        `UPDATE holds SET status = 'expired' WHERE hold_id = $1 AND status = 'live' RETURNING hold_id`,
        [h.hold_id],
      );
      await client.query("COMMIT");
      updated = upd.rows.length > 0;
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
    } finally {
      client.release();
    }
    if (updated) {
      const start = lisbonSlotInstant(h.date, h.time);
      await valkey.releaseOwned(tableIdsForTarget(h.table_id), start, h.party_size, h.hold_id).catch(() => undefined);
      await publishEvent(pool, valkey, {
        type: "hold.expired", date: h.date, time: h.time,
        table_ids: tableIdsForTarget(h.table_id), party_size: h.party_size,
      }).catch(() => undefined);
      // The table freed: offer it to the waitlist.
      await offerFreedTable(pool, valkey, killbill, cfg, h.date, tableIdsForTarget(h.table_id), now()).catch(() => undefined);
    }
  }

  // Offers: within two seconds after expires_at, lapse and offer to the next entry.
  const dueOffers = await pool.query(
    `SELECT o.offer_id, o.token, o.entry_id, o.table_id, o.date, o.time, o.party_size, o.expires_at,
            w.email_lower
     FROM offers o JOIN waitlist_entries w ON w.entry_id = o.entry_id
     WHERE o.status = 'offered' AND o.expires_at <= $1 LIMIT 20`, [t],
  );
  for (const o of dueOffers.rows) {
    const client = await pool.connect();
    let lapsed = false;
    try {
      await client.query("BEGIN");
      const upd = await client.query(
        `UPDATE offers SET status = 'lapsed' WHERE offer_id = $1 AND status = 'offered' RETURNING offer_id`,
        [o.offer_id],
      );
      if (upd.rows.length > 0) {
        await client.query(`UPDATE waitlist_entries SET status = 'lapsed' WHERE entry_id = $1 AND status = 'offered'`, [o.entry_id]);
        lapsed = true;
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
    } finally {
      client.release();
    }
    if (lapsed) {
      await valkey.releaseWindow(tableIdsForTarget(o.table_id), lisbonSlotInstant(o.date, o.time), o.party_size).catch(() => undefined);
      await valkey.delOffer(o.offer_id).catch(() => undefined);
      await queueEmail(pool, { to_email: o.email_lower, ...lapsedEmail({ starts_at: lisbonSlotInstant(o.date, o.time) }) }).catch(() => undefined);
      await publishEvent(pool, valkey, {
        type: "offer.lapsed", date: o.date, time: o.time,
        table_ids: tableIdsForTarget(o.table_id), party_size: o.party_size,
      }).catch(() => undefined);
      await offerFreedTable(pool, valkey, killbill, cfg, o.date, tableIdsForTarget(o.table_id), now()).catch(() => undefined);
    }
  }

  // Recovery: flush events committed while Valkey was unreachable, and run the
  // waitlist rule for tables freed during an outage within 15 seconds of return.
  if (valkey.isHealthy()) {
    await flushPendingEvents(pool, valkey).catch(() => undefined);
    const pending = await pool.query(
      `SELECT id, table_id, date FROM pending_freed_tables ORDER BY id LIMIT 20`,
    );
    for (const row of pending.rows) {
      await offerFreedTable(pool, valkey, killbill, cfg, row.date, [row.table_id], now()).catch(() => undefined);
      await pool.query(`DELETE FROM pending_freed_tables WHERE id = $1`, [row.id]);
    }
  }
}

void main();
