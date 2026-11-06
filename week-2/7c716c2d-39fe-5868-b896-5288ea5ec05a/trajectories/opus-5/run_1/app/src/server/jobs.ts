import { now, nowDate } from './clock.js';
import { config } from './config.js';
import { db, tx } from './db.js';
import { toActor, type PersonRow } from './access.js';
import { loadHistory, workspaceToday } from './calendarstore.js';
import { emitTyping } from './chatview.js';
import { unreadFor } from './chatview.js';
import { countedDay } from './domain/calendar.js';
import { cycleNumberAt } from './domain/cycles.js';
import { localWallTime } from './domain/zone.js';
import { appendEvent } from './events.js';
import { finishedRecord } from './cycleview.js';
import { issueBodies, listIssueRows } from './issueview.js';
import { emitKnock, emitRoom, expireKnocksOfEmptyRoom } from './office.js';
import { deliverHeldMail, longDate, queueMail } from './services/mail.js';
import { noticeOwner } from './services/status.js';
import { deleteObject } from './services/storage.js';
import { confirmedSeats } from './seats.js';
import { DIGEST_HOUR } from './workspaces.js';
import { isClosedStatus } from './domain/status.js';

const EVENT_HISTORY = 1000;

async function lapseTyping(): Promise<void> {
  const cutoff = new Date(now() - 5000).toISOString();
  await tx(async (client) => {
    const lapsed = await client.query<{ channel_id: string; workspace_id: string }>(
      `delete from typing t where t.last_at <= $1
       returning t.channel_id, (select workspace_id from channels c where c.id = t.channel_id) as workspace_id`,
      [cutoff],
    );
    const channels = new Map(lapsed.map((row) => [row.channel_id, row.workspace_id]));
    const at = nowDate().toISOString();
    for (const [channelId, workspaceId] of channels) {
      await emitTyping(client, workspaceId, channelId, at);
    }
  });
}

async function turnAway(): Promise<void> {
  const cutoff = new Date(now() - config.presenceAwaySeconds * 1000).toISOString();
  await tx(async (client) => {
    const gone = await client.query<{ id: string; workspace_id: string }>(
      `update people set away = true
        where removed = false and workspace_id is not null and away = false
          and (last_seen_at is null or last_seen_at <= $1)
        returning id, workspace_id`,
      [cutoff],
    );
    const at = nowDate().toISOString();
    for (const person of gone) {
      await appendEvent(
        client,
        person.workspace_id,
        'presence',
        { person_id: person.id, status: 'away' },
        { type: 'workspace' },
        at,
      );
    }
  });
}

async function expireKnocks(): Promise<void> {
  await tx(async (client) => {
    const expired = await client.query<{ id: string; workspace_id: string }>(
      `update knocks set status = 'expired' where status = 'waiting' and expires_at <= $1
        returning id, workspace_id`,
      [nowDate().toISOString()],
    );
    const at = nowDate().toISOString();
    for (const knock of expired) await emitKnock(client, knock.workspace_id, knock.id, at);
  });
}

/** A person leaves their room once their last event stream has been closed for the grace period. */
async function applyStreamGrace(): Promise<void> {
  const staleStream = new Date(now() - 20000).toISOString();
  const graceEdge = new Date(now() - config.streamGraceSeconds * 1000).toISOString();
  await tx(async (client) => {
    const leaving = await client.query<{ person_id: string; room_id: string; workspace_id: string }>(
      `select o.person_id, o.room_id, o.workspace_id from room_occupants o
        where exists (select 1 from streams s where s.person_id = o.person_id)
          and not exists (
            select 1 from streams s where s.person_id = o.person_id
              and s.closed_at is null and s.last_seen_at > $1)
          and (select max(coalesce(s.closed_at, s.last_seen_at)) from streams s
                where s.person_id = o.person_id) <= $2`,
      [staleStream, graceEdge],
    );
    const at = nowDate().toISOString();
    for (const occupant of leaving) {
      await client.query('delete from room_occupants where person_id = $1', [occupant.person_id]);
      await emitRoom(client, occupant.workspace_id, occupant.room_id, at);
      await expireKnocksOfEmptyRoom(client, occupant.workspace_id, occupant.room_id, at);
    }
  });
  await db.query('delete from streams where closed_at is not null and closed_at <= $1', [
    new Date(now() - 3600000).toISOString(),
  ]);
}

/** One digest per recipient per counted day, at or after 08:00 workspace time. */
async function queueDigests(): Promise<void> {
  const workspaces = await db.query<{ id: string; name: string }>('select id, name from workspaces');
  for (const workspace of workspaces) {
    const history = await loadHistory(workspace.id);
    const today = workspaceToday(history);
    if (!countedDay(history, today).counted) continue;
    const zone = history.versions[history.versions.length - 1]?.timeZone ?? 'UTC';
    if (now() < localWallTime(zone, today, DIGEST_HOUR)) continue;
    const recipients = await db.query<PersonRow>(
      `select id, name, email, handle, role, workspace_id, removed, away from people
        where workspace_id = $1 and removed = false and role in ('owner','member')
          and not exists (select 1 from digests d
                           where d.workspace_id = $1 and d.person_id = people.id and d.digest_date = $2)`,
      [workspace.id, today],
    );
    if (recipients.length === 0) continue;
    const cycleNumber = cycleNumberAt(history, now());
    for (const recipient of recipients) {
      const actor = toActor(recipient);
      const rows = await listIssueRows(actor, history, { cycle: cycleNumber }, async () => null);
      const issues = await issueBodies(
        rows.filter((row) => !isClosedStatus(row.status)),
        history,
      );
      const unread = await unreadFor(recipient.id, workspace.id);
      const lines = issues.map((issue) => `${issue.key}  ${issue.title}`);
      const body =
        `Your Tallyroom digest for ${longDate(today)}.\n\n` +
        `Open issues in cycle ${cycleNumber}:\n` +
        `${lines.length === 0 ? 'Nothing open.' : lines.join('\n')}\n\n` +
        `Unread in your inbox: ${unread.inbox}\n\n${config.appPublicUrl}\n`;
      await tx(async (client) => {
        const claimed = await client.one<{ person_id: string }>(
          `insert into digests (workspace_id, person_id, digest_date) values ($1, $2, $3)
           on conflict do nothing returning person_id`,
          [workspace.id, recipient.id, today],
        );
        if (claimed === undefined) return;
        await queueMail(client, {
          workspaceId: workspace.id,
          to: recipient.email,
          subject: `Your Tallyroom digest for ${longDate(today)}`,
          body,
          kind: 'digest',
          personId: recipient.id,
          digestDate: today,
        });
        await noticeOwner(client, workspace.id, nowDate().toISOString());
      });
    }
  }
}

async function recordFinishedCycles(): Promise<void> {
  const workspaces = await db.query<{ id: string }>('select id from workspaces');
  for (const workspace of workspaces) {
    const history = await loadHistory(workspace.id);
    const current = cycleNumberAt(history, now());
    for (let number = Math.max(1, current - 3); number < current; number += 1) {
      await finishedRecord(workspace.id, number, history);
    }
  }
}

async function applyScheduledReductions(): Promise<void> {
  const workspaces = await db.query<{ id: string }>(
    'select id from workspaces where scheduled_limit is not null',
  );
  for (const workspace of workspaces) {
    await confirmedSeats(workspace.id).catch(() => undefined);
  }
}

/** Object deletions are queued durably, so they survive storage being down. */
async function drainAttachmentDeletions(): Promise<void> {
  const rows = await db.query<{ id: number; object_key: string }>(
    `select id, object_key from attachment_deletions where done_at is null order by id limit 20`,
  );
  for (const row of rows) {
    try {
      await deleteObject(row.object_key);
      await db.query('update attachment_deletions set done_at = $2 where id = $1', [
        row.id,
        nowDate().toISOString(),
      ]);
    } catch {
      return;
    }
  }
}

async function pruneEvents(): Promise<void> {
  await db.query(
    `delete from events e using (
       select workspace_id, max(id) as newest from events group by workspace_id
     ) latest
      where e.workspace_id = latest.workspace_id and e.id <= latest.newest - $1`,
    [EVENT_HISTORY],
  );
  await db.query('delete from idempotency where created_at < $1', [
    new Date(now() - config.idempotencyTtlSeconds * 1000).toISOString(),
  ]);
  await db.query('delete from attachment_deletions where done_at is not null and done_at < $1', [
    new Date(now() - 3600000).toISOString(),
  ]);
}

type Task = { name: string; run: () => Promise<void>; everyMs: number; lastRun: number };

const tasks: Task[] = [
  { name: 'typing', run: lapseTyping, everyMs: 1000, lastRun: 0 },
  { name: 'away', run: turnAway, everyMs: 1000, lastRun: 0 },
  { name: 'knocks', run: expireKnocks, everyMs: 500, lastRun: 0 },
  { name: 'grace', run: applyStreamGrace, everyMs: 1000, lastRun: 0 },
  { name: 'mail', run: deliverHeldMail, everyMs: Math.min(config.outboxRetrySeconds * 1000, 1000), lastRun: 0 },
  { name: 'digests', run: queueDigests, everyMs: 5000, lastRun: 0 },
  { name: 'cycles', run: recordFinishedCycles, everyMs: 5000, lastRun: 0 },
  { name: 'seats', run: applyScheduledReductions, everyMs: 10000, lastRun: 0 },
  { name: 'attachments', run: drainAttachmentDeletions, everyMs: Math.min(config.outboxRetrySeconds * 1000, 5000), lastRun: 0 },
  { name: 'prune', run: pruneEvents, everyMs: 60000, lastRun: 0 },
];

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const task of tasks) {
      if (Date.now() - task.lastRun < task.everyMs) continue;
      task.lastRun = Date.now();
      try {
        await task.run();
      } catch {
        // A dependency is down; the next tick tries again.
      }
    }
  } finally {
    running = false;
  }
}

export function startJobs(): void {
  setInterval(() => {
    void tick();
  }, 250).unref();
}
