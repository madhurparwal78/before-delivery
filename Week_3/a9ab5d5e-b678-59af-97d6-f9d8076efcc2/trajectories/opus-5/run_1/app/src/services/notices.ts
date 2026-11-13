import { PoolClient } from 'pg';
import { config } from '../config';
import { Household } from '../db/repo';
import { nextId } from '../db';
import { ParentRole } from '../domain/plan';

export type NoticeKind = 'invite' | 'request_sent' | 'reminder' | 'answered' | 'lapsed' | 'amendment' | 'record_ready';

export interface NoticePlan {
  kind: NoticeKind;
  toRole: ParentRole;
  subject: string;
  link: string;
  requestTable?: 'swaps' | 'costs';
  requestId?: string;
}

export function inviteNotice(household: Household, token: string): NoticePlan {
  return {
    kind: 'invite',
    toRole: 'other',
    subject: `You're invited to ${household.name} on Twohouse`,
    link: `/join/${token}`,
  };
}

export function requestSentNotice(
  household: Household,
  answerer: ParentRole,
  table: 'swaps' | 'costs',
  requestId: string,
): NoticePlan {
  const kindWord = table === 'swaps' ? 'Swap request' : 'Reimbursement request';
  return {
    kind: 'request_sent',
    toRole: answerer,
    subject: `${kindWord} in ${household.name}`,
    link: '/requests',
    requestTable: table,
    requestId,
  };
}

export function reminderNotice(
  household: Household,
  answerer: ParentRole,
  table: 'swaps' | 'costs',
  requestId: string,
): NoticePlan {
  return {
    kind: 'reminder',
    toRole: answerer,
    subject: `Answer needed in ${household.name}`,
    link: '/requests',
    requestTable: table,
    requestId,
  };
}

export function answeredNotice(household: Household, creator: ParentRole, accepted: boolean): NoticePlan {
  return {
    kind: 'answered',
    toRole: creator,
    subject: `Your request was ${accepted ? 'accepted' : 'declined'} in ${household.name}`,
    link: '/requests',
  };
}

export function lapsedNotice(household: Household, toRole: ParentRole): NoticePlan {
  return {
    kind: 'lapsed',
    toRole,
    subject: `A request lapsed in ${household.name}`,
    link: '/requests',
  };
}

export function amendmentNotice(household: Household): NoticePlan {
  return {
    kind: 'amendment',
    toRole: 'other',
    subject: `Plan amendment recorded in ${household.name}`,
    link: '/plan',
  };
}

export function recordReadyNotice(household: Household, toRole: ParentRole): NoticePlan {
  return {
    kind: 'record_ready',
    toRole,
    subject: `Year record ready in ${household.name}`,
    link: '/records',
  };
}

export function noticeBody(household: Household): string {
  return `${household.name}: open Twohouse to see the details.`;
}

/** Transactional outbox: one row per recipient, written with the state change. */
export async function queueNotices(
  client: PoolClient,
  household: Household,
  plans: NoticePlan[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const plan of plans) {
    const id = await nextId(client);
    const parent = plan.toRole === 'planning' ? household.planning : household.other;
    await client.query(
      `INSERT INTO notices (id, household_id, kind, to_email, to_role, subject, link, status, request_table, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9)`,
      [
        id,
        household.id,
        plan.kind,
        parent.email,
        plan.toRole,
        plan.subject,
        `${config.publicUrl}${plan.link}`,
        plan.requestTable ?? null,
        plan.requestId ?? null,
      ],
    );
    ids.push(id);
  }
  return ids;
}

/** A queued invite killed by a newer invite never reaches SMTP. */
export async function supersedeQueuedInvites(client: PoolClient, householdId: string): Promise<void> {
  await client.query(
    "UPDATE notices SET status = 'superseded' WHERE household_id = $1 AND kind = 'invite' AND status = 'queued'",
    [householdId],
  );
}

/** A queued reminder whose request is no longer sent never reaches SMTP. */
export async function supersedeQueuedReminders(
  client: PoolClient,
  householdId: string,
  table: 'swaps' | 'costs',
  requestId: string,
): Promise<void> {
  await client.query(
    `UPDATE notices SET status = 'superseded'
     WHERE household_id = $1 AND kind = 'reminder' AND status = 'queued' AND request_table = $2 AND request_id = $3`,
    [householdId, table, requestId],
  );
}
