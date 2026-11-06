// The trial and dunning edges by the server's clock. The scheduler settles every workspace each pass; a request
// that meets an edge before the scheduler does settles that workspace first, so effect and record arrive together.
import { localTime, isoSecond } from "../../shared/format.js";
import { SCHEDULER } from "../auth.js";
import { audit } from "../audit.js";
import { rows, transaction } from "../db.js";
import { enqueueMail } from "../services/mail.js";
import { billingContacts } from "../workspace.js";

interface Due { workspace_id: string; name: string; time_zone: string }

async function endTrials(now: Date, workspaceId: string | null): Promise<void> {
  await transaction(async (client) => {
    const ended = await rows<Due>(client,
      `UPDATE subscriptions s SET state = 'suspended', suspended_by = 'trial' FROM workspaces w
       WHERE w.id = s.workspace_id AND s.state = 'trial' AND s.trial_ends_at <= $1 AND ($2::text IS NULL OR s.workspace_id = $2)
       RETURNING s.workspace_id, w.name, w.time_zone`, [now, workspaceId]);
    for (const ws of ended) await audit(client, ws.workspace_id, SCHEDULER, "subscription.trial_ended", { type: "subscription", id: ws.workspace_id });
  });
}

async function dunning(now: Date, workspaceId: string | null): Promise<void> {
  await transaction(async (client) => {
    const reminders = await rows<Due>(client,
      `UPDATE subscriptions s SET dunning_day3_sent = true FROM workspaces w
       WHERE w.id = s.workspace_id AND s.state = 'past_due' AND NOT s.dunning_day3_sent AND s.dunning_day3_at <= $1
         AND ($2::text IS NULL OR s.workspace_id = $2)
       RETURNING s.workspace_id, w.name, w.time_zone`, [now, workspaceId]);
    for (const ws of reminders) {
      await enqueueMail(client, {
        to: await billingContacts(client, ws.workspace_id), subject: `Reminder: payment still due for ${ws.name}`,
        body: `A payment for ${ws.name} is still due. Pay the overdue invoice before the grace period ends to keep publishing.\n\nOrrery Studio`,
      });
    }
    const suspended = await rows<Due & { grace_ends_at: Date }>(client,
      `UPDATE subscriptions s SET state = 'suspended', suspended_by = 'dunning' FROM workspaces w
       WHERE w.id = s.workspace_id AND s.state = 'past_due' AND s.grace_ends_at <= $1 AND ($2::text IS NULL OR s.workspace_id = $2)
       RETURNING s.workspace_id, w.name, w.time_zone, s.grace_ends_at`, [now, workspaceId]);
    for (const ws of suspended) {
      await audit(client, ws.workspace_id, SCHEDULER, "subscription.suspended", { type: "subscription", id: ws.workspace_id });
      await enqueueMail(client, {
        to: await billingContacts(client, ws.workspace_id), subject: `Publishing suspended for ${ws.name}`,
        body: `The grace period for ${ws.name} ended ${localTime(isoSecond(ws.grace_ends_at), ws.time_zone)}. The workspace is read-only until the overdue invoice is paid.\n\nOrrery Studio`,
      });
    }
  });
}

/** Applies every trial end, day-3 notice and grace-period end that is due, for one workspace or all of them. */
export async function settleClock(now: Date, workspaceId: string | null = null): Promise<void> {
  await endTrials(now, workspaceId);
  await dunning(now, workspaceId);
}
