/** Stationkeeper server entry point: config, schema, seed, routes and the sweep. */

import { readConfig } from "./env.js";
import { Db, seedIfEmpty } from "./db.js";
import { KillBillClient } from "./providers/killbill.js";
import { Storage } from "./providers/storage.js";
import { Mailer } from "./providers/mail.js";
import { App, listen } from "./http/server.js";
import { UnitOfWorkRunner } from "./domain/unit-of-work.js";
import { Sweep } from "./sweep.js";
import { registerSessionRoutes } from "./http/handlers/session.js";
import { registerDialRoutes } from "./http/handlers/dial.js";
import { registerHoldRoutes } from "./http/handlers/holds.js";
import { registerBookingRoutes } from "./http/handlers/bookings.js";
import { registerPolicyRoutes, registerHourPackRoutes } from "./http/handlers/policy-hours.js";
import { registerDocumentRoutes } from "./http/handlers/documents.js";
import { registerTenantRoutes, registerInspectRoutes, registerShelfRoutes } from "./http/handlers/tenants.js";
import { registerInvoiceRoutes } from "./http/handlers/invoices.js";

async function main(): Promise<void> {
  const config = readConfig();

  // Kill Bill and MinIO may be unreachable at boot; the app starts and serves everything else.
  const killbill = new KillBillClient(
    config.killbillUrl,
    config.killbillUsername,
    config.killbillPassword,
    config.killbillApiKey,
    config.killbillApiSecret
  );
  const storage = new Storage(
    config.s3Endpoint,
    config.s3Region,
    config.s3Bucket,
    config.s3AccessKeyId,
    config.s3SecretAccessKey
  );
  const mailer = new Mailer(config.smtpHost, config.smtpPort);

  const db = await Db.connect(config.databaseUrl);
  console.log("schema applied");
  await seedIfEmpty(db, storage);
  console.log("seed checked");

  const uow = new UnitOfWorkRunner(db, killbill, storage, mailer);
  const app = new App(db);

  registerSessionRoutes(app);
  registerDialRoutes(app);
  registerHoldRoutes(app, uow, config.holdTtlSeconds);
  registerBookingRoutes(app, uow);
  registerPolicyRoutes(app);
  registerHourPackRoutes(app, killbill);
  registerDocumentRoutes(app, storage);
  registerTenantRoutes(app);
  registerInspectRoutes(app, storage);
  registerShelfRoutes(app);
  registerInvoiceRoutes(app, uow, killbill, storage);

  const sweep = new Sweep(db, storage, killbill, mailer);
  sweep.start(config.reminderSweepSeconds);

  listen(app, config.port);
}

void main().catch((e) => {
  console.error("failed to start:", e);
  process.exit(1);
});
