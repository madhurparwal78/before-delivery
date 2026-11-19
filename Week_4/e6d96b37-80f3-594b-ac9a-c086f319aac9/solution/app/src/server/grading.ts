// Grading routes: present only with FLAN_GRADE_KEY and its header (checked by the router).

import { randomBytes } from "node:crypto";
import { F } from "../shared/feedback.js";
import { type Body, integer, text } from "./body.js";
import { config } from "./config.js";
import { notify, query } from "./db.js";
import { FieldErrors, HttpError, invalid, notFound, seedFailed, serviceUnavailable } from "./errors.js";
import { disableUser, endSessions, findUser, setPassword } from "./keycloak.js";
import { username } from "./keycloakSetup.js";
import { seedNamespace, VARIANTS, WORKFLOWS } from "./fixtures/seed.js";
import { currentCode } from "./totp.js";

const NAMESPACE = /^[a-z0-9-]+$/;

function validNamespace(ns: string | null): string {
  if (ns === null || !NAMESPACE.test(ns) || ns.length > config.limits.FLAN_NAMESPACE_MAX_CHARS) throw invalid({ namespace: F.INVALID });
  return ns;
}

/** A provider can blip under load; a seed rebuilds its whole namespace, so trying again is safe. */
async function seedWithRetry(request: Parameters<typeof seedNamespace>[0]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await seedNamespace(request);
    } catch (error) {
      if (attempt === 3 || !(error instanceof HttpError && error.code === "service_unavailable")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

export async function seed(body: Body): Promise<{ status: number; body: unknown }> {
  const ns = validNamespace(text(body, "namespace"));
  const workflow = WORKFLOWS.find((w) => w === text(body, "workflow"));
  const variant = VARIANTS.find((v) => v === text(body, "variant"));
  const errors = new FieldErrors();
  if (!workflow) errors.add("workflow", F.INVALID);
  if (!variant) errors.add("variant", F.INVALID);
  errors.throwIfAny();
  try {
    return { status: 201, body: await seedWithRetry({ ns, workflow: workflow!, variant: variant! }) };
  } catch (error) {
    if (error instanceof HttpError && error.code === "service_unavailable") {
      const databaseUp = await query("SELECT 1").then(() => true, () => false);
      if (!databaseUp) throw serviceUnavailable();
    }
    throw seedFailed(`Seeding ${ns} failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function gradingDesk(ns: string): Promise<Date> {
  const rows = await query<{ clock_at: Date | null }>("SELECT clock_at FROM desks WHERE ns = $1 AND grading", [validNamespace(ns)]);
  if (!rows[0]?.clock_at) throw notFound();
  return rows[0].clock_at;
}

export async function advanceClock(ns: string, body: Body): Promise<unknown> {
  await gradingDesk(ns);
  const seconds = integer(body, "advance_seconds");
  if (seconds === null || seconds < 0) throw invalid({ advance_seconds: F.INVALID });
  const rows = await query<{ clock_at: Date }>(
    "UPDATE desks SET clock_at = clock_at + make_interval(secs => $2) WHERE ns = $1 RETURNING clock_at",
    [ns, seconds],
  );
  await notify(ns);
  return { clock: rows[0]!.clock_at.toISOString() };
}

export async function otp(ns: string, role: string | null): Promise<unknown> {
  await gradingDesk(ns);
  const rows = await query<{ totp_secret: string }>("SELECT totp_secret FROM identities WHERE ns = $1 AND role = $2", [
    ns,
    role === "dealer_peer" ? "dealer" : role,
  ]);
  if (!rows[0]) throw notFound();
  return { code: currentCode(rows[0].totp_secret) };
}

export async function identity(ns: string, body: Body): Promise<unknown> {
  await gradingDesk(ns);
  const role = text(body, "role");
  const action = text(body, "action");
  if (role !== "counterpart") throw invalid({ role: F.INVALID });
  if (action !== "revoke" && action !== "password_change") throw invalid({ action: F.INVALID });
  const user = await findUser(username(ns, "counterpart"));
  if (!user) throw notFound();
  if (action === "revoke") await disableUser(user.id);
  else await setPassword(user.id, `Flan-${randomBytes(9).toString("base64url")}`);
  await endSessions(user.id);
  return { role, action };
}
