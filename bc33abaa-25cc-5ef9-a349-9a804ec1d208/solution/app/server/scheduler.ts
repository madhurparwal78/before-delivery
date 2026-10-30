// The server's clock: every scheduled effect is claimed atomically, so it happens once even with several instances.
import { localTime, isoSecond } from "../shared/format.js";
import { pool, rows, transaction } from "./db.js";
import { settleClock } from "./domain/clock.js";
import { publishDueVersions } from "./publish.js";
import { deliverQueuedMail, enqueueMail } from "./services/mail.js";
import { ensureCollections } from "./services/pocketbase.js";
import { ensureCatalog } from "./services/killbill.js";
import { seedComments } from "./seed.js";

/** End-of-term plan and seat changes take effect locally at the instant Kill Bill applies them. */
async function pendingChanges(now: Date): Promise<void> {
  await pool.query(
    `UPDATE subscriptions SET plan = pending_change->>'plan', period = pending_change->>'period',
       extra_seats = (pending_change->>'extraSeats')::int, pending_change = NULL
     WHERE pending_change IS NOT NULL AND (pending_change->>'effectiveAt')::timestamptz <= $1`, [now]);
}

async function tokenWarnings(now: Date): Promise<void> {
  await transaction(async (client) => {
    const due = await rows<{ name: string; expires_at: Date; issued_by_id: string; workspace_id: string; time_zone: string }>(client,
      `UPDATE agent_tokens t SET warned_at = $1 FROM workspaces w
       WHERE w.id = t.workspace_id AND t.warned_at IS NULL AND t.revoked_at IS NULL AND t.warn_at <= $1 AND t.expires_at > $1
       RETURNING t.name, t.expires_at, t.issued_by_id, t.workspace_id, w.time_zone`, [now]);
    for (const token of due) {
      const [recipient] = await rows<{ email: string }>(client,
        `SELECT email FROM members WHERE workspace_id = $2 AND removed_at IS NULL AND (id = $1 OR role = 'owner')
         ORDER BY (id = $1) DESC LIMIT 1`, [token.issued_by_id, token.workspace_id]);
      await enqueueMail(client, {
        to: [recipient.email], subject: `Agent token ${token.name} expires soon`,
        body: `The agent token ${token.name} expires ${localTime(isoSecond(token.expires_at), token.time_zone)}. Issue a new token before then to keep the agent working.\n\nOrrery Studio`,
      });
    }
  });
}

let collaborationReady = false;
let billingReady = false;

const attempt = (work: () => Promise<void>, what: string) => work().then(() => true, (error: unknown) => {
  console.error(`${what} deferred:`, error instanceof Error ? error.message : error);
  return false;
});

/** Provider setup that waits until each provider is reachable, retried on every pass until it succeeds. */
async function providerSetup(): Promise<void> {
  if (!collaborationReady) collaborationReady = await attempt(() => ensureCollections().then(seedComments), "PocketBase setup");
  if (!billingReady) billingReady = await attempt(ensureCatalog, "Kill Bill catalog");
}

async function pass(): Promise<void> {
  const now = new Date();
  for (const step of [() => settleClock(now), () => pendingChanges(now), () => tokenWarnings(now), publishDueVersions, deliverQueuedMail, providerSetup]) {
    try {
      await step();
    } catch (error) {
      console.error("scheduler step deferred:", error instanceof Error ? error.message : error);
    }
  }
}

export function startScheduler(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    pass().finally(() => { running = false; });
  }, 500);
}
