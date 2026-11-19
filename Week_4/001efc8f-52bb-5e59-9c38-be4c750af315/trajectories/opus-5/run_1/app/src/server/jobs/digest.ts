import { query, withTransaction } from '../db';
import { config } from '../config';
import { nowMs } from '../clock';
import { businessDate, businessDateLabel, formatWhen, startOfBusinessDay } from '../../shared/zone';
import { deliverMail } from '../services/mail';
import { noteMail } from '../services/health';

const DIGEST_HOUR = 7;

interface WorkspaceRow {
  id: string;
  time_zone: string;
}

interface EligibleMention {
  mention_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  channel_id: string;
  channel_name: string;
  channel_private: boolean;
  author_name: string;
  text: string;
  created_at: Date;
  still_member: boolean;
}

interface Period {
  key: string;
  startMs: number;
}

/** The period a digest covers, and the instant its run becomes due. */
function currentPeriod(zone: string, at: number): Period | null {
  if (config.digestIntervalSeconds !== null) {
    const windowMs = config.digestIntervalSeconds * 1000;
    const startMs = Math.floor(at / windowMs) * windowMs;
    return { key: `window:${startMs}`, startMs };
  }
  const runAt = startOfBusinessDay(at, zone, DIGEST_HOUR);
  if (at < runAt) return null;
  return { key: `date:${businessDate(at, zone)}`, startMs: runAt };
}

/**
 * Whether a mention is answered is derived at each run from surviving later
 * replies by that person in the same thread, never stored as a flag.
 */
const ELIGIBLE_SQL = `
  SELECT mention.id AS mention_id, mention.user_id, recipient.name AS user_name, recipient.email AS user_email,
         mention.channel_id, c.name AS channel_name, c.private AS channel_private,
         author.name AS author_name, m.text, mention.created_at,
         EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = mention.channel_id AND cm.user_id = mention.user_id) AS still_member
  FROM mentions mention
  JOIN messages m ON m.id = mention.message_id AND m.deleted = false
  JOIN channels c ON c.id = mention.channel_id
  JOIN users recipient ON recipient.id = mention.user_id AND recipient.status = 'active'
  JOIN users author ON author.id = m.author_id
  WHERE mention.workspace_id = $1
    AND mention.handled_at IS NULL
    AND mention.created_at <= $2
    AND NOT EXISTS (
      SELECT 1 FROM messages reply
      WHERE reply.author_id = mention.user_id
        AND reply.deleted = false
        AND reply.sent_at > mention.created_at
        AND reply.thread_root_id = COALESCE(mention.thread_root_id, mention.message_id))
  ORDER BY mention.created_at ASC`;

function digestBody(lines: string[]): string {
  return [...lines, '', `${config.publicUrl}/`, ''].join('\n');
}

function quotedLine(mention: EligibleMention, zone: string): string[] {
  const header = `#${mention.channel_name} · ${mention.author_name} · ${formatWhen(mention.created_at.getTime(), zone)}`;
  if (mention.channel_private) {
    return [`${header} — private channel, open Rimewire to read it.`];
  }
  return [header, `"${mention.text.slice(0, 140)}"`];
}

async function runWorkspaceDigest(workspace: WorkspaceRow, at: number): Promise<void> {
  const period = currentPeriod(workspace.time_zone, at);
  if (period === null) return;
  const done = await query<{ period: string }>(
    'SELECT period FROM digest_runs WHERE workspace_id = $1 AND period = $2',
    [workspace.id, period.key],
  );
  if (done.length > 0) return;

  const threshold = new Date(at - config.mentionUnansweredSeconds * 1000);
  const mentions = await query<EligibleMention>(ELIGIBLE_SQL, [workspace.id, threshold]);

  const byRecipient = new Map<string, EligibleMention[]>();
  for (const mention of mentions) {
    const list = byRecipient.get(mention.user_id) ?? [];
    list.push(mention);
    byRecipient.set(mention.user_id, list);
  }

  let allDelivered = true;
  for (const [, list] of byRecipient) {
    const listed = list.filter((mention) => mention.still_member);
    const leftOut = list.filter((mention) => !mention.still_member);
    if (leftOut.length > 0) await markHandled(leftOut.map((mention) => mention.mention_id), period.key, at);
    if (listed.length === 0) continue;
    const sent = await sendDigest(listed, workspace.time_zone, period, at);
    if (!sent) allDelivered = false;
  }

  if (allDelivered) {
    await query(
      'INSERT INTO digest_runs (workspace_id, period, completed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [workspace.id, period.key, new Date(at)],
    );
  }
}

async function markHandled(mentionIds: string[], period: string, at: number): Promise<void> {
  await query('UPDATE mentions SET handled_at = $2, handled_period = $3 WHERE id = ANY($1::uuid[])', [
    mentionIds,
    new Date(at),
    period,
  ]);
}

async function sendDigest(
  listed: EligibleMention[],
  zone: string,
  period: Period,
  at: number,
): Promise<boolean> {
  const first = listed[0] as EligibleMention;
  const lines = listed.flatMap((mention) => quotedLine(mention, zone));
  const count = listed.length;
  const subject = `Rimewire: ${count} unanswered ${count === 1 ? 'mention' : 'mentions'} for ${businessDateLabel(
    period.startMs,
    zone,
  )}`;
  try {
    return await withTransaction(async (client) => {
      const claimed = await client.query(
        'INSERT INTO digest_deliveries (user_id, period, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id',
        [first.user_id, period.key, new Date(at)],
      );
      if (claimed.rowCount === 0) return true;
      await client.query('UPDATE mentions SET handled_at = $2, handled_period = $3 WHERE id = ANY($1::uuid[])', [
        listed.map((mention) => mention.mention_id),
        new Date(at),
        period.key,
      ]);
      await deliverMail({
        toAddress: first.user_email,
        toName: first.user_name,
        subject,
        body: digestBody(lines),
      });
      noteMail(true);
      return true;
    });
  } catch {
    noteMail(false);
    return false;
  }
}

export async function runDigests(): Promise<void> {
  const workspaces = await query<WorkspaceRow>('SELECT id, time_zone FROM workspaces');
  const at = nowMs();
  for (const workspace of workspaces) await runWorkspaceDigest(workspace, at);
}
