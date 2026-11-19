// Lintel Drive server: binds 0.0.0.0 on APP_PUBLIC_PORT, answers health within seconds, applies the schema, the
// bucket and the directory fields on every start, seeds an empty database, then keeps sweeping and probing.
import { createServer } from "node:http";
import { config } from "./config.js";
import { handleApi } from "./http.js";
import { serveStatic } from "./static.js";
import { applySchema } from "./schema.js";
import { ensureBucket } from "./storage.js";
import { ensureFields } from "./directory.js";
import { seedIfEmpty } from "./seed.js";
import { attach, broadcastLocal, listen } from "./hub.js";
import { onStatusChange, probe, PROBE_MS } from "./services.js";
import { sweep, SWEEP_MS } from "./sweep.js";
import { boot, register as registerSession } from "./session.js";
import { register as registerFolders } from "./folders.js";
import { register as registerFiles } from "./files.js";
import { register as registerMoves } from "./moves.js";
import { register as registerUploads } from "./uploads.js";
import { register as registerBin } from "./bin.js";
import { register as registerGrants } from "./grants.js";
import { register as registerPolicies } from "./policies.js";
import { register as registerHandovers } from "./handovers.js";

const BOOT_SEED_WAIT_MS = 20_000;

for (const register of [registerSession, registerFolders, registerFiles, registerMoves, registerUploads, registerBin,
  registerGrants, registerPolicies, registerHandovers]) register();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://app");
  const work = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : serveStatic(req, res, url);
  work.catch(() => res.destroy());
});
attach(server);
server.listen(config.port, "0.0.0.0");

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(name: string, work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (error) {
    console.error(`${name} not done yet:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/** Bucket, directory fields and seed; each is retried on later sweeps until it succeeds. */
const setup = { bucket: false, fields: false, seeded: false };
async function prepareServices(): Promise<void> {
  if (!setup.bucket) setup.bucket = await attempt("bucket", ensureBucket);
  if (!setup.fields) setup.fields = await attempt("directory fields", ensureFields);
  if (!setup.seeded) setup.seeded = await seedIfEmpty();
}

async function start(): Promise<void> {
  while (!await attempt("database schema", applySchema)) await pause(2_000);
  onStatusChange((current) => broadcastLocal({ type: "status", data: current }));
  await probe();
  listen();
  await Promise.race([prepareServices(), pause(BOOT_SEED_WAIT_MS)]);
  boot.ready = true;
  setInterval(() => void probe(), PROBE_MS);
  setInterval(() => {
    void (async () => {
      if (!setup.bucket || !setup.fields || !setup.seeded) await prepareServices();
      await sweep();
    })();
  }, SWEEP_MS);
}

void start();
