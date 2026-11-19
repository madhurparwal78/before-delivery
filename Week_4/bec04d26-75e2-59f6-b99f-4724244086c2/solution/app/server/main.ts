import { serve } from "@hono/node-server";
import { config } from "./config";
import { databaseAnswers, databaseReady } from "./db";
import { buildApp } from "./http/app";
import { background } from "./services/background";
import { tickRealTimeClocks } from "./services/clock";
import { gotenbergAnswers } from "./services/gotenberg";
import { dispatchMail } from "./services/outbox";
import { renderWaitingPackets } from "./services/packets";
import { smtpAnswers } from "./services/smtp";
import { markReachable, setDatabaseUp } from "./services/status";

/** Checks both providers every retry period, whether or not work is waiting, and retries whatever is waiting. */
async function checkServices(): Promise<void> {
  const [database, mail, pdf] = await Promise.all([databaseAnswers(), smtpAnswers(), gotenbergAnswers()]);
  setDatabaseUp(database);
  markReachable("mail", mail);
  markReachable("pdf", pdf);
  if (mail) background(() => dispatchMail());
  if (pdf) background(renderWaitingPackets);
}

serve({ fetch: buildApp().fetch, port: config.port, hostname: "0.0.0.0" });

void databaseReady.then(async () => {
  await checkServices();
  setInterval(() => background(checkServices), config.retryMs);
  setInterval(() => background(tickRealTimeClocks), 1000);
});

