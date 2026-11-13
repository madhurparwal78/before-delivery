// Boot: wait for Postgres, apply the schema and start seed, then serve pages and the API on 0.0.0.0.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config";
import { migrate, pool, waitForDatabase } from "./db";
import { dispatch, createHttpServer } from "./http";
import { errors } from "./errors";
import { servePage } from "./static";
import { applyStartSeed } from "./startSeed";
import { runAllChecks } from "./alerts/check";
import { lifecycleStep } from "./lifecycle";
import "./routes/accounts";
import "./routes/streams";
import "./routes/search";
import "./routes/pipelines";
import "./routes/alerts";
import "./routes/observability";
import "./routes/spaces";
import "./routes/live";
import "./routes/grading";

async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.pathname.startsWith("/api/")) return dispatch(req, res, url);
  if ((req.method !== "GET" && req.method !== "HEAD") || !servePage(url.pathname, res)) throw errors.notFound();
}

async function everyStream(work: (id: number) => Promise<void>): Promise<void> {
  const { rows } = await pool.query<{ id: number }>("SELECT id FROM streams");
  for (const { id } of rows) await work(id);
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await applyStartSeed();
  createHttpServer(handle).listen(config.port, "0.0.0.0");
  if (!config.grading) {
    setInterval(() => void runAllChecks().catch((error: unknown) => console.error(error)), config.settings.checkIntervalMs).unref();
    setInterval(() => void everyStream(lifecycleStep).catch((error: unknown) => console.error(error)), config.settings.lifecycleIntervalMs).unref();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

