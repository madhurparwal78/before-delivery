import { MemberRow } from '../data';
import { query } from '../db';
import { deleteObject } from './s3';
import { eraseAccount } from './killbill';

async function objectKeysOf(memberId: string): Promise<string[]> {
  const reports = await query<{ object_key: string }>(
    `select r.object_key from reports r join draws d on d.id = r.draw_id where d.member_id = $1`,
    [memberId],
  );
  const attachments = await query<{ original_key: string; clean_key: string | null }>(
    'select original_key, clean_key from attachments where member_id = $1',
    [memberId],
  );
  return [
    ...reports.map((row) => row.object_key),
    ...attachments.flatMap((row) => [row.original_key, ...(row.clean_key ? [row.clean_key] : [])]),
  ];
}

/** Erases the member everywhere, then confirms every MinIO deletion before `erased`. */
export async function eraseMember(member: MemberRow): Promise<void> {
  const keys = await objectKeysOf(member.id);
  await query("update members set account_state = 'erasing' where id = $1", [member.id]);
  if (member.killbill_account_id) {
    await eraseAccount(member.killbill_account_id).catch(() => undefined);
  }
  await query('delete from pending_mail where member_id = $1 and sent_at is null', [member.id]);
  await query('delete from sessions where person_kind = $1 and person_id = $2', [
    'member',
    member.id,
  ]);
  await query('delete from draws where member_id = $1', [member.id]);
  await query('delete from plans where member_id = $1', [member.id]);
  await query('delete from blends where member_id = $1', [member.id]);
  await query('delete from messages where member_id = $1', [member.id]);
  await query('delete from attachments where member_id = $1', [member.id]);
  await query('delete from threads where member_id = $1', [member.id]);
  await query('delete from rate_events where member_id = $1', [member.id]);
  await query('delete from request_keys where member_id = $1', [member.id]);
  await query(
    `update members set name = null, email = null, password_hash = null, phone = null,
       address_line1 = null, address_line2 = null, city = null, postal_code = null,
       gate_notes = null, date_of_birth = null where id = $1`,
    [member.id],
  );
  for (const key of keys) {
    await deleteObject(key);
  }
  await query("update members set account_state = 'erased', erases_at = null where id = $1", [
    member.id,
  ]);
}

export function startErasureLoop(): void {
  const tick = async (): Promise<void> => {
    try {
      const due = await query<MemberRow>(
        `select * from members where account_state in ('closing', 'erasing')
           and (erases_at is null or erases_at <= now())`,
      );
      for (const member of due) {
        if (member.account_state === 'closing' && member.erases_at === null) continue;
        await eraseMember(member).catch(() => undefined);
      }
    } catch {
      // The next tick tries again.
    }
    setTimeout(() => void tick(), 2000);
  };
  setTimeout(() => void tick(), 2000);
}
