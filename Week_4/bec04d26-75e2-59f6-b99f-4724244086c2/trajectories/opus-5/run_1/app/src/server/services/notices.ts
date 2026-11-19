import { ReturnRecord } from '../../shared/types';
import { newId } from '../auth';
import { Tx } from '../db';

export type NoticeKind =
  | 'reminder_7'
  | 'reminder_1'
  | 'approval_request'
  | 'approved'
  | 'sent_back'
  | 'filed';

function amount(value: string | null): string {
  return value ?? '0.00';
}

function link(record: ReturnRecord): string {
  return `/returns/${record.id}`;
}

export function reminderMessage(
  record: ReturnRecord,
  leadDays: 7 | 1,
): { subject: string; body: string } {
  const lead = leadDays === 7 ? 'due in 7 days' : 'due in 1 day';
  return {
    subject: `${record.client.name} ${record.state} ${record.period_label} ${lead}`,
    body: [
      `${record.client.name} ${record.state_name} ${record.period_label} is ${lead}.`,
      record.due_line,
      link(record),
    ].join('\n'),
  };
}

export function approvalRequestMessage(record: ReturnRecord): { subject: string; body: string } {
  return {
    subject: `Please approve ${record.client.name} ${record.state} ${record.period_label}`,
    body: [
      `${record.client.name} ${record.state_name} ${record.period_label} is ready for your approval.`,
      `Gross sales ${amount(record.gross_sales)}`,
      `Tax due ${amount(record.tax_due)}`,
      record.due_line,
      link(record),
    ].join('\n'),
  };
}

export function approvedMessage(
  record: ReturnRecord,
  ownerName: string,
): { subject: string; body: string } {
  return {
    subject: `${record.client.name} approved ${record.state} ${record.period_label}`,
    body: [
      `${ownerName} approved ${record.client.name} ${record.state_name} ${record.period_label}.`,
      `Gross sales ${amount(record.gross_sales)}`,
      `Tax due ${amount(record.tax_due)}`,
      link(record),
    ].join('\n'),
  };
}

export function sentBackMessage(
  record: ReturnRecord,
  ownerName: string,
  reason: string,
): { subject: string; body: string } {
  return {
    subject: `${record.client.name} sent back ${record.state} ${record.period_label}`,
    body: [
      `${ownerName} sent back ${record.client.name} ${record.state_name} ${record.period_label}.`,
      `Reason: ${reason}`,
      link(record),
    ].join('\n'),
  };
}

export function filedMessage(record: ReturnRecord): { subject: string; body: string } {
  return {
    subject: `${record.client.name} ${record.state} ${record.period_label} was filed`,
    body: [
      `${record.client.name} ${record.state_name} ${record.period_label} was filed.`,
      record.due_line,
      `Gross sales ${amount(record.gross_sales)}`,
      `Tax due ${amount(record.tax_due)}`,
      link(record),
    ].join('\n'),
  };
}

export async function queueNotice(
  tx: Tx,
  practiceId: string,
  returnId: string | null,
  kind: NoticeKind,
  recipient: string,
  message: { subject: string; body: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO mail_jobs (id, practice_id, return_id, kind, recipient, subject, body, created_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [newId(), practiceId, returnId, kind, recipient, message.subject, message.body, Date.now()],
  );
}
