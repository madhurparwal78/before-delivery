import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { addDays, clockFor } from '../shared/timezones.js';

// The seed runs once into an empty database. D(coach) is the server's date
// in that coach's time zone.

export interface SeedConfig {
  wrenCode: string;
  tobiasCode: string;
}

export async function seedIfEmpty(db: Db, config: SeedConfig): Promise<void> {
  const existing = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM coaches');
  if (Number(existing[0]?.n ?? 0) > 0) return;

  const now = new Date();
  const wrenToday = clockFor('America/Denver').ymd(now);
  const tobiasToday = clockFor('Europe/Lisbon').ymd(now);

  const wrenId = randomUUID();
  const tobiasId = randomUUID();
  await db.exec(
    'INSERT INTO coaches (id, name, email, time_zone, access_code) VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10)',
    [wrenId, 'Wren Aldana', 'wren@saltmoon.example', 'America/Denver', config.wrenCode, tobiasId, 'Tobias Merrow', 'tobias@saltmoon.example', 'Europe/Lisbon', config.tobiasCode],
  );

  const autumn = randomUUID();
  const harvest = randomUUID();
  const winter = randomUUID();
  const spring = randomUUID();
  const tide = randomUUID();
  await db.exec(
    `INSERT INTO cohorts (id, coach_id, name, starts_on, price_cents, seats, published) VALUES
     ($1,$2,$3,$4,$5,$6,TRUE), ($7,$8,$9,$10,$11,$12,TRUE), ($13,$14,$15,$16,$17,$18,TRUE), ($19,$20,$21,$22,$23,$24,FALSE), ($25,$26,$27,$28,$29,$30,TRUE)`,
    [
      autumn, wrenId, 'Autumn Lantern', addDays(wrenToday, -10), 24000, 12,
      harvest, wrenId, 'Harvest Moon', addDays(wrenToday, -3), 24000, 3,
      winter, wrenId, 'Winter Owl', addDays(wrenToday, 14), 18000, 20,
      spring, wrenId, 'Spring Draft', addDays(wrenToday, 40), 20000, 10,
      tide, tobiasId, 'Tidewatch', addDays(tobiasToday, -2), 20000, 8,
    ],
  );

  const mara = randomUUID();
  const jun = randomUUID();
  const elodie = randomUUID();
  const sam = randomUUID();
  const ines = randomUUID();
  await db.exec(
    `INSERT INTO enrollments (id, cohort_id, name, email, status, price_cents, home_tz, bedtime, first_night, receipt_status, access_code, paid_via_killbill) VALUES
     ($1,$2,$3,$4,'active',$5,$6,$7,$8,'none',$9,FALSE),
     ($10,$11,$12,$13,'active',$14,$15,$16,$17,'none',$18,FALSE),
     ($19,$20,$21,$22,'active',$23,$24,$25,$26,'none',$27,FALSE),
     ($28,$29,$30,$31,'active',$32,$33,$34,$35,'none',$36,FALSE),
     ($37,$38,$39,$40,'active',$41,$42,$43,$44,'none',$45,FALSE)`,
    [
      mara, autumn, 'Mara Quist', 'mara@dreamers.example', 24000, 'America/Chicago', '23:00', addDays(wrenToday, -10), 'dreamer-mara-3051',
      jun, autumn, 'Jun Ferreira', 'jun@dreamers.example', 24000, 'Asia/Tokyo', '22:30', addDays(wrenToday, -10), 'dreamer-jun-7720',
      elodie, harvest, 'Elodie Vance', 'elodie@dreamers.example', 24000, 'Europe/Berlin', '23:30', addDays(wrenToday, -3), 'dreamer-elodie-1186',
      sam, harvest, 'Sam Petrakis', 'sam@dreamers.example', 24000, 'America/New_York', '22:45', addDays(wrenToday, -3), 'dreamer-sam-5502',
      ines, tide, 'Ines Calloway', 'ines@dreamers.example', 20000, 'Europe/Lisbon', '23:00', addDays(tobiasToday, -2), 'dreamer-ines-6634',
    ],
  );

  const firstNight = addDays(wrenToday, -10);
  const maraEntries: Array<{ id: string; night: number; title: string; text: string; recalled: number; wbtb: boolean; technique: string; minutes: number; shared: boolean; createdAt: Date }> = [
    { id: randomUUID(), night: 2, title: 'Folding staircase', text: 'I was climbing a staircase that folded into the sea, and my teeth felt loose.', recalled: 1, wbtb: false, technique: 'none', minutes: 0, shared: false, createdAt: at(firstNight, 2, 7, 12) },
    { id: randomUUID(), night: 3, title: "Grandmother's kitchen", text: 'My grandmother was cooking in a kitchen on the roof of my old school.', recalled: 1, wbtb: false, technique: 'none', minutes: 0, shared: false, createdAt: at(firstNight, 3, 7, 40) },
    { id: randomUUID(), night: 5, title: 'Flying lesson', text: 'I flew over the river with my arms out and felt completely calm.', recalled: 2, wbtb: false, technique: 'none', minutes: 0, shared: false, createdAt: at(firstNight, 5, 7, 5) },
    { id: randomUUID(), night: 9, title: 'The blue door', text: 'A blue door kept changing size each time I reached for it.', recalled: 1, wbtb: true, technique: 'mild', minutes: 20, shared: true, createdAt: at(firstNight, 9, 7, 22) },
    { id: randomUUID(), night: 10, title: 'No recall', text: 'Woke at the alarm, nothing came back.', recalled: 0, wbtb: true, technique: 'ssild', minutes: 15, shared: false, createdAt: at(firstNight, 10, 7, 8) },
  ];
  for (const e of maraEntries) {
    const nightKey = addDays(firstNight, e.night - 1);
    await db.exec(
      `INSERT INTO entries (id, enrollment_id, cohort_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique, technique_minutes, late_recall, shared, created_at, body_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8,$9,$10,FALSE,$11,$12,'')`,
      [e.id, mara, autumn, nightKey, e.title, e.text, e.recalled, e.wbtb, e.technique, e.minutes, e.shared, e.createdAt.toISOString()],
    );
  }

  const signs: Array<{ entryId: string; phrase: string; category: string; night: number }> = [
    { entryId: maraEntries[0]!.id, phrase: 'folded into the sea', category: 'form', night: 2 },
    { entryId: maraEntries[0]!.id, phrase: 'my teeth felt loose', category: 'form', night: 2 },
    { entryId: maraEntries[1]!.id, phrase: 'a kitchen on the roof of my old school', category: 'context', night: 3 },
    { entryId: maraEntries[2]!.id, phrase: 'I flew over the river', category: 'action', night: 5 },
    { entryId: maraEntries[2]!.id, phrase: 'felt completely calm', category: 'inner_awareness', night: 5 },
    { entryId: maraEntries[3]!.id, phrase: 'kept changing size', category: 'form', night: 9 },
  ];
  for (const s of signs) {
    const entry = maraEntries.find((e) => e.id === s.entryId) as { text: string };
    const start = entry.text.indexOf(s.phrase);
    const nightKey = addDays(firstNight, s.night - 1);
    await db.exec(
      'INSERT INTO signs (id, entry_id, enrollment_id, start_offset, end_offset, phrase, category, night_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), s.entryId, mara, start, start + s.phrase.length, s.phrase, s.category, nightKey],
    );
  }
}

function at(firstNight: string, night: number, hour: number, minute: number): Date {
  // created_at in UTC such that the entry is logged inside the morning window
  // of its night in America/Chicago (UTC-6).
  const day = addDays(firstNight, night - 1);
  return new Date(Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`) + 6 * 3600_000);
}
