// Email invites: the bare-address rule, the daily quota and delivery that waits out a mail outage.
import { config } from "./config.js";
import { db, newId, tx, type Db } from "./db.js";
import { ApiError, FIELD } from "./errors.js";
import { record } from "./activity.js";
import { entitlementsOf, planOf } from "./billing.js";
import { commit } from "./versions.js";
import { send, MailDown } from "./smtp.js";
import { formatLocal, localDay, secondsToLocalMidnight } from "./zone.js";

const BARE_ADDRESS = /^[^\s<>,;@\x00-\x1f\x7f"]+@[^\s<>,;@\x00-\x1f\x7f"]+$/;

/** The bare-address rule, for invite entries and the sponsor email: trimmed `local@domain`, at most 254 characters. */
export function bareAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= 254 && BARE_ADDRESS.test(trimmed) && !/[\u2028\u2029]/.test(trimmed) ? trimmed : null;
}

/** Distinct lower-cased addresses in first-seen order, or the field error for the whole batch. */
export function parseBatch(emails: unknown): string[] {
  if (!Array.isArray(emails) || emails.length < 1 || emails.length > 30) {
    throw new ApiError("validation", { fields: { emails: FIELD.emailsCount } });
  }
  const parsed = emails.map(bareAddress);
  if (parsed.some((e) => e === null)) throw new ApiError("validation", { fields: { emails: FIELD.emailsEntry } });
  return [...new Set(parsed.map((e) => (e as string).toLowerCase()))];
}

/** Counts a batch against today's allowance in the facilitator's time zone; the batch is refused whole. */
export async function chargeQuota(t: Db, facilitator: { id: string; time_zone: string }, count: number): Promise<void> {
  await t.run("SELECT 1 FROM facilitators WHERE id = $1 FOR UPDATE", [facilitator.id]);
  const now = new Date();
  const day = localDay(now, facilitator.time_zone);
  const limit = (await entitlementsOf(t, facilitator.id)).invitesPerDay;
  const used = (await t.one<{ count: number }>("SELECT count FROM invite_counts WHERE facilitator_id = $1 AND day = $2", [facilitator.id, day]))?.count ?? 0;
  if (used + count > limit) {
    const wait = String(secondsToLocalMidnight(now, facilitator.time_zone));
    throw new ApiError("quota_exceeded", { extra: { limit, used, plan: await planOf(t, facilitator.id) }, headers: { "Retry-After": wait } });
  }
  await t.run(
    `INSERT INTO invite_counts (facilitator_id, day, count) VALUES ($1, $2, $3)
     ON CONFLICT (facilitator_id, day) DO UPDATE SET count = invite_counts.count + $3`,
    [facilitator.id, day, count],
  );
}

export async function queueInvites(t: Db, workshop: { id: string; facilitator_id: string }, emails: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const email of emails) {
    const id = newId();
    ids.push(id);
    await t.run(
      "INSERT INTO invites (id, workshop_id, email, status, lease_until) VALUES ($1, $2, $3, 'queued', now() + interval '30 seconds')",
      [id, workshop.id, email],
    );
  }
  await record(t, workshop.facilitator_id, "invites.sent", workshop.id);
  return ids;
}

interface InviteJob {
  id: string;
  workshop_id: string;
  email: string;
  title: string;
  start_at: Date;
  end_at: Date;
  time_zone: string;
}

function inviteMail(job: InviteJob, joinUrl: string) {
  const when = `${formatLocal(job.start_at, job.time_zone)} to ${formatLocal(job.end_at, job.time_zone)} (${job.time_zone})`;
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return {
    to: job.email,
    subject: `You're invited: ${job.title}`,
    text: `You're invited to ${job.title}.\r\n\r\nWhen: ${when}\r\n\r\nJoin from this link — no account needed:\r\n${joinUrl}\r\n\r\nLanternfold Rooms`,
    html:
      `<!doctype html><html><body style="font-family:Georgia,serif;color:#2a2420;background:#f6f1e7;padding:24px">` +
      `<h1 style="font-weight:400">You're invited to ${escape(job.title)}</h1>` +
      `<p>When: ${escape(when)}</p><p>Join from this link — no account needed:<br><a href="${escape(joinUrl)}">${escape(joinUrl)}</a></p>` +
      `<p style="color:#675d52">Lanternfold Rooms</p></body></html>`,
  };
}

/** Sends invites already claimed by the caller. Each attempt releases its lease as soon as it records the outcome. */
export async function deliver(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const jobs = await db.rows<InviteJob>(
    `SELECT i.id, i.workshop_id, i.email, w.title, w.start_at, w.end_at, f.time_zone FROM invites i
     JOIN workshops w ON w.id = i.workshop_id JOIN facilitators f ON f.id = w.facilitator_id
     WHERE i.id IN (SELECT jsonb_array_elements_text($1::jsonb)) AND i.status = 'queued' ORDER BY i.seq`,
    [ids],
  );
  const touched = new Set<string>();
  for (const job of jobs) {
    const link = await db.one<{ token: string }>("SELECT token FROM join_links WHERE workshop_id = $1 AND revoked_at IS NULL", [job.workshop_id]);
    let sent = false;
    if (link) {
      try {
        await send(inviteMail(job, `${config.publicBaseUrl}/join/${link.token}`));
        sent = true;
      } catch (error) {
        if (!(error instanceof MailDown)) throw error;
      }
    }
    await db.run(
      `UPDATE invites SET status = CASE WHEN $2::boolean THEN 'sent' ELSE status END, sent_at = CASE WHEN $2::boolean THEN now() END,
         attempts = attempts + 1, lease_until = NULL WHERE id = $1`,
      [job.id, sent],
    );
    if (sent) touched.add(job.workshop_id);
  }
  for (const workshopId of touched) await tx((t) => commit(t, workshopId));
}

/** Worker: claims queued invites whose lease is free and tries them again. */
export async function retryQueued(): Promise<void> {
  const claimed = await db.rows<{ id: string }>(
    `UPDATE invites SET lease_until = now() + interval '30 seconds' WHERE id IN (
       SELECT id FROM invites WHERE status = 'queued' AND (lease_until IS NULL OR lease_until < now()) ORDER BY seq LIMIT 50 FOR UPDATE SKIP LOCKED)
     RETURNING id`,
  );
  await deliver(claimed.map((c) => c.id));
}
