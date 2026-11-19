import { requireRole, signedIn } from "./auth.js";
import { pool } from "./db.js";
import * as gotenberg from "./gotenberg.js";
import { json, type Ctx, type Route } from "./http.js";
import * as killbill from "./killbill.js";
import { fullLedger } from "./ledger.js";
import * as mail from "./mail.js";
import * as provider from "./provider.js";
import { rendersOf } from "./renders.js";
import * as s3 from "./s3.js";

// Service checks: this instance probes each provider with its own configuration every 10 seconds and
// keeps only the latest results, in memory, as the brief allows.

const PROBES = {
  killbill: killbill.reachable,
  render_provider: provider.reachable,
  gotenberg: gotenberg.reachable,
  mail: mail.reachable,
  storage: s3.reachable,
} as const;
type Service = keyof typeof PROBES;

const latest = new Map<Service, { reachable: boolean; checked_at: string }>();

export async function probeAll(): Promise<void> {
  await Promise.all(
    (Object.keys(PROBES) as Service[]).map(async (name) => {
      latest.set(name, { reachable: await PROBES[name](), checked_at: new Date().toISOString() });
    }),
  );
}

/** True only when this instance's latest mail probe reached mail. */
export const mailReachable = (): boolean => latest.get("mail")?.reachable === true;

async function founder(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "founder-operator");
}

async function services(ctx: Ctx) {
  await founder(ctx);
  return json(200, {
    services: (Object.keys(PROBES) as Service[]).map((name) => ({ name, reachable: latest.get(name)?.reachable ?? false, checked_at: latest.get(name)?.checked_at ?? null })),
  });
}

async function creditLedger(ctx: Ctx) {
  await founder(ctx);
  return json(200, await fullLedger(pool));
}

async function renders(ctx: Ctx) {
  await founder(ctx);
  const state = ctx.query.get("state");
  return json(200, { renders: await rendersOf(pool, state ? "WHERE r.state = $1" : "", state ? [state] : []) });
}

export const adminRoutes: Route[] = [
  { method: "GET", pattern: "/api/admin/services", handler: services },
  { method: "GET", pattern: "/api/admin/credit-ledger", handler: creditLedger },
  { method: "GET", pattern: "/api/admin/renders", handler: renders },
];
