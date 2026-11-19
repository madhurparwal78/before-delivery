import type { AppServices } from './context';
import { formatBusinessDate, formatLocalDateTime, getLocalParts } from './datetime';

interface MentionRow {
  id: string;
  message_id: string;
  channel_id: string;
  mentioned_user_id: string;
  created_at: Date;
}

interface ChannelInfo {
  id: string;
  name: string;
  private: boolean;
}

/**
 * The answered-mention derivation and digest eligibility, decided only here.
 * A mention is answered only when, at digest time, the mentioned person has a
 * surviving later reply in the same thread (or to the mention itself when the
 * mention is top-level).
 */
export async function unansweredMentionsFor(services: AppServices, userId: string): Promise<MentionRow[]> {
  const res = await services.db.pool.query(
    `SELECT mn.id, mn.message_id, mn.channel_id, mn.mentioned_user_id, mn.created_at
       FROM mentions mn
       JOIN messages m ON m.id = mn.message_id
      WHERE mn.mentioned_user_id = $1 AND m.deleted = false
        AND mn.digested_at IS NULL
        AND mn.created_at <= $2
        AND EXISTS (SELECT 1 FROM memberships ms WHERE ms.channel_id = mn.channel_id AND ms.user_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM messages r
           WHERE r.author_id = $1
             AND r.deleted = false
             AND r.sent_at > m.sent_at
             AND (r.thread_root_id = m.thread_root_id
                  OR (m.thread_root_id IS NULL AND r.thread_root_id = m.id)))`,
    [userId, new Date(services.clock.nowMs() - services.config.mentionUnansweredSeconds * 1000)],
  );
  return res.rows;
}

export async function runDigests(services: AppServices): Promise<void> {
  const now = services.clock.now();
  const workspaces = await services.db.pool.query('SELECT id, time_zone FROM workspaces');
  for (const ws of workspaces.rows) {
    const zone = ws.time_zone as string;
    let periodKey: string;
    if (services.config.digestIntervalSeconds !== null) {
      const windowStart = Math.floor(now.getTime() / 1000 / services.config.digestIntervalSeconds) * services.config.digestIntervalSeconds;
      periodKey = `w:${windowStart}`;
      const dueMs = windowStart * 1000;
      if (now.getTime() < dueMs) continue;
    } else {
      const local = getLocalParts(zone, now);
      const beforeSeven = local.hour < 7 || (local.hour === 7 && local.minute < 0);
      if (beforeSeven) continue;
      periodKey = `d:${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
      // Only run when we are within the 24h after 07:00 on this business date.
      const sevenToday = localSevenInstant(zone, now, local);
      if (now.getTime() < sevenToday.getTime()) continue;
      if (now.getTime() > sevenToday.getTime() + 24 * 3600000) continue;
    }
    await runForWorkspace(services, ws.id, zone, periodKey, now);
  }
}

function localSevenInstant(zone: string, now: Date, local: { year: number; month: number; day: number }): Date {
  const date = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const { localTimeToInstant } = require('./scheduled-domain') as typeof import('./scheduled-domain');
  return localTimeToInstant(zone, date, '07:00:00', now);
}

export async function runForWorkspace(services: AppServices, workspaceId: string, zone: string, periodKey: string, now: Date): Promise<void> {
  const people = await services.db.pool.query(
    `SELECT id, name, email, status FROM users WHERE workspace_id = $1 AND status = 'active'`,
    [workspaceId],
  );
  const businessDate = formatBusinessDate(zone, now);
  for (const person of people.rows) {
    const already = await services.outbox.wasSent('digest', `${person.id}:${periodKey}`);
    const handled = await services.db.pool.query(
      'SELECT 1 FROM digest_periods WHERE user_id = $1 AND period_key = $2',
      [person.id, periodKey],
    );
    if (already || (handled.rowCount ?? 0) > 0) continue;
    const mentions = await unansweredMentionsFor(services, person.id);
    if (mentions.length === 0) {
      await services.outbox.markDigestSent(person.id, periodKey);
      continue;
    }
    const lines: string[] = [];
    let count = 0;
    const markedMentionIds: string[] = [];
    for (const mention of mentions) {
      const channelRes = await services.db.pool.query(
        'SELECT id, name, private FROM channels WHERE id = $1',
        [mention.channel_id],
      );
      const channel: ChannelInfo = channelRes.rows[0];
      const messageRes = await services.db.pool.query(
        'SELECT text, sent_at, author_id FROM messages WHERE id = $1 AND deleted = false',
        [mention.message_id],
      );
      if (messageRes.rowCount === 0) continue;
      const authorRes = await services.db.pool.query('SELECT name FROM users WHERE id = $1', [messageRes.rows[0].author_id]);
      const when = formatLocalDateTime(zone, messageRes.rows[0].sent_at);
      if (channel.private) {
        lines.push(`#${channel.name} · ${authorRes.rows[0].name} · ${when} — private channel, open Rimewire to read it.`);
      } else {
        lines.push(`#${channel.name} · ${authorRes.rows[0].name} · ${when}`);
        lines.push(`"${(messageRes.rows[0].text as string).slice(0, 140)}"`);
      }
      count += 1;
      markedMentionIds.push(mention.id);
    }
    if (count === 0) {
      await services.outbox.markDigestSent(person.id, periodKey);
      continue;
    }
    const subject = `Rimewire: ${count} unanswered ${count === 1 ? 'mention' : 'mentions'} for ${businessDate}`;
    const body = [...lines, '', `Open Rimewire: ${services.config.publicUrl}/`].join('\n');
    const ok = await services.outbox.enqueueAndTry(
      'digest',
      `${person.id}:${periodKey}`,
      { email: person.email, name: person.name, subject, body },
      (when) => ({ to: person.email, toName: person.name, subject, body, date: when }),
    );
    if (ok) {
      await services.outbox.markDigestSent(person.id, periodKey);
      for (const mentionId of markedMentionIds) {
        await services.db.pool.query('UPDATE mentions SET digested_at = $2 WHERE id = $1', [mentionId, now]);
      }
    }
  }
}
