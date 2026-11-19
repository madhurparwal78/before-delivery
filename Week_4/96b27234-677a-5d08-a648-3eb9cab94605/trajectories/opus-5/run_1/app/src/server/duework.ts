import { config } from './config.js';
import { allWorldIds, worldNow } from './clock.js';
import { query } from './db.js';
import { occurrencesOf } from './domain/gatherings.js';
import type { Recurrence } from './domain/gatherings.js';
import { formatDisplay } from './domain/zones.js';
import { enqueueMail, linkBase } from './services/mail.js';
import { getOpenSession, leaveSession } from './sessions.js';
import { closeDueVotes } from './voting.js';

interface DueMemberRow {
  session_id: string;
  person_id: string;
  display_name: string;
}

interface GatheringRow {
  id: string;
  title: string;
  starts_local: string;
  duration_minutes: number;
  recurrence: Recurrence;
  zone: string;
}

async function completeDueDepartures(worldId: string, now: Date): Promise<void> {
  const rows = await query<DueMemberRow>(
    `select m.session_id, m.person_id, p.display_name
       from session_members m
       join sessions s on s.id = m.session_id
       join people p on p.id = m.person_id
      where s.world_id = $1 and s.status = 'open' and m.active = true and m.drop_deadline is not null
        and m.drop_deadline <= $2`,
    [worldId, now]
  );
  for (const row of rows) {
    const session = await getOpenSession(row.session_id);
    if (session === null) continue;
    await leaveSession(session, row.person_id, row.display_name);
  }
}

async function sendDueReminders(worldId: string, now: Date): Promise<void> {
  const gatherings = await query<GatheringRow>(
    `select g.id, g.title, g.starts_local, g.duration_minutes, g.recurrence, c.time_zone as zone
       from gatherings g join communities c on c.id = g.community_id
      where c.world_id = $1`,
    [worldId]
  );
  const leadMs = config.reminderLeadMinutes * 60000;
  for (const gathering of gatherings) {
    const occurrences = occurrencesOf(
      {
        startsLocal: gathering.starts_local,
        durationMinutes: gathering.duration_minutes,
        recurrence: gathering.recurrence,
        zone: gathering.zone
      },
      now,
      2
    );
    for (const occurrence of occurrences) {
      if (now.getTime() < occurrence.startsAt.getTime() - leadMs) continue;
      const attendees = await query<{ person_id: string; display_name: string; email: string; time_zone: string }>(
        `select a.person_id, p.display_name, p.email, p.time_zone
           from gathering_attendees a join people p on p.id = a.person_id
          where a.gathering_id = $1`,
        [gathering.id]
      );
      for (const attendee of attendees) {
        const claimed = await query<{ person_id: string }>(
          `insert into reminders_sent (gathering_id, person_id, occurrence_starts_at)
           values ($1, $2, $3) on conflict do nothing returning person_id`,
          [gathering.id, attendee.person_id, occurrence.startsAt]
        );
        if (claimed.length === 0) continue;
        if (now.getTime() >= occurrence.startsAt.getTime()) continue;
        const display = formatDisplay(attendee.time_zone, occurrence.startsAt);
        await enqueueMail(
          attendee.email,
          `Starting soon: ${gathering.title}`,
          `${gathering.title} starts ${display}.\n${linkBase(null)}/gatherings/${gathering.id}\n`
        );
      }
    }
  }
}

export async function runDueWork(worldId: string): Promise<void> {
  const now = await worldNow(worldId);
  await closeDueVotes(worldId, now);
  await completeDueDepartures(worldId, now);
  await sendDueReminders(worldId, now);
}

export function startDueLoop(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        for (const worldId of await allWorldIds()) await runDueWork(worldId);
      } catch (error) {
        process.stderr.write(`due work failed: ${String(error)}\n`);
      } finally {
        running = false;
      }
    })();
  }, 1000).unref();
}
