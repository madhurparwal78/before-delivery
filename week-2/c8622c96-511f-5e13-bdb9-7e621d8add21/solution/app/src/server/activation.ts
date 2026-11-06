// Activation, all or nothing: a licence becomes active only in the commit that also finds its invoice charge
// raised and its grant record written, and that commit queues its receipt. The first attempt runs inside the
// request's own commit (under the essay lock); retries run on any instance under the licence row lock, which
// serialises them with takedowns. No attempt starts at or after the hold deadline.
import { isoInstant } from "../shared/coop-time.js";
import { serverNow } from "./clock.js";
import { one, query, transaction, type Client } from "./db.js";
import { creditLine, creditsOf } from "./essay-model.js";
import { ApiError } from "./http.js";
import { BillingRefused, BillingUnreachable, newsroomAccount, raiseCharge } from "./killbill.js";
import { ATTEMPT_WINDOW_MS, type LicenceRow } from "./licence-state.js";
import { queueReceipt } from "./mail.js";
import { keys, putObject } from "./s3.js";
import type { WorkOutcome } from "./workers.js";

type Attempt = "active" | "pending" | "refused";

/**
 * Raises the charge, writes the grant record and, when both exist, marks the licence active and queues its
 * receipt on `client`. Leaves the licence pending when billing or storage is unreachable.
 */
export async function attemptActivation(client: Client, licence: LicenceRow): Promise<Attempt> {
  const room = await one<{ name: string }>("SELECT name FROM newsrooms WHERE slug = $1", [licence.newsroom], client);
  try {
    const account = await newsroomAccount(licence.newsroom, room?.name ?? licence.newsroom);
    await raiseCharge(account, `Saltprint licence ${licence.id} · ${licence.kind}`, licence.amount_minor,
      licence.attempts > 1);
  } catch (error) {
    if (error instanceof BillingRefused) return "refused";
    if (error instanceof BillingUnreachable) return "pending";
    throw error;
  }
  const frames = await query<{ id: string }>("SELECT id FROM frames WHERE essay_id = $1 ORDER BY position",
    [licence.essay_id], client);
  try {
    await putObject(keys.grant(licence.id), Buffer.from(JSON.stringify({
      licence_id: licence.id, newsroom: licence.newsroom, essay_id: licence.essay_id,
      frame_ids: frames.map((f) => f.id), window_end: isoInstant(licence.window_end),
    })), "application/json");
  } catch (error) {
    if (error instanceof ApiError) return "pending";
    throw error;
  }
  await query("UPDATE licences SET status = 'active', invoice_raised = true, attempt_started_at = NULL WHERE id = $1",
    [licence.id], client);
  const essay = await one<{ title: string }>("SELECT title FROM essays WHERE id = $1", [licence.essay_id], client);
  const names = (await creditsOf([licence.essay_id], client)).map((c) => c.name);
  await queueReceipt(client, { id: licence.essay_id, title: essay?.title ?? "", creditLine: creditLine(names) },
    { ...licence, status: "active" });
  return "active";
}

const RELEASE_CLAIM = "UPDATE licences SET attempt_started_at = NULL WHERE id = $1";

/** Retries one pending licence, if its hold deadline has not arrived; false when billing or storage was unreachable. */
async function retryActivation(licenceId: string): Promise<boolean> {
  const now = await serverNow();
  const claimed = await one<LicenceRow>(
    `UPDATE licences SET attempt_started_at = clock_timestamp(), attempts = attempts + 1
     WHERE id = $1 AND status = 'pending' AND hold_until > $2
       AND (attempt_started_at IS NULL OR attempt_started_at < clock_timestamp() - make_interval(secs => $3))
     RETURNING id`, [licenceId, now, ATTEMPT_WINDOW_MS / 1000]);
  if (!claimed) return true;
  let settled = false;
  try {
    settled = await transaction(async (client) => {
      const licence = await one<LicenceRow>("SELECT * FROM licences WHERE id = $1 FOR UPDATE", [licenceId], client);
      if (!licence || licence.status !== "pending") return true;
      const attempt = await attemptActivation(client, licence);
      if (attempt === "refused") {
        await query("UPDATE licences SET status = 'removed', attempt_started_at = NULL WHERE id = $1", [licenceId], client);
      }
      return attempt !== "pending";
    });
  } finally {
    if (!settled) await query(RELEASE_CLAIM, [licenceId]).catch(() => undefined);
  }
  return settled;
}

/**
 * Retries pending licences, after removing those whose hold deadline has passed. Answers "provider_down" at the
 * first attempt that finds billing or storage unreachable, so this instance waits before trying again while
 * any other instance may take the licence meanwhile.
 */
export async function retryActivations(): Promise<WorkOutcome> {
  const now = await serverNow();
  await query(`UPDATE licences SET status = 'removed'
    WHERE status = 'pending' AND hold_until <= $1
      AND (attempt_started_at IS NULL OR attempt_started_at < clock_timestamp() - make_interval(secs => $2))`,
  [now, ATTEMPT_WINDOW_MS / 1000]);
  const due = await query<{ id: string }>(
    `SELECT id FROM licences WHERE status = 'pending' AND hold_until > $1
       AND (attempt_started_at IS NULL OR attempt_started_at < clock_timestamp() - make_interval(secs => $2))
     ORDER BY confirmed_at LIMIT 20`, [now, ATTEMPT_WINDOW_MS / 1000]);
  for (const { id } of due) {
    if (!await retryActivation(id)) return "provider_down";
  }
  return "done";
}
