import { HOUR_MS, HALF_HOUR_MS, formatInstant, parseInstant, shipDateRange } from '../domain/time.js';
import { shipDateOf, shipDayBounds, type VesselClock } from '../domain/ship-time.js';
import { hashPasscode } from '../services/passcodes.js';
import { query } from './pool.js';
import * as store from './store.js';
import { loadCrewContext, computeWindowFor, recordBreachesFrom } from '../services/crew-records.js';

type SeedInterval = { fromHour: number; toHour: number; kind: 'rest' | 'work' };

const SEED_FROM = parseInstant('2026-09-07T00:00:00Z') as number;
const SEED_TO = parseInstant('2026-09-21T00:00:00Z') as number;

const OWNERS = [
  { id: 'owner-ailsa', name: 'Ailsa Tregenna', email: 'ailsa@tidewrack.example', passcode: 'fathom-ailsa-2741' },
  { id: 'owner-bram', name: 'Bram Okafor', email: 'bram@skerry.example', passcode: 'fathom-bram-8830' },
];

const VESSELS = [
  {
    id: 'vessel-surveyor',
    ownerId: 'owner-ailsa',
    name: 'Tidewrack Surveyor',
    kind: 'survey_boat' as const,
    offset: 0,
  },
  {
    id: 'vessel-kittiwake',
    ownerId: 'owner-ailsa',
    name: 'Kittiwake',
    kind: 'workboat' as const,
    offset: 60,
  },
  {
    id: 'vessel-skerry-lass',
    ownerId: 'owner-bram',
    name: 'Skerry Lass',
    kind: 'coaster' as const,
    offset: 0,
  },
];

const CREW = [
  {
    id: 'crew-ines',
    vesselId: 'vessel-surveyor',
    name: 'Ines Duarte',
    rank: 'Mate',
    email: 'ines@tidewrack.example',
    passcode: 'watch-ines-1192',
  },
  {
    id: 'crew-tomas',
    vesselId: 'vessel-surveyor',
    name: 'Tomas Berg',
    rank: 'Engineer',
    email: 'tomas@tidewrack.example',
    passcode: 'watch-tomas-3365',
  },
  {
    id: 'crew-petra',
    vesselId: 'vessel-surveyor',
    name: 'Petra Vance',
    rank: 'Deckhand',
    email: 'petra@tidewrack.example',
    passcode: 'watch-petra-5507',
  },
  {
    id: 'crew-jonah',
    vesselId: 'vessel-kittiwake',
    name: 'Jonah Reyes',
    rank: 'Deckhand',
    email: 'jonah@tidewrack.example',
    passcode: 'watch-jonah-7741',
  },
  {
    id: 'crew-noor',
    vesselId: 'vessel-skerry-lass',
    name: 'Noor Haddad',
    rank: 'Mate',
    email: 'noor@skerry.example',
    passcode: 'watch-noor-9014',
  },
];

const FIXES = [
  { id: 'fix-surveyor-1', at: '2026-09-07T00:00:00Z', latitude: 50.1, longitude: -5 },
  { id: 'fix-surveyor-2', at: '2026-09-10T02:00:00Z', latitude: 49, longitude: -12 },
  { id: 'fix-surveyor-3', at: '2026-09-13T12:00:00Z', latitude: 47, longitude: -16 },
  { id: 'fix-surveyor-4', at: '2026-09-16T03:00:00Z', latitude: 48, longitude: -8 },
  { id: 'fix-surveyor-5', at: '2026-09-21T00:00:00Z', latitude: 50.1, longitude: -5 },
];

const CLOCK_CHANGES = [
  {
    id: 'clock-surveyor-retard',
    at: '2026-09-10T02:00:00Z',
    oldOffset: 0,
    newOffset: -60,
    fixId: 'fix-surveyor-2',
    latitude: 49,
    longitude: -12,
  },
  {
    id: 'clock-surveyor-advance',
    at: '2026-09-16T03:00:00Z',
    oldOffset: -60,
    newOffset: 0,
    fixId: 'fix-surveyor-4',
    latitude: 48,
    longitude: -8,
  },
];

const PATTERNS: Record<string, { daily: SeedInterval[]; exceptions: Record<string, SeedInterval[]> }> = {
  'crew-ines': {
    daily: [
      { fromHour: 0, toHour: 4, kind: 'work' },
      { fromHour: 4, toHour: 12, kind: 'rest' },
      { fromHour: 12, toHour: 16, kind: 'work' },
      { fromHour: 16, toHour: 24, kind: 'rest' },
    ],
    exceptions: {
      '2026-09-12': [
        { fromHour: 0, toHour: 20, kind: 'work' },
        { fromHour: 20, toHour: 24, kind: 'rest' },
      ],
    },
  },
  'crew-tomas': {
    daily: [
      { fromHour: 0, toHour: 6.5, kind: 'work' },
      { fromHour: 6.5, toHour: 12, kind: 'rest' },
      { fromHour: 12, toHour: 18.5, kind: 'work' },
      { fromHour: 18.5, toHour: 24, kind: 'rest' },
    ],
    exceptions: {},
  },
  'crew-petra': {
    daily: [
      { fromHour: 0, toHour: 14, kind: 'work' },
      { fromHour: 14, toHour: 24, kind: 'rest' },
    ],
    exceptions: {},
  },
};

const SIGNED_DATES: Record<string, { signed: string[]; countersigned: string[] }> = {
  'crew-tomas': {
    signed: shipDateRange('2026-09-07', '2026-09-20'),
    countersigned: shipDateRange('2026-09-07', '2026-09-20'),
  },
  'crew-ines': {
    signed: shipDateRange('2026-09-07', '2026-09-19'),
    countersigned: shipDateRange('2026-09-07', '2026-09-19'),
  },
  'crew-petra': { signed: [], countersigned: [] },
};

async function seedPeople(): Promise<void> {
  for (const owner of OWNERS) {
    await store.insertOwner(owner.id, owner.name, owner.email, hashPasscode(owner.passcode));
  }
  for (const vessel of VESSELS) {
    await store.insertVessel(vessel.id, vessel.ownerId, vessel.name, vessel.kind, vessel.offset);
  }
  for (const crew of CREW) {
    await store.insertCrew(
      crew.id,
      crew.vesselId,
      crew.name,
      crew.rank,
      crew.email,
      hashPasscode(crew.passcode),
    );
  }
}

async function seedVoyage(): Promise<void> {
  for (const fix of FIXES) {
    await store.insertFix(
      fix.id,
      'vessel-surveyor',
      parseInstant(fix.at) as number,
      fix.latitude,
      fix.longitude,
    );
  }
  for (const change of CLOCK_CHANGES) {
    await store.insertClockChange(
      change.id,
      'vessel-surveyor',
      parseInstant(change.at) as number,
      change.oldOffset,
      change.newOffset,
      change.latitude,
      change.longitude,
      change.fixId,
    );
  }
  await store.insertRuleSet(
    'ruleset-surveyor-flag',
    'vessel-surveyor',
    parseInstant('2026-09-16T00:00:00Z') as number,
    parseInstant('2026-09-22T00:00:00Z') as number,
    'Flag dispensation 2026-117',
  );
  await store.insertRotaWatch({
    id: 'watch-ines-morning',
    vesselId: 'vessel-surveyor',
    crewId: 'crew-ines',
    label: 'Morning watch',
    startTime: '00:00',
    endTime: '04:00',
    fromDate: '2026-09-07',
    toDate: '2026-09-20',
  });
  await store.insertEvent({
    id: 'event-ines-call-out',
    vesselId: 'vessel-surveyor',
    crewId: 'crew-ines',
    kind: 'call_out',
    startMs: parseInstant('2026-09-08T05:00:00Z') as number,
    endMs: parseInstant('2026-09-08T06:00:00Z') as number,
    description: 'Anchor watch call-out',
  });
  const noteRows = await query<{ id: string }>(`select id from day_note where id = $1`, [
    'note-ailsa-ines-0911',
  ]);
  if (noteRows.length === 0) {
    await store.insertNote({
      id: 'note-ailsa-ines-0911',
      crewId: 'crew-ines',
      shipDate: '2026-09-11',
      text: 'Deck log shows the survey line finished at 18:00.',
      eventId: null,
      authorRole: 'owner_master',
      authorId: 'owner-ailsa',
      createdAtMs: parseInstant('2026-09-13T09:00:00Z') as number,
    });
  }
}

function patternIntervals(crewId: string, utcDate: string): SeedInterval[] {
  const pattern = PATTERNS[crewId];
  if (pattern === undefined) return [];
  return pattern.exceptions[utcDate] ?? pattern.daily;
}

async function seedEntries(clock: VesselClock): Promise<string[]> {
  const seeded: string[] = [];
  for (const crewId of Object.keys(PATTERNS)) {
    const existing = await store.listEntriesInRange(crewId, SEED_FROM, SEED_TO);
    if (existing.length > 0) continue;
    let index = 0;
    for (let dayMs = SEED_FROM; dayMs < SEED_TO; dayMs += 24 * HOUR_MS) {
      const utcDate = formatInstant(dayMs).slice(0, 10);
      for (const interval of patternIntervals(crewId, utcDate)) {
        const intervalStart = dayMs + interval.fromHour * HOUR_MS;
        const intervalEnd = dayMs + interval.toHour * HOUR_MS;
        let cursor = intervalStart;
        while (cursor < intervalEnd) {
          const shipDate = shipDateOf(clock, cursor);
          const bounds = shipDayBounds(clock, shipDate);
          const segmentEnd = Math.min(intervalEnd, bounds.endMs);
          index += 1;
          await store.insertEntry({
            crewId,
            entryKey: `seed-${crewId}-${index}`,
            startMs: cursor,
            endMs: segmentEnd,
            kind: interval.kind,
            shipDate,
            late: false,
            applied: true,
            receivedAtMs: segmentEnd,
          });
          cursor = segmentEnd;
        }
      }
    }
    seeded.push(crewId);
  }
  return seeded;
}

async function seedSignatures(clock: VesselClock): Promise<void> {
  for (const [crewId, dates] of Object.entries(SIGNED_DATES)) {
    for (const shipDate of dates.signed) {
      const bounds = shipDayBounds(clock, shipDate);
      await store.signDay(crewId, shipDate, bounds.endMs + 3 * HOUR_MS);
    }
    for (const shipDate of dates.countersigned) {
      const bounds = shipDayBounds(clock, shipDate);
      await store.countersignDay(crewId, shipDate, bounds.endMs + 5 * HOUR_MS);
    }
  }
}

async function seedBreaches(crewIds: readonly string[]): Promise<void> {
  for (const crewId of crewIds) {
    const crew = await store.findCrewById(crewId);
    if (crew === null) continue;
    const context = await loadCrewContext(crew, SEED_FROM, SEED_TO);
    const windows = [];
    for (const hours of [24, 168] as const) {
      for (let startMs = SEED_FROM; startMs + hours * HOUR_MS <= SEED_TO; startMs += HALF_HOUR_MS) {
        windows.push(computeWindowFor(context, startMs, hours));
      }
    }
    await recordBreachesFrom(crewId, windows, SEED_TO);
  }
}

/** Applies the seed data, leaving any row that is already there untouched. */
export async function applySeed(): Promise<void> {
  await seedPeople();
  await seedVoyage();
  const vessel = (await store.findVesselById('vessel-surveyor')) as store.Vessel;
  const clock = await store.loadVesselClock(vessel);
  const seeded = await seedEntries(clock);
  await seedSignatures(clock);
  await seedBreaches(seeded);
}
