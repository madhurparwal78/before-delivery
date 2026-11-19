import { randomUUID } from 'node:crypto';
import { oneRow, withTransaction } from './pool.js';
import { addDays, instantAtLocal, localDateKey } from '../domain/time.js';
import type { SignCategory } from '../domain/signs.js';

interface SeedCoach {
  readonly name: string;
  readonly email: string;
  readonly timeZone: string;
  readonly accessCode: string;
}

interface SeedCohort {
  readonly name: string;
  readonly coachEmail: string;
  readonly offsetDays: number;
  readonly published: boolean;
  readonly priceCents: number;
  readonly seats: number;
}

interface SeedDreamer {
  readonly name: string;
  readonly email: string;
  readonly cohortName: string;
  readonly homeTz: string;
  readonly bedtime: string;
  readonly accessCode: string;
}

interface SeedEntry {
  readonly night: number;
  readonly title: string;
  readonly text: string;
  readonly dreamsRecalled: number;
  readonly wbtb: boolean;
  readonly technique: 'none' | 'mild' | 'ssild';
  readonly techniqueMinutes: number;
  readonly shared: boolean;
  readonly signs: readonly { phrase: string; category: SignCategory }[];
}

const COACHES: readonly SeedCoach[] = [
  {
    name: 'Wren Aldana',
    email: 'wren@saltmoon.example',
    timeZone: 'America/Denver',
    accessCode: 'coach-wren-4417',
  },
  {
    name: 'Tobias Merrow',
    email: 'tobias@saltmoon.example',
    timeZone: 'Europe/Lisbon',
    accessCode: 'coach-tobias-2290',
  },
];

const COHORTS: readonly SeedCohort[] = [
  {
    name: 'Autumn Lantern',
    coachEmail: 'wren@saltmoon.example',
    offsetDays: -10,
    published: true,
    priceCents: 24_000,
    seats: 12,
  },
  {
    name: 'Harvest Moon',
    coachEmail: 'wren@saltmoon.example',
    offsetDays: -3,
    published: true,
    priceCents: 24_000,
    seats: 3,
  },
  {
    name: 'Winter Owl',
    coachEmail: 'wren@saltmoon.example',
    offsetDays: 14,
    published: true,
    priceCents: 18_000,
    seats: 20,
  },
  {
    name: 'Spring Draft',
    coachEmail: 'wren@saltmoon.example',
    offsetDays: 40,
    published: false,
    priceCents: 20_000,
    seats: 10,
  },
  {
    name: 'Tidewatch',
    coachEmail: 'tobias@saltmoon.example',
    offsetDays: -2,
    published: true,
    priceCents: 20_000,
    seats: 8,
  },
];

const DREAMERS: readonly SeedDreamer[] = [
  {
    name: 'Mara Quist',
    email: 'mara@dreamers.example',
    cohortName: 'Autumn Lantern',
    homeTz: 'America/Chicago',
    bedtime: '23:00',
    accessCode: 'dreamer-mara-3051',
  },
  {
    name: 'Jun Ferreira',
    email: 'jun@dreamers.example',
    cohortName: 'Autumn Lantern',
    homeTz: 'Asia/Tokyo',
    bedtime: '22:30',
    accessCode: 'dreamer-jun-7720',
  },
  {
    name: 'Elodie Vance',
    email: 'elodie@dreamers.example',
    cohortName: 'Harvest Moon',
    homeTz: 'Europe/Berlin',
    bedtime: '23:30',
    accessCode: 'dreamer-elodie-1186',
  },
  {
    name: 'Sam Petrakis',
    email: 'sam@dreamers.example',
    cohortName: 'Harvest Moon',
    homeTz: 'America/New_York',
    bedtime: '22:45',
    accessCode: 'dreamer-sam-5502',
  },
  {
    name: 'Ines Calloway',
    email: 'ines@dreamers.example',
    cohortName: 'Tidewatch',
    homeTz: 'Europe/Lisbon',
    bedtime: '23:00',
    accessCode: 'dreamer-ines-6634',
  },
];

const MARA_ENTRIES: readonly SeedEntry[] = [
  {
    night: 2,
    title: 'Folding staircase',
    text: 'I was climbing a staircase that folded into the sea, and my teeth felt loose.',
    dreamsRecalled: 1,
    wbtb: false,
    technique: 'none',
    techniqueMinutes: 0,
    shared: false,
    signs: [
      { phrase: 'folded into the sea', category: 'form' },
      { phrase: 'my teeth felt loose', category: 'form' },
    ],
  },
  {
    night: 3,
    title: "Grandmother's kitchen",
    text: 'My grandmother was cooking in a kitchen on the roof of my old school.',
    dreamsRecalled: 1,
    wbtb: false,
    technique: 'none',
    techniqueMinutes: 0,
    shared: false,
    signs: [{ phrase: 'a kitchen on the roof of my old school', category: 'context' }],
  },
  {
    night: 5,
    title: 'Flying lesson',
    text: 'I flew over the river with my arms out and felt completely calm.',
    dreamsRecalled: 2,
    wbtb: false,
    technique: 'none',
    techniqueMinutes: 0,
    shared: false,
    signs: [
      { phrase: 'I flew over the river', category: 'action' },
      { phrase: 'felt completely calm', category: 'inner_awareness' },
    ],
  },
  {
    night: 9,
    title: 'The blue door',
    text: 'A blue door kept changing size each time I reached for it.',
    dreamsRecalled: 1,
    wbtb: true,
    technique: 'mild',
    techniqueMinutes: 20,
    shared: true,
    signs: [{ phrase: 'kept changing size', category: 'form' }],
  },
  {
    night: 10,
    title: 'No recall',
    text: 'Woke at the alarm, nothing came back.',
    dreamsRecalled: 0,
    wbtb: true,
    technique: 'ssild',
    techniqueMinutes: 15,
    shared: false,
    signs: [],
  },
];

export async function applySeed(): Promise<void> {
  const existing = await oneRow<{ count: string }>('select count(*)::text as count from coaches');
  if (existing !== null && existing.count !== '0') return;

  await withTransaction(async (client) => {
    const now = new Date();
    const coachIds = new Map<string, string>();
    for (const coach of COACHES) {
      const id = randomUUID();
      coachIds.set(coach.email, id);
      await client.query(
        'insert into coaches (id, name, email, time_zone, access_code) values ($1, $2, $3, $4, $5)',
        [id, coach.name, coach.email, coach.timeZone, coach.accessCode],
      );
    }

    const cohortIds = new Map<string, string>();
    const cohortStarts = new Map<string, string>();
    for (const cohort of COHORTS) {
      const coach = COACHES.find((candidate) => candidate.email === cohort.coachEmail);
      if (coach === undefined) throw new Error(`Unknown seed coach ${cohort.coachEmail}`);
      const coachId = coachIds.get(cohort.coachEmail);
      if (coachId === undefined) throw new Error(`Unknown seed coach ${cohort.coachEmail}`);
      const startsOn = addDays(localDateKey(now, coach.timeZone), cohort.offsetDays);
      const id = randomUUID();
      cohortIds.set(cohort.name, id);
      cohortStarts.set(cohort.name, startsOn);
      await client.query(
        `insert into cohorts (id, coach_id, name, starts_on, published_at, price_cents, seats)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          coachId,
          cohort.name,
          startsOn,
          cohort.published ? now : null,
          cohort.priceCents,
          cohort.seats,
        ],
      );
    }

    const enrollmentIds = new Map<string, string>();
    for (const dreamer of DREAMERS) {
      const cohortId = cohortIds.get(dreamer.cohortName);
      const startsOn = cohortStarts.get(dreamer.cohortName);
      if (cohortId === undefined || startsOn === undefined) {
        throw new Error(`Unknown seed cohort ${dreamer.cohortName}`);
      }
      const id = randomUUID();
      enrollmentIds.set(dreamer.email, id);
      await client.query(
        `insert into enrollments
           (id, cohort_id, name, email, status, home_tz, bedtime, first_night, access_code, comped, receipt_status)
         values ($1, $2, $3, $4, 'active', $5, $6, $7, $8, true, 'none')`,
        [
          id,
          cohortId,
          dreamer.name,
          dreamer.email,
          dreamer.homeTz,
          dreamer.bedtime,
          startsOn,
          dreamer.accessCode,
        ],
      );
    }

    const mara = DREAMERS.find((dreamer) => dreamer.email === 'mara@dreamers.example');
    if (mara === undefined) throw new Error('Missing seed dreamer');
    const maraId = enrollmentIds.get(mara.email);
    const maraStart = cohortStarts.get(mara.cohortName);
    if (maraId === undefined || maraStart === undefined) throw new Error('Missing seed dreamer');
    for (const entry of MARA_ENTRIES) {
      const nightKey = addDays(maraStart, entry.night - 1);
      const createdAt = instantAtLocal(addDays(nightKey, 1), 7 * 60 + 12, mara.homeTz);
      const entryId = randomUUID();
      await client.query(
        `insert into entries
           (id, enrollment_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique,
            technique_minutes, late_recall, shared, created_at)
         values ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, false, $10, $11)`,
        [
          entryId,
          maraId,
          nightKey,
          entry.title,
          entry.text,
          entry.dreamsRecalled,
          entry.wbtb,
          entry.technique,
          entry.techniqueMinutes,
          entry.shared,
          createdAt,
        ],
      );
      for (const sign of entry.signs) {
        const start = entry.text.indexOf(sign.phrase);
        if (start < 0) throw new Error(`Seed phrase not found: ${sign.phrase}`);
        await client.query(
          `insert into signs
             (id, entry_id, enrollment_id, start_offset, end_offset, phrase, category, night_key)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            entryId,
            maraId,
            start,
            start + sign.phrase.length,
            sign.phrase,
            sign.category,
            nightKey,
          ],
        );
      }
    }
  });
}
