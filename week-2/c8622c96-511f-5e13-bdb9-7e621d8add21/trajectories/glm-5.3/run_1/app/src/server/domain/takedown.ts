import type { Sql } from "../db.js";
import { errors, ApiError } from "../errors.js";
import type { Storage } from "../storage.js";
import type { Mailer } from "../mail.js";
import type { Clock } from "../clock.js";
import { essayLockKey, num } from "./licensing.js";
import { takedownSubject, takedownBody } from "./mailbody.js";
import { grantKey, removeObject, copyObject, originalKey, legalHoldKey, derivativeKey } from "../storage.js";

// Legal takedown: serialised with licence requests and activations, removes
// the essay everywhere, revokes every licence, cancels unsent mail and sends
// one notice per licensee person.
export async function actionTakedown(
  sql: Sql,
  storage: Storage,
  mailer: Mailer,
  clock: Clock,
  essayId: string,
  reference: string,
): Promise<ApiError | { revoked_licences: number }> {
  const pre = await sql`SELECT state FROM essays WHERE id = ${essayId}`;
  if (pre.length === 0) return errors.notFound();
  const state = pre[0].state as string;
  if (state !== "embargoed" && state !== "live" && state !== "withdrawn") {
    return errors.illegalTransition(state, "takedown");
  }

  let revoked = 0;
  let noticeRecipients: { email: string }[] = [];
  let licenceIds: string[] = [];
  let frameIds: { id: string }[] = [];

  await sql.begin(async (tx) => {
    // A takedown waits for any activation already in progress on this essay.
    await tx`SELECT pg_advisory_xact_lock(${essayLockKey(essayId)})`;
    const rows = await tx`SELECT * FROM essays WHERE id = ${essayId} FOR UPDATE`;
    const essay = rows[0];
    if (!essay) return;
    const essayState = essay.state as string;
    if (essayState !== "embargoed" && essayState !== "live" && essayState !== "withdrawn") {
      return;
    }
    const takenDownAt = new Date(clock.now());

    // Revoke every licence on the essay, in one of its three ways: while
    // pending, with no invoice charge ever and no grant record; while active,
    // with exactly one charge kept and its grant record deleted; or already
    // expired, with its one charge kept and its grant record deleted.
    const revokedRows = await tx`
      UPDATE licences SET state = 'revoked',
        receipt_state = CASE WHEN receipt_state = 'sent' THEN 'sent' WHEN receipt_state IS NULL THEN NULL ELSE 'cancelled' END
      WHERE essay_id = ${essayId} AND state IN ('pending_invoice','active','expired')
      RETURNING id, licensed_by, newsroom_id`;
    revoked = revokedRows.length;
    licenceIds = revokedRows.map((k) => k.id);

    await tx`UPDATE essays SET state = 'taken_down', version = version + 1, taken_down_at = ${takenDownAt}, reference = ${reference} WHERE id = ${essayId}`;
    await tx`DELETE FROM shortlist_items WHERE essay_id = ${essayId}`;

    // Cancel every unsent email about the essay.
    await tx`UPDATE mail_queue SET status = 'cancelled'
             WHERE essay_id = ${essayId} AND status IN ('queued','sending')`;

    // One notice per licensee person: each picture editor who licensed it and
    // each licensing manager of every licensee newsroom.
    const editors = await tx`
      SELECT DISTINCT p.email FROM licences l JOIN people p ON p.id = l.licensed_by
      WHERE l.essay_id = ${essayId}`;
    const managers = await tx`
      SELECT DISTINCT p.email FROM people p
      WHERE p.role = 'licensing_manager' AND p.newsroom_id IN (
        SELECT DISTINCT newsroom_id FROM licences WHERE essay_id = ${essayId}
      )`;
    const seen = new Set<string>();
    noticeRecipients = [];
    for (const person of [...editors, ...managers]) {
      if (seen.has(person.email)) continue;
      seen.add(person.email);
      noticeRecipients.push({ email: person.email });
    }
    frameIds = await tx`SELECT id FROM frames WHERE essay_id = ${essayId}`;
  });

  // Storage effects after the transaction: derivatives and grant records are
  // deleted, originals move under the legal-hold prefix.
  for (const frame of frameIds) {
    for (const variant of ["grid", "story", "preview"] as const) {
      try {
        await removeObject(storage, derivativeKey(essayId, frame.id, variant));
      } catch {
        // Already gone.
      }
    }
    try {
      await copyObject(storage, originalKey(essayId, frame.id), legalHoldKey(essayId, frame.id));
      await removeObject(storage, originalKey(essayId, frame.id));
    } catch {
      // Storage unreachable: the storage sweep retries removals.
    }
  }
  for (const licenceId of licenceIds) {
    try {
      await removeObject(storage, grantKey(licenceId));
    } catch {
      // Already gone.
    }
  }

  const essayRow = await sql`SELECT title FROM essays WHERE id = ${essayId}`;
  for (const person of noticeRecipients) {
    await mailer.queue(sql, {
      kind: "takedown_notice",
      to: person.email,
      subject: takedownSubject(essayRow[0].title),
      body: takedownBody({ title: essayRow[0].title, licenceIds }),
      essayId,
    });
  }

  return { revoked_licences: revoked };
}
