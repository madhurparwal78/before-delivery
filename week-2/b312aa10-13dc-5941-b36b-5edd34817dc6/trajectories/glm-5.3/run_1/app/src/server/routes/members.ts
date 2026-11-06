import { callerOf, forbidden } from '../api-core.js';
import { ApiError } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { parseJsonBody, type Handler } from '../pipeline.js';
import { currentMonthInZone } from '../time.js';
import { hourBankObject, monthClosed } from '../serialize.js';
import { codePoints, isValidBusinessName, newId, normaliseText } from '../util.js';
import type { PoolClient } from 'pg';

const nowDate = (): Date => new Date();

interface MemberRecord {
  id: string;
  name: string;
  businessName: string;
  email?: string;
}

/** A member record carries exactly the keys for the caller's role. */
async function memberRecord(client: PoolClient, memberId: string, role: string): Promise<MemberRecord> {
  const result = await client.query<{ id: string; name: string; business_name: string; email: string }>(
    `SELECT m.id, p.name, m.business_name, p.email FROM members m JOIN people p ON p.id=m.person_id WHERE m.id=$1`,
    [memberId],
  );
  if (result.rows.length === 0) throw new ApiError('not_found');
  const row = result.rows[0];
  const record: MemberRecord = { id: row.id, name: row.name, businessName: row.business_name };
  if (role !== 'shift_lead') record.email = row.email;
  return record;
}

// ---------------------------------------------------------------------------
// GET /api/members?q= — the member picker
// ---------------------------------------------------------------------------
export const listMembers: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  await withContentionRetry(async (client) => {
    const rows = await client.query<{ id: string; name: string; business_name: string; email: string }>(
      `SELECT m.id, p.name, m.business_name, p.email FROM members m JOIN people p ON p.id=m.person_id
       WHERE m.kitchen_id=$1 ORDER BY m.business_name`,
      [caller.kitchen.id],
    );
    const members = rows.rows
      .filter((row) => {
        if (q === '') return true;
        return row.name.toLowerCase().includes(q.toLowerCase()) || row.business_name.toLowerCase().includes(q.toLowerCase());
      })
      .slice(0, 20)
      .map((row) => {
        const record: MemberRecord = { id: row.id, name: row.name, businessName: row.business_name };
        if (caller.person.role !== 'shift_lead') record.email = row.email;
        return record;
      });
    res.status(200).json({ members });
  });
};

// ---------------------------------------------------------------------------
// GET /api/members/{memberId}
// ---------------------------------------------------------------------------
export const getMember: Handler = async (req, res) => {
  const caller = callerOf(req);
  const memberId = String(req.params.memberId);
  if (caller.person.role === 'member' && caller.person.member_id !== memberId) throw new ApiError('not_found');
  await withContentionRetry(async (client) => {
    const member = await client.query<{ kitchen_id: string }>(`SELECT kitchen_id FROM members WHERE id=$1`, [memberId]);
    if (member.rows.length === 0 || member.rows[0].kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    res.status(200).json({ member: await memberRecord(client, memberId, caller.person.role) });
  });
};

// ---------------------------------------------------------------------------
// PATCH /api/members/me — business name
// ---------------------------------------------------------------------------
export const patchMember: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'member' || !caller.person.member_id) throw forbidden();
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== 'businessName') errors[key] = 'This field cannot be set.';
  }
  if (typeof body.businessName !== 'string') errors.businessName = 'This field is required.';
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  const name = normaliseText(body.businessName as string);
  if (codePoints(name) < 1 || codePoints(name) > 80 || !isValidBusinessName(name)) {
    throw new ApiError('validation_failed', { errors: { businessName: 'Business name must be 1 to 80 characters with no line breaks.' } });
  }
  await withContentionRetry(async (client) => {
    await client.query(`UPDATE members SET business_name=$1 WHERE id=$2`, [name, caller.person.member_id]);
    // The Kill Bill account name follows the saved name through the outbox.
    await client.query(`INSERT INTO outbox (id, kind, payload) VALUES ($1,'kb_account_name',$2::jsonb)`, [
      newId('out'),
      JSON.stringify({ memberId: caller.person.member_id }),
    ]);
    res.status(200).json({ member: await memberRecord(client, caller.person.member_id!, 'member') });
  });
};

// ---------------------------------------------------------------------------
// GET /api/members/{memberId}/hour-bank?month=
// ---------------------------------------------------------------------------
export const memberHourBank: Handler = async (req, res) => {
  const caller = callerOf(req);
  const memberId = String(req.params.memberId);
  if (caller.person.role === 'member' && caller.person.member_id !== memberId) throw new ApiError('not_found');
  let month = currentMonthInZone(nowDate(), caller.kitchen.time_zone);
  if (typeof req.query.month === 'string') {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) {
      throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
    }
    month = req.query.month;
  }
  await withContentionRetry(async (client) => {
    const member = await client.query<{ kitchen_id: string }>(`SELECT kitchen_id FROM members WHERE id=$1`, [memberId]);
    if (member.rows.length === 0 || member.rows[0].kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    res.status(200).json(await hourBankObject(client, memberId, month));
  });
};

export { memberRecord };
