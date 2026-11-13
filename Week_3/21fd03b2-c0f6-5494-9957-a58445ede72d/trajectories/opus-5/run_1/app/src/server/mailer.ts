import { ROLE_LABELS, type InviteRole } from '../shared/states.js';
import { publicAddress } from './config.js';
import { one, query } from './db.js';
import { newId } from './ids.js';
import { sendMail } from './smtp.js';

export type Delivery = 'sent' | 'queued';
type MailKind = 'invite' | 'role' | 'share' | 'publish';

interface OutboxRow {
  id: string;
  kind: MailKind;
  recipient: string;
  subject: string;
  body: string;
  ref_id: string | null;
}

async function stillLive(row: OutboxRow): Promise<boolean> {
  if (row.kind === 'invite' && row.ref_id) {
    const invite = await one<{ status: string; expires_at: Date }>(
      'select status, expires_at from invites where id = $1',
      [row.ref_id],
    );
    if (!invite) return false;
    return invite.status === 'pending' && invite.expires_at.getTime() > Date.now();
  }
  if (row.kind === 'share' && row.ref_id) {
    const link = await one<{ active: boolean; expires_at: Date }>(
      'select active, expires_at from share_links where id = $1',
      [row.ref_id],
    );
    if (!link) return false;
    return link.active && link.expires_at.getTime() > Date.now();
  }
  return true;
}

/** Writes the message to the outbox in the same step as the action, then tries to send it. */
export async function queueMessage(message: {
  kind: MailKind;
  recipient: string;
  subject: string;
  body: string;
  refId?: string;
}): Promise<Delivery> {
  const id = newId();
  await query(
    'insert into outbox (id, kind, recipient, subject, body, ref_id) values ($1,$2,$3,$4,$5,$6)',
    [id, message.kind, message.recipient, message.subject, message.body, message.refId ?? null],
  );
  const claimed = await claim(id);
  if (!claimed) return 'queued';
  return (await deliver(claimed)) ? 'sent' : 'queued';
}

async function claim(id?: string): Promise<OutboxRow | null> {
  const rows = await query<OutboxRow>(
    `update outbox set claimed_at = now(), attempts = attempts + 1
      where id = (
        select id from outbox
         where sent_at is null and dropped_at is null
           and (claimed_at is null or claimed_at < now() - interval '30 seconds')
           ${id ? 'and id = $1' : ''}
         order by created_at, id
         for update skip locked
         limit 1)
      returning id, kind, recipient, subject, body, ref_id`,
    id ? [id] : [],
  );
  return rows.length > 0 ? rows[0] : null;
}

async function deliver(row: OutboxRow): Promise<boolean> {
  if (!(await stillLive(row))) {
    await query('update outbox set dropped_at = now() where id = $1', [row.id]);
    return true;
  }
  try {
    await sendMail({ to: row.recipient, subject: row.subject, body: row.body });
    await query('update outbox set sent_at = now() where id = $1', [row.id]);
    return true;
  } catch {
    await query('update outbox set claimed_at = null where id = $1', [row.id]);
    return false;
  }
}

export function startOutboxWorker(): void {
  let busy = false;
  const tick = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      for (let sent = 0; sent < 20; sent += 1) {
        const row = await claim();
        if (!row) break;
        if (!(await deliver(row))) break;
      }
    } catch {
      /* the next tick retries */
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), 5_000).unref();
  void tick();
}

/* ----------------------------------------------------------- templates --- */

export function inviteMessage(input: {
  inviter: string;
  workspaceName: string;
  email: string;
  role: InviteRole;
  token: string;
  expiresAt: string;
}): { recipient: string; subject: string; body: string } {
  const link = publicAddress(`/invite/${input.token}`);
  return {
    recipient: input.email,
    subject: `${input.inviter} invited you to ${input.workspaceName} on Rampwright`,
    body: [
      `${input.inviter} invited you to the workspace ${input.workspaceName} on Rampwright.`,
      `Your role will be ${ROLE_LABELS[input.role]}.`,
      `Accept the invite: ${link}`,
      `This invite expires at ${input.expiresAt}.`,
    ].join('\n'),
  };
}

export function roleChangeMessage(input: {
  email: string;
  workspaceName: string;
  role: InviteRole;
}): { recipient: string; subject: string; body: string } {
  const label = ROLE_LABELS[input.role];
  return {
    recipient: input.email,
    subject: `Your role in ${input.workspaceName} is now ${label}`,
    body: [
      `Your role in the workspace ${input.workspaceName} on Rampwright is now ${label}.`,
      label === 'Editor'
        ? 'You can build and edit scenes in this workspace.'
        : 'You can read scenes and the activity log, and run scenes.',
    ].join('\n'),
  };
}

export function shareMessage(input: {
  sharer: string;
  projectName: string;
  email: string;
  token: string;
  expiresAt: string;
}): { recipient: string; subject: string; body: string } {
  return {
    recipient: input.email,
    subject: `${input.sharer} shared ${input.projectName} with you`,
    body: [
      `${input.sharer} shared the project ${input.projectName} with you on Rampwright.`,
      `Open it here: ${publicAddress(`/view/${input.token}`)}`,
      `This link expires at ${input.expiresAt}.`,
    ].join('\n'),
  };
}

export function publishMessage(input: {
  email: string;
  sceneName: string;
  token: string;
  bundleHash: string;
}): { recipient: string; subject: string; body: string } {
  return {
    recipient: input.email,
    subject: `Lab published: ${input.sceneName}`,
    body: [
      `Your lab for ${input.sceneName} is published.`,
      `Lab address: ${publicAddress(`/lab/${input.token}`)}`,
      `Bundle hash: ${input.bundleHash}`,
    ].join('\n'),
  };
}
