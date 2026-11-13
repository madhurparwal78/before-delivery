// Closing an account: the wait, bringing it back, and erasure everywhere.

import { Membership } from "../shared/api";
import { config } from "./config";
import { inTransaction, one, pool, rows } from "./db";
import { conflict, refuseWhileClosing } from "./errors";
import { isLive, memberRow, membershipView, type LiveMember, type MemberRow } from "./members";
import { endPlusForClosure, undoClosureCancel } from "./membership";
import { scrubAccount } from "./killbill";
import { deleteObject } from "./store";

export async function requestClosure(member: LiveMember, now: Date): Promise<void> {
  refuseWhileClosing(member.account_state);
  const before = membershipView(member);
  await endPlusForClosure(member);
  const erasesAt = new Date(now.getTime() + config.closureWaitSeconds * 1000);
  await pool.query("UPDATE members SET account_state = 'closing', erases_at = $2, membership_before_closure = $3 WHERE id = $1 AND account_state = 'active'", [
    member.id, erasesAt, JSON.stringify(before),
  ]);
}

export async function restoreAccount(row: MemberRow, now: Date): Promise<void> {
  const started = row.account_state === "erasing" || row.account_state === "erased" || (row.erases_at !== null && row.erases_at <= now);
  if (started) throw conflict("erasure_started", "This account is already being erased.");
  if (row.account_state !== "closing") throw conflict("not_closing", "This account isn't closing.");
  const snapshot = Membership.safeParse(row.membership_before_closure);
  const before = snapshot.success ? snapshot.data : membershipView(row);
  await undoClosureCancel(row, before.state);
  const restored = await one(
    pool,
    `UPDATE members SET account_state = 'active', erases_at = NULL, membership_before_closure = NULL, membership_state = $2,
     cadence = $3, renewal_date = $4, plus_until = $5, pending_cadence = $6, pending_from = $7
     WHERE id = $1 AND account_state = 'closing' AND erases_at > now() RETURNING id`,
    [row.id, before.state, before.cadence, before.renewalDate, before.plusUntil, before.pendingCadence, before.pendingFrom],
  );
  if (!restored) throw conflict("erasure_started", "This account is already being erased.");
}

// Personal data leaves the database at once; the member shows Erasing until MinIO confirms every deletion.
async function eraseFromDatabase(memberId: string): Promise<void> {
  await inTransaction(async (db) => {
    await db.query(
      `INSERT INTO erasure_objects (member_id, object_key)
       SELECT $1, 'members/' || $1 || '/draws/' || r.draw_id || '/report.pdf' FROM reports r JOIN draws d ON d.id = r.draw_id WHERE d.member_id = $1
       UNION ALL SELECT $1, 'members/' || $1 || '/attachments/' || a.id || '/original' FROM attachments a WHERE a.member_id = $1
       UNION ALL SELECT $1, 'members/' || $1 || '/attachments/' || a.id || '/clean' FROM attachments a WHERE a.member_id = $1 AND a.kind <> 'pdf'`,
      [memberId],
    );
    await db.query("DELETE FROM draws WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM plans WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM blends WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM attachments WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM messages WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM pending_mail WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM request_keys WHERE member_id = $1", [memberId]);
    await db.query("DELETE FROM rate_events WHERE person_id = $1", [memberId]);
    await db.query("DELETE FROM sessions WHERE person_id = $1", [memberId]);
    await db.query("UPDATE people SET name = 'Erased member', email = NULL, password_hash = NULL WHERE id = $1", [memberId]);
    await db.query(
      `UPDATE members SET account_state = 'erasing', phone = NULL, date_of_birth = NULL, sex = NULL, state = NULL, time_zone = NULL,
       address_line1 = NULL, address_line2 = NULL, city = NULL, postal_code = NULL, gate_notes = NULL, erases_at = NULL,
       membership_before_closure = NULL, killbill_scrub_needed = killbill_account_id IS NOT NULL WHERE id = $1`,
      [memberId],
    );
  });
}

async function finishErasing(row: MemberRow): Promise<void> {
  if (row.killbill_scrub_needed && row.killbill_account_id) {
    await scrubAccount(row.killbill_account_id);
    await pool.query("UPDATE members SET killbill_scrub_needed = false WHERE id = $1", [row.id]);
  }
  const objects = await rows<{ object_key: string }>(pool, "SELECT object_key FROM erasure_objects WHERE member_id = $1", [row.id]);
  for (const { object_key: key } of objects) {
    await deleteObject(key);
    await pool.query("DELETE FROM erasure_objects WHERE member_id = $1 AND object_key = $2", [row.id, key]);
  }
  await pool.query("UPDATE members SET account_state = 'erased' WHERE id = $1", [row.id]);
}

// Runs every second, so a member is erased within 5 seconds after `erasesAt`. An outage retries on a later run.
export async function runErasures(): Promise<void> {
  const due = await rows<{ id: string }>(pool, "SELECT id FROM members WHERE account_state = 'closing' AND erases_at <= now()");
  for (const { id } of due) await eraseFromDatabase(id);
  const erasing = await rows<{ id: string }>(pool, "SELECT id FROM members WHERE account_state = 'erasing'");
  for (const { id } of erasing) {
    const row = await memberRow(pool, id);
    if (row && !isLive(row)) await finishErasing(row);
  }
}
