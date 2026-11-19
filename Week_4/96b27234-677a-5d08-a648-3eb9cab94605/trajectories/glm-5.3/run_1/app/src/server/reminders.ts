// Exactly-once reminders: each attending person gets one reminder per
// occurrence at the lead time, in that person's zone, across all instances.
import { config } from './config';
import { query } from './db';
import { formatDisplay, resolveLocal, nextWeeklyOccurrence } from './zones';
import { occurrenceStatus } from './occurrences';
import { queueMail } from './mail';

interface Gathering {
  id: string;
  community_id: string;
  title: string;
  starts_local: string;
  duration_minutes: number;
  recurrence: string;
}

export async function runDueReminders(worldId: string, now: Date): Promise<void> {
  const rows = await query<Gathering & { time_zone: string }>(
    `SELECT g.id, g.community_id, g.title, g.starts_local, g.duration_minutes, g.recurrence, c.time_zone
     FROM gatherings g JOIN communities c ON c.id = g.community_id WHERE c.world_id = $1`,
    [worldId]
  );
  const leadMs = config.reminderLeadMinutes * 60000;
  for (const g of rows) {
    const attendees = await query<{ person_id: string; time_zone: string; email: string; display_name: string }>(
      `SELECT a.person_id, p.time_zone, p.email, p.display_name FROM gathering_attendees a
       JOIN people p ON p.id = a.person_id WHERE a.gathering_id = $1`,
      [g.id]
    );
    if (!attendees.length) continue;
    // Walk occurrences; a due one is within the lead window and not yet
    // started. An occurrence already started when first seen as due sends
    // nothing.
    let current = resolveLocal(g.time_zone, g.starts_local);
    for (let i = 0; i < 500; i++) {
      const startMs = current.utc.getTime();
      const dueAt = startMs - leadMs;
      if (dueAt <= now.getTime()) {
        if (now.getTime() < startMs) {
          await sendReminders(g, attendees, current.utc);
        }
        if (g.recurrence === 'none') break;
        current = nextWeeklyOccurrence(g.time_zone, current);
        continue;
      }
      break;
    }
  }
}

async function sendReminders(g: Gathering, attendees: { person_id: string; time_zone: string; email: string; display_name: string }[], startsAt: Date): Promise<void> {
  for (const a of attendees) {
    const already = await query('SELECT 1 FROM reminders_sent WHERE gathering_id = $1 AND person_id = $2 AND occurrence_start = $3', [g.id, a.person_id, startsAt]);
    if (already.length) continue;
    await query('INSERT INTO reminders_sent (gathering_id, person_id, occurrence_start) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [g.id, a.person_id, startsAt]);
    const display = formatDisplay(a.time_zone, startsAt);
    await queueMail(a.person_id, a.email, `Starting soon: ${g.title}`, `${g.title} starts ${display}.`);
  }
}

export { occurrenceStatus };
