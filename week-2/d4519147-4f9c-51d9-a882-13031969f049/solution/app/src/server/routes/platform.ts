import { isReady } from "../db.ts";
import { sendJson } from "../http.ts";
import { route } from "../router.ts";
import { mailReachable } from "../smtp.ts";
import { storageReachable } from "../storage.ts";

const FRESH_MS = 4000;
type ServiceStatus = { storage: "up" | "down"; mail: "up" | "down" };
let cached: { at: number; value: ServiceStatus } | null = null;
let checking: Promise<ServiceStatus> | null = null;

async function checkServices(): Promise<ServiceStatus> {
  const [storage, mail] = await Promise.all([storageReachable(), mailReachable()]);
  const value: ServiceStatus = { storage: storage ? "up" : "down", mail: mail ? "up" : "down" };
  cached = { at: Date.now(), value };
  return value;
}

route("GET", "/api/health", { auth: "none" }, async ({ res }) => {
  if (isReady()) sendJson(res, 200, { status: "ok" });
  else sendJson(res, 503, { status: "starting" });
});

/** Needs no session and never touches the idle clock; each check is bounded so the answer comes within 3 seconds. */
route("GET", "/api/status", { auth: "none" }, async ({ res }) => {
  if (cached && Date.now() - cached.at <= FRESH_MS) return sendJson(res, 200, cached.value);
  checking ??= checkServices().finally(() => {
    checking = null;
  });
  sendJson(res, 200, await checking);
});
