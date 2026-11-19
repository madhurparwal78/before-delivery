import { pool, getPractice, getStates, getEditions } from '../db.js';
import { practiceNow, type StateRow as DomainState } from '../domain/due.js';
import { reminderScheduledFor } from '../../shared/reminders.js';
import { dateLine } from '../domain/labels.js';
import { zoneLabel, periodLabel } from '../../shared/periods.js';
import { renderPacketHtml } from './packetHtml.js';
import { sendMail, renderPdf, mailUp, pdfUp } from './outbound.js';
export { SERVICE_RETRY_SECONDS } from './outbound.js';
import { serializeReturn } from '../serialize.js';
import { getReturnById } from '../returns.js';
import { emitEvent } from '../live.js';
import { newId } from '../domain/passwords.js';

const BASE_FALLBACK = `http://localhost:${process.env.APP_PUBLIC_PORT ?? '4173'}`;

export type ReminderLead = 7 | 1;
export const REMINDER_LEADS: ReminderLead[] = [7, 1];

export async function loadState(practiceId: string, code: string): Promise<DomainState | null> {
  const states = await getStates(practiceId);
  const state = states.find((s) => s.code === code);
  if (state === undefined) return null;
  const editions = await getEditions(practiceId);
  return {
    code: state.code,
    name: state.name,
    zone: state.zone,
    holidays: state.holidays,
    editions: editions.filter((e) => e.state_code === code),
  };
}

/**
 * Recompute a return's unsent reminders from its current due date.
 * Sent records stay when a due date changes; filing cancels unsent ones.
 */
export async function syncReminders(returnId: string): Promise<void> {
  const row = await getReturnById(returnId);
  if (row === null) return;
  const practice = await getPractice(row.practice_id);
  const state = await loadState(row.practice_id, row.state_code);
  if (practice === null || state === null) return;
  const unfiled = row.status === 'not_started' || row.status === 'prepared' || row.status === 'client_approved';
  for (const lead of REMINDER_LEADS) {
    if (!unfiled) {
      await pool.query(`delete from reminders where return_id = $1 and lead_days = $2 and status = 'pending'`, [
        returnId,
        lead,
      ]);
      continue;
    }
    const scheduled = reminderScheduledFor(row.due_date, state.zone, lead, practice.reminder_hour);
    await pool.query(
      `insert into reminders (id, return_id, lead_days, scheduled_for, status)
       values ($1, $2, $3, $4, 'pending')
       on conflict (return_id, lead_days)
       do update set scheduled_for = excluded.scheduled_for`,
      [`${returnId}:r${lead}`, returnId, lead, scheduled],
    );
  }
}

/** Queue the one notice per event; the first payload wins. */
export async function queueNotice(kind: string, returnId: string, payload: Record<string, unknown>): Promise<void> {
  await pool.query(
    `insert into notices (id, practice_id, kind, return_id, payload, status, created_at)
     values ($1, (select practice_id from returns where id = $2), $3, $2, $4, 'pending', now())
     on conflict (kind, return_id) do nothing`,
    [newId('notice'), returnId, kind, JSON.stringify(payload)],
  );
}

/** All pending notices for a practice: queued reminders, approval requests and event notices. */
export async function runNotices(practiceId: string, now: Date): Promise<void> {
  const practice = await getPractice(practiceId);
  if (practice === null) return;
  const pending = await pool.query(
    `select n.id, n.kind, n.payload, n.return_id from notices n
     where n.practice_id = $1 and n.status = 'pending'
     order by n.created_at limit 200`,
    [practiceId],
  );
  for (const notice of pending.rows) {
    if (!mailUp()) return;
    const sent = await deliverNotice(notice.kind, notice.return_id, notice.payload, practiceId, now);
    if (!sent) return;
    await pool.query(`update notices set status = 'sent', sent_at = $1 where id = $2`, [now, notice.id]);
  }
}

async function deliverNotice(
  kind: string,
  returnId: string,
  payload: Record<string, unknown>,
  practiceId: string,
  now: Date,
): Promise<boolean> {
  const row = await getReturnById(returnId);
  if (row === null) return true;
  const ret = await serializeReturn(row, now);
  switch (kind) {
    case 'approval_request': {
      const owner = await pool.query('select email from users where client_id = $1 and role = $2', [row.client_id, 'owner']);
      const to = owner.rows[0]?.email as string | undefined;
      if (to === undefined) return true;
      const subject = `Please approve ${row.client_name} ${row.state_code} ${periodLabel(row.period)}`;
      const body = `Please approve ${row.client_name} ${row.state_code} ${periodLabel(row.period)}.\nGross sales ${ret.gross_sales ?? '0.00'}\nTax due ${ret.tax_due ?? '0.00'}\n${ret.due_line}\n${BASE_FALLBACK}/returns/${row.id}\n`;
      return sendMail(to, subject, body);
    }
    case 'approved_notice': {
      const bookkeeper = await pool.query(
        `select email from users where practice_id = $1 and role = 'bookkeeper' limit 1`,
        [practiceId],
      );
      const to = bookkeeper.rows[0]?.email as string | undefined;
      if (to === undefined) return true;
      const ownerName = String(payload.owner_name ?? '');
      const subject = `${row.client_name} approved ${row.state_code} ${periodLabel(row.period)}`;
      const body = `${ownerName} approved ${row.client_name} ${row.state_code} ${periodLabel(row.period)}.\nGross sales ${ret.gross_sales ?? '0.00'}\nTax due ${ret.tax_due ?? '0.00'}\n`;
      return sendMail(to, subject, body);
    }
    case 'sent_back_notice': {
      const bookkeeper = await pool.query(
        `select email from users where practice_id = $1 and role = 'bookkeeper' limit 1`,
        [practiceId],
      );
      const to = bookkeeper.rows[0]?.email as string | undefined;
      if (to === undefined) return true;
      const ownerName = String(payload.owner_name ?? '');
      const reason = String(payload.reason ?? '');
      const subject = `${row.client_name} sent back ${row.state_code} ${periodLabel(row.period)}`;
      const body = `${ownerName} sent back ${row.client_name} ${row.state_code} ${periodLabel(row.period)}.\nReason: ${reason}\n`;
      return sendMail(to, subject, body);
    }
    case 'filed_notice': {
      const owner = await pool.query('select email from users where client_id = $1 and role = $2', [row.client_id, 'owner']);
      const to = owner.rows[0]?.email as string | undefined;
      if (to === undefined) return true;
      const subject = `${row.client_name} ${row.state_code} ${periodLabel(row.period)} was filed`;
      const body = `${row.client_name} ${row.state_code} ${periodLabel(row.period)} was filed.\n${ret.due_line}\nGross sales ${ret.gross_sales ?? '0.00'}\nTax due ${ret.tax_due ?? '0.00'}\n`;
      return sendMail(to, subject, body);
    }
    default:
      return true;
  }
}

export async function runReminders(practiceId: string, now: Date): Promise<void> {
  const practice = await getPractice(practiceId);
  if (practice === null) return;
  const due = await pool.query(
    `select rm.id, rm.lead_days, r.id as return_id from reminders rm
     join returns r on r.id = rm.return_id
     where rm.status = 'pending' and rm.scheduled_for <= $1 and r.practice_id = $2
     order by rm.scheduled_for
     limit 200`,
    [now, practiceId],
  );
  for (const reminder of due.rows) {
    const returnRow = await getReturnById(reminder.return_id);
    if (returnRow === null) continue;
    const lead = reminder.lead_days as ReminderLead;
    const subject = `${returnRow.client_name} ${returnRow.state_code} ${periodLabel(returnRow.period)} due in ${lead} ${lead === 1 ? 'day' : 'days'}`;
    const body = `${returnRow.client_name} ${returnRow.state_code} ${periodLabel(returnRow.period)} is due in ${lead} ${lead === 1 ? 'day' : 'days'}.\nDue ${dateLine(returnRow.due_date)}, 11:59 pm ${zoneLabel(returnRow.zone)}\n${BASE_FALLBACK}/returns/${returnRow.id}\n`;
    const bookkeeper = await pool.query(
      `select email from users where practice_id = $1 and role = 'bookkeeper' limit 1`,
      [practiceId],
    );
    const to = bookkeeper.rows[0]?.email as string | undefined;
    if (to === undefined) continue;
    if (!mailUp()) return;
    const accepted = await sendMail(to, subject, body);
    if (accepted) {
      await pool.query(
        `update reminders set status = 'sent', sent_at = $1 where id = $2`,
        [practiceNow(practice.clock_now), reminder.id],
      );
      emitEvent(practiceId, {
        kind: 'reminder_sent',
        return_id: returnRow.id,
        lead_days: lead,
        client: returnRow.client_name,
        state: returnRow.state_code,
        period_label: periodLabel(returnRow.period),
      });
    } else {
      return;
    }
  }
}

/** Render queued packets; the return only becomes packeted when Gotenberg returns the bytes. */
export async function runPackets(practiceId: string, now: Date): Promise<void> {
  if (!pdfUp()) return;
  const pending = await pool.query(
    `select r.id from returns r where r.practice_id = $1 and r.packet_state = 'pending' limit 20`,
    [practiceId],
  );
  for (const row of pending.rows) {
    const returnRow = await getReturnById(row.id);
    if (returnRow === null) continue;
    if (returnRow.status !== 'filed' && returnRow.status !== 'amended') continue;
    const ret = await serializeReturn(returnRow, now);
    const html = renderPacketHtml(ret, returnRow.packet_revisions + 1);
    const bytes = await renderPdf(html);
    if (bytes === null) return;
    await pool.query(
      `insert into packets (return_id, revision, bytes, created_at) values ($1, $2, $3, now())`,
      [returnRow.id, returnRow.packet_revisions + 1, bytes],
    );
    await pool.query(
      `update returns set packet_state = 'ready', packet_revisions = packet_revisions + 1,
       version = version + 1 where id = $1`,
      [returnRow.id],
    );
    emitEvent(practiceId, {
      kind: 'packet_ready',
      return_id: returnRow.id,
      client: returnRow.client_name,
      state: returnRow.state_code,
      period_label: periodLabel(returnRow.period),
      revision: returnRow.packet_revisions + 1,
    });
  }
}

/** One pass of waiting work for a practice: reminders, notices, packets. */
export async function runWorkOnce(practiceId: string, now: Date): Promise<void> {
  await runReminders(practiceId, now);
  await runNotices(practiceId, now);
  await runPackets(practiceId, now);
}

