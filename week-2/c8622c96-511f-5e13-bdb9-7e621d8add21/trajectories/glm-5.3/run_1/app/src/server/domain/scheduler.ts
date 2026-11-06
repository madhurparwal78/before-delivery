import type { Sql } from "../db.js";
import type { Storage } from "../storage.js";
import { Billing } from "../billing.js";
import type { Mailer } from "../mail.js";
import type { Clock } from "../clock.js";
import { num, essayLockKey, effectiveState, type LicenceRow } from "./licensing.js";
import { licenceRecipients, receiptSubject, receiptBody, warningSubject, warningBody, liftSubject, liftBody } from "./mailbody.js";
import { grantKey, putObject, removeObject, copyObject, originalKey, legalHoldKey, derivativeKey } from "../storage.js";
import { formatCoopTime, dollarsWithCommas } from "../../shared/time.js";

// Scheduled and retried work, claimed in the database so several instances
// sharing one database never repeat an effect: embargo lifts, licence
// activations, hold-deadline removals, expiry warnings, payouts and mail.
export interface Services {
  sql: Sql;
  storage: Storage;
  billing: Billing;
  mailer: Mailer;
  clock: Clock;
}

// Activation, all-or-nothing: the licence becomes active only when its invoice
// charge, its grant record and its queued receipt all exist. Holds the essay
// advisory lock so a takedown waits for an activation already in progress.
export async function attemptActivation(svc: Services, licenceId: string): Promise<"activated" | "pending" | "removed" | "busy" | "gone"> {
  const { sql, storage, billing, mailer, clock } = svc;
  const pre = await sql`SELECT essay_id FROM licences WHERE id = ${licenceId}`;
  if (pre.length === 0) return "gone";
  const essayId = pre[0].essay_id as string;

  return sql.begin(async (tx) => {
    const locked = await tx`SELECT pg_try_advisory_xact_lock(${essayLockKey(essayId)}) AS locked`;
    if (!locked[0].locked) return "busy";
    const rows = await tx`SELECT * FROM licences WHERE id = ${licenceId} FOR UPDATE`;
    const licence = rows[0] as LicenceRow | undefined;
    if (!licence) return "gone";
    if (licence.state !== "pending_invoice") return licence.state === "active" ? "activated" : "gone";
    const nowMs = clock.now();
    if (nowMs >= num(licence.hold_until)) {
      await tx`DELETE FROM licences WHERE id = ${licenceId}`;
      return "removed";
    }

    const newsroom = await tx`SELECT slug, name FROM newsrooms WHERE id = ${licence.newsroom_id}`;
    const account = await billing.ensureNewsroomAccount(newsroom[0].slug, newsroom[0].name);
    if (!account.ok || !account.accountId) {
      await tx`UPDATE licences SET activation_next_attempt_at = now() + interval '5 seconds' WHERE id = ${licenceId}`;
      return "pending";
    }
    const charge = await billing.raiseCharge(account.accountId, licenceId, licence.kind, Number(licence.amount_minor));
    if (!charge.ok && charge.kind === "unavailable") {
      await tx`UPDATE licences SET activation_next_attempt_at = now() + interval '5 seconds' WHERE id = ${licenceId}`;
      return "pending";
    }
    if (!charge.ok) {
      // A billing refusal removes the licence and its window hold entirely.
      await tx`DELETE FROM licences WHERE id = ${licenceId}`;
      return "removed";
    }

    // The grant record is written before activation commits.
    const frameIds = await tx`SELECT id FROM frames WHERE essay_id = ${licence.essay_id} ORDER BY position`;
    const grant = {
      licence_id: licenceId,
      newsroom: newsroom[0].slug,
      essay_id: licence.essay_id,
      frame_ids: frameIds.map((f) => f.id),
      window_end: formatCoopTime(num(licence.window_end)),
    };
    try {
      await putObject(storage, grantKey(licenceId), Buffer.from(JSON.stringify(grant), "utf8"), "application/json");
    } catch {
      await tx`UPDATE licences SET activation_next_attempt_at = now() + interval '5 seconds' WHERE id = ${licenceId}`;
      return "pending";
    }

    await tx`UPDATE licences SET state = 'active', invoice_state = 'raised', receipt_state = 'queued' WHERE id = ${licenceId}`;
    const essay = await tx`SELECT title FROM essays WHERE id = ${licence.essay_id}`;
    const creditNames = await tx`
      SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
      WHERE c.essay_id = ${licence.essay_id} ORDER BY c.position`;
    const names = creditNames.map((c) => c.name);
    const creditLine = names.length === 1 ? `Photographs by ${names[0]}` : `Photographs by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const recipients = await licenceRecipients(tx, Number(licence.newsroom_id), Number(licence.licensed_by));
    for (const r of recipients) {
      await mailer.queue(tx, {
        kind: "licence_receipt",
        to: r.email,
        subject: receiptSubject(essay[0].title),
        body: receiptBody({
          title: essay[0].title,
          credit_line: creditLine,
          kind: licence.kind,
          windowStart: num(licence.window_start),
          windowEnd: num(licence.window_end),
          amountMinor: Number(licence.amount_minor),
          licenceId,
        }),
        essayId: licence.essay_id,
        licenceId,
      });
    }
    return "activated";
  });
}

// One scheduler tick. Cheap queries, all claimed atomically.
export async function tick(svc: Services): Promise<void> {
  const { sql, storage, billing, mailer, clock } = svc;
  const nowMs = clock.now();

  // 1. Embargo lifts: claim each essay whose lift instant has arrived, once,
  // even when the clock later moves back or forward. The lift instant is
  // judged by the server clock.
  const liftBefore = new Date(nowMs);
  const liftCandidates = await sql`
    UPDATE essays SET state = 'live', version = version + 1, lifted_at = ${liftBefore}
    WHERE id IN (
      SELECT id FROM essays
      WHERE state = 'embargoed' AND lifted_at IS NULL AND lift_at <= ${liftBefore}
      FOR UPDATE SKIP LOCKED
    ) RETURNING id, title, lift_at`;
  for (const essay of liftCandidates) {
    const liftAtMs = new Date(essay.lift_at).getTime();
    const creditNames = await sql`
      SELECT p.name FROM credits c JOIN people p ON p.id = c.person_id
      WHERE c.essay_id = ${essay.id} ORDER BY c.position`;
    const names = creditNames.map((c) => c.name);
    const creditLine = names.length === 1 ? `Photographs by ${names[0]}` : `Photographs by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    // One alert for each person who follows the essay, any of its credited
    // contributors, or both — deduped per person via lift_alerts.
    const followers = await sql`
      INSERT INTO lift_alerts (essay_id, person_id)
      SELECT ${essay.id}, f.person_id FROM follows f
      WHERE f.essay_id = ${essay.id} OR f.followed_handle IN (
        SELECT handle FROM credits WHERE essay_id = ${essay.id}
      )
      ON CONFLICT DO NOTHING
      RETURNING person_id`;
    for (const f of followers) {
      const person = await sql`SELECT email FROM people WHERE id = ${f.person_id}`;
      if (person.length === 0) continue;
      await mailer.queue(sql, {
        kind: "embargo_lift",
        to: person[0].email,
        subject: liftSubject(essay.title),
        body: liftBody({ title: essay.title, credit_line: creditLine, liftAt: liftAtMs }),
        essayId: essay.id,
      });
    }
  }

  // 1b. Licence ends: an active licence whose window end has passed is marked
  // expired, releasing its hold on the window and its newsroom's place.
  await sql`UPDATE licences SET state = 'expired'
            WHERE state = 'active' AND window_end <= ${BigInt(nowMs)}`;

  // 2. Licence activations and hold-deadline removals. Skip licences whose
  // next attempt is in the future.
  const due = await sql`
    SELECT id, essay_id, state, hold_until FROM licences
    WHERE state = 'pending_invoice' AND (activation_next_attempt_at IS NULL OR activation_next_attempt_at <= now())
    ORDER BY confirmed_epoch_ms`;
  for (const lic of due) {
    const now = clock.now();
    if (now >= num(lic.hold_until)) {
      // From the hold deadline, a licence that has not activated is removed
      // exactly like a billing-refused one. Wait for any activation already
      // in progress (the essay advisory lock).
      await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${essayLockKey(lic.essay_id)})`;
        const rows = await tx`SELECT state FROM licences WHERE id = ${lic.id} FOR UPDATE`;
        const row = rows[0];
        if (row && row.state === "pending_invoice") {
          await tx`DELETE FROM licences WHERE id = ${lic.id}`;
        }
      });
    } else {
      await attemptActivation(svc, lic.id);
    }
  }

  // 3. Expiry warnings, one per recipient per licence, exactly 24 elapsed
  // hours before the end instant.
  const warnDue = await sql`
    UPDATE licences SET expiry_warning_queued_at = now()
    WHERE id IN (
      SELECT l.id FROM licences l
      WHERE l.state = 'active' AND l.expiry_warning_queued_at IS NULL
        AND l.window_end - ${BigInt(nowMs)} <= 86400000
        AND l.window_end > ${BigInt(nowMs)}
        AND l.confirmed_epoch_ms <= l.window_end - 86400000
        AND NOT EXISTS (SELECT 1 FROM essays e WHERE e.id = l.essay_id AND e.taken_down_at IS NOT NULL)
      FOR UPDATE SKIP LOCKED
    ) RETURNING *`;
  for (const licence of warnDue as unknown as LicenceRow[]) {
    const essay = await sql`SELECT title, taken_down_at FROM essays WHERE id = ${licence.essay_id}`;
    if (essay.length === 0 || essay[0].taken_down_at) continue;
    const recipients = await licenceRecipients(sql, Number(licence.newsroom_id), Number(licence.licensed_by));
    for (const r of recipients) {
      await mailer.queue(sql, {
        kind: "expiry_warning",
        to: r.email,
        subject: warningSubject(essay[0].title),
        body: warningBody({
          title: essay[0].title,
          kind: licence.kind,
          windowEnd: num(licence.window_end),
          licenceId: licence.id,
        }),
        essayId: licence.essay_id,
        licenceId: licence.id,
      });
    }
  }

  // 4. Payouts: queued while billing is unreachable, retried every 5 seconds,
  // recorded exactly once per contributor.
  const payouts = await sql`
    SELECT id, month, handle, person_id, amount_minor FROM payouts
    WHERE state = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    ORDER BY id`;
  for (const payout of payouts) {
    const person = await sql`SELECT contributor_handle, name FROM people WHERE id = ${payout.person_id}`;
    if (person.length === 0) continue;
    const account = await billing.ensureContributorAccount(payout.handle);
    if (!account.ok || !account.accountId) {
      await sql`UPDATE payouts SET next_attempt_at = now() + interval '5 seconds' WHERE id = ${payout.id}`;
      continue;
    }
    const result = await billing.recordPayout(account.accountId, payout.month, payout.handle, Number(payout.amount_minor));
    if (result.ok) {
      await sql`UPDATE payouts SET state = 'recorded' WHERE id = ${payout.id}`;
    } else if (result.kind === "unavailable") {
      await sql`UPDATE payouts SET next_attempt_at = now() + interval '5 seconds' WHERE id = ${payout.id}`;
    } else {
      // A refusal leaves the payout queued for the treasurer's retry cycle.
      await sql`UPDATE payouts SET next_attempt_at = now() + interval '5 seconds' WHERE id = ${payout.id}`;
    }
  }

  // 5. Mail.
  await mailer.drain(sql);

  void storage;
  void effectiveState;
  void dollarsWithCommas;
}
