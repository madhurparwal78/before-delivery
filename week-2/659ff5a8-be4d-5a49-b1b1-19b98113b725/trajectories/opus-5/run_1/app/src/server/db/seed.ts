import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { EventStatus, HeatSpec } from '../../shared/api';
import { hashPassword } from '../auth';
import { zonedLocalToUtc } from '../domain/clubTime';
import { parseFactor, parseRawTime } from '../domain/decimal';
import { computeRunTimes } from '../domain/indexedTime';
import { rankChangeFor, rankEntries, type EntryInput } from '../domain/standings';
import { withTransaction } from './pool';

const SEED_PASSWORD = 'conecount-2026';

function stableId(key: string): string {
  const digest = createHash('sha256').update(`conecount:${key}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}

interface SeedUser {
  key: string;
  name: string;
  email: string;
  roles: string[];
}

interface SeedRun {
  runNumber: number;
  rawTime: string | null;
  cones: number | null;
  committedAtLocal: string;
}

interface SeedRegistration {
  driverKey: string;
  classCode: string;
  carNumber: number;
  carDescription: string;
  checkedInLocal: string | null;
  runs: SeedRun[];
  stationName: string | null;
  stationHeat: number | null;
}

interface SeedEvent {
  key: string;
  name: string;
  date: string;
  venue: string;
  cutoffLocal: string;
  runsPerDriver: number;
  heats: HeatSpec[];
  stations: string[];
  status: EventStatus;
  provisionalAtLocal: string | null;
  registrations: SeedRegistration[];
}

interface SeedClub {
  slug: string;
  name: string;
  timeZone: string;
  users: SeedUser[];
  indexTable: { effectiveDate: string; factors: Record<string, string> };
  events: SeedEvent[];
}

const RIDGELINE: SeedClub = {
  slug: 'ridgeline',
  name: 'Ridgeline Region',
  timeZone: 'America/Denver',
  users: [
    { key: 'ridgeline:chair', name: 'Dana Whitcombe', email: 'chair@ridgeline.test', roles: ['chair'] },
    { key: 'ridgeline:timing', name: 'Ike Moreau', email: 'timing@ridgeline.test', roles: ['timing'] },
    {
      key: 'ridgeline:workers',
      name: 'Priya Halvorsen',
      email: 'workers@ridgeline.test',
      roles: ['workers'],
    },
    { key: 'ridgeline:avery', name: 'Avery Lindqvist', email: 'avery@ridgeline.test', roles: [] },
    { key: 'ridgeline:bo', name: 'Bo Tanaka-Reyes', email: 'bo@ridgeline.test', roles: [] },
    { key: 'ridgeline:cass', name: 'Cass Ferreira', email: 'cass@ridgeline.test', roles: [] },
    { key: 'ridgeline:del', name: 'Del Mbeki', email: 'del@ridgeline.test', roles: [] },
    { key: 'ridgeline:emery', name: 'Emery Novak', email: 'emery@ridgeline.test', roles: [] },
    { key: 'ridgeline:finn', name: 'Finn Castellanos', email: 'finn@ridgeline.test', roles: [] },
    { key: 'ridgeline:gale', name: 'Gale Ostrowski', email: 'gale@ridgeline.test', roles: [] },
    { key: 'ridgeline:harper', name: 'Harper Quill', email: 'harper@ridgeline.test', roles: [] },
  ],
  indexTable: {
    effectiveDate: '2026-01-01',
    factors: {
      SS: '0.8270',
      AS: '0.8180',
      BS: '0.8120',
      DS: '0.8000',
      GS: '0.7930',
      HS: '0.7840',
      STR: '0.8290',
      SM: '0.8550',
    },
  },
  events: [
    {
      key: 'ridgeline:points7',
      name: 'Points 7 at Fairgrounds',
      date: '2026-08-16',
      venue: 'County Fairgrounds Lot B',
      cutoffLocal: '2026-08-14T20:00',
      runsPerDriver: 2,
      heats: [
        { number: 1, classes: ['SS', 'STR'] },
        { number: 2, classes: ['GS', 'HS'] },
      ],
      stations: ['Start', 'Finish', 'Corner 1', 'Corner 2'],
      status: 'final',
      provisionalAtLocal: '2026-08-16T16:30',
      registrations: [
        {
          driverKey: 'ridgeline:avery',
          classCode: 'SS',
          carNumber: 12,
          carDescription: '2019 Chevrolet Corvette',
          checkedInLocal: '2026-08-16T08:10',
          stationName: 'Corner 1',
          stationHeat: 2,
          runs: [
            { runNumber: 1, rawTime: '52.418', cones: 1, committedAtLocal: '2026-08-16T10:12' },
            { runNumber: 2, rawTime: '51.907', cones: 0, committedAtLocal: '2026-08-16T11:48' },
          ],
        },
        {
          driverKey: 'ridgeline:bo',
          classCode: 'STR',
          carNumber: 7,
          carDescription: '2020 Mazda MX-5 RF',
          checkedInLocal: '2026-08-16T08:14',
          stationName: 'Corner 2',
          stationHeat: 2,
          runs: [
            { runNumber: 1, rawTime: '53.211', cones: 0, committedAtLocal: '2026-08-16T10:16' },
            { runNumber: 2, rawTime: null, cones: null, committedAtLocal: '2026-08-16T11:52' },
          ],
        },
        {
          driverKey: 'ridgeline:cass',
          classCode: 'GS',
          carNumber: 31,
          carDescription: '2017 Volkswagen GTI',
          checkedInLocal: '2026-08-16T08:19',
          stationName: 'Corner 1',
          stationHeat: 1,
          runs: [
            { runNumber: 1, rawTime: '56.034', cones: 2, committedAtLocal: '2026-08-16T13:05' },
            { runNumber: 2, rawTime: '55.120', cones: 0, committedAtLocal: '2026-08-16T14:31' },
          ],
        },
        {
          driverKey: 'ridgeline:del',
          classCode: 'HS',
          carNumber: 4,
          carDescription: '2016 Honda Fit',
          checkedInLocal: '2026-08-16T08:25',
          stationName: 'Corner 2',
          stationHeat: 1,
          runs: [
            { runNumber: 1, rawTime: '58.402', cones: 0, committedAtLocal: '2026-08-16T13:09' },
            { runNumber: 2, rawTime: '57.880', cones: 1, committedAtLocal: '2026-08-16T14:35' },
          ],
        },
      ],
    },
    {
      key: 'ridgeline:points9',
      name: 'Points 9 at Airpark',
      date: '2026-11-21',
      venue: 'Mesa Airpark Overflow Lot',
      cutoffLocal: '2026-11-20T18:00',
      runsPerDriver: 3,
      heats: [
        { number: 1, classes: ['SS', 'AS', 'BS', 'STR'] },
        { number: 2, classes: ['DS', 'GS', 'HS', 'SM'] },
      ],
      stations: ['Start', 'Finish', 'Corner 1', 'Corner 2', 'Corner 3', 'Corner 4'],
      status: 'registration_open',
      provisionalAtLocal: null,
      registrations: [
        {
          driverKey: 'ridgeline:avery',
          classCode: 'SS',
          carNumber: 12,
          carDescription: '2019 Chevrolet Corvette',
          checkedInLocal: null,
          stationName: null,
          stationHeat: null,
          runs: [],
        },
        {
          driverKey: 'ridgeline:cass',
          classCode: 'GS',
          carNumber: 31,
          carDescription: '2017 Volkswagen GTI',
          checkedInLocal: null,
          stationName: null,
          stationHeat: null,
          runs: [],
        },
      ],
    },
  ],
};

const TIDEWATER: SeedClub = {
  slug: 'tidewater',
  name: 'Tidewater Region',
  timeZone: 'America/New_York',
  users: [
    { key: 'tidewater:chair', name: 'Morgan Ashby', email: 'chair@tidewater.test', roles: ['chair'] },
    { key: 'tidewater:nico', name: 'Nico Brandt', email: 'nico@tidewater.test', roles: [] },
  ],
  indexTable: {
    effectiveDate: '2026-01-01',
    factors: {
      SS: '0.8250',
      AS: '0.8170',
      BS: '0.8110',
      DS: '0.7990',
      GS: '0.7920',
      HS: '0.7830',
      STR: '0.8280',
      SM: '0.8540',
    },
  },
  events: [
    {
      key: 'tidewater:points6',
      name: 'Tidewater Points 6',
      date: '2026-11-14',
      venue: 'Harborside Business Park',
      cutoffLocal: '2026-11-13T20:00',
      runsPerDriver: 3,
      heats: [
        { number: 1, classes: ['SS', 'AS', 'BS', 'STR'] },
        { number: 2, classes: ['DS', 'GS', 'HS', 'SM'] },
      ],
      stations: ['Start', 'Finish', 'Corner 1', 'Corner 2'],
      status: 'registration_open',
      provisionalAtLocal: null,
      registrations: [
        {
          driverKey: 'tidewater:nico',
          classCode: 'SS',
          carNumber: 55,
          carDescription: '2015 Porsche Cayman',
          checkedInLocal: null,
          stationName: null,
          stationHeat: null,
          runs: [],
        },
      ],
    },
  ],
};

function localInstant(local: string, timeZone: string): Date {
  const instant = zonedLocalToUtc(local, timeZone);
  if (instant === null) throw new Error(`Seed has an unreadable local time: ${local}`);
  return instant;
}

async function insertUser(
  client: PoolClient,
  user: SeedUser,
  clubId: string | null,
): Promise<string> {
  const id = stableId(`user:${user.key}`);
  await client.query(
    `INSERT INTO users (id, club_id, name, email, password_hash, roles)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, clubId, user.name, user.email, hashPassword(SEED_PASSWORD), user.roles],
  );
  return id;
}

async function seedEvent(
  client: PoolClient,
  club: SeedClub,
  clubId: string,
  event: SeedEvent,
  timingUserId: string,
): Promise<void> {
  const eventId = stableId(`event:${event.key}`);
  const cutoffUtc = localInstant(event.cutoffLocal, club.timeZone);
  const provisionalAt = event.provisionalAtLocal
    ? localInstant(event.provisionalAtLocal, club.timeZone)
    : null;
  const windowClosesAt = provisionalAt ? new Date(provisionalAt.getTime() + 1800 * 1000) : null;

  await client.query(
    `INSERT INTO events (id, club_id, name, event_date, venue, registration_cutoff_local,
        registration_cutoff_utc, runs_per_driver, heats, stations, status, running_heat,
        provisional_at, protest_window_closes_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, NULL, $12, $13)
     ON CONFLICT (id) DO NOTHING`,
    [
      eventId,
      clubId,
      event.name,
      event.date,
      event.venue,
      event.cutoffLocal,
      cutoffUtc,
      event.runsPerDriver,
      JSON.stringify(event.heats),
      event.stations,
      event.status,
      provisionalAt,
      windowClosesAt,
    ],
  );

  for (const heat of event.heats) {
    for (const [ordinal, name] of event.stations.entries()) {
      await client.query(
        `INSERT INTO stations (id, event_id, heat, name, ordinal)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [stableId(`station:${event.key}:${heat.number}:${name}`), eventId, heat.number, name, ordinal],
      );
    }
  }

  const factors = club.indexTable.factors;
  const entryInputs: EntryInput[] = [];
  const commits: { registrationId: string; runNumber: number; at: Date }[] = [];
  const emailOf = (driverKey: string): string => {
    const user = club.users.find((candidate) => candidate.key === driverKey);
    if (!user) throw new Error(`Seed references an unknown driver: ${driverKey}`);
    return user.email;
  };

  for (const registration of event.registrations) {
    const registrationId = stableId(`registration:${event.key}:${registration.driverKey}`);
    const driverId = stableId(`user:${registration.driverKey}`);
    const runHeat =
      event.heats.find((heat) => heat.classes.includes(registration.classCode))?.number ?? 1;
    const checkedInAt = registration.checkedInLocal
      ? localInstant(registration.checkedInLocal, club.timeZone)
      : null;
    await client.query(
      `INSERT INTO registrations (id, event_id, driver_id, class_code, car_number,
          car_description, run_heat, checked_in, checked_in_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        registrationId,
        eventId,
        driverId,
        registration.classCode,
        registration.carNumber,
        registration.carDescription,
        runHeat,
        checkedInAt !== null,
        checkedInAt,
      ],
    );

    await client.query(
      `INSERT INTO email_deliveries (id, club_id, event_id, registration_id, kind, dedupe_key,
          recipient, subject, body, state, attempts, sent_at)
       VALUES ($1, $2, $3, $4, 'registration_confirmation', $5, $6, $7, $8, 'sent', 1, now())
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        stableId(`delivery:confirmation:${event.key}:${registration.driverKey}`),
        clubId,
        eventId,
        registrationId,
        `registration_confirmation:${registrationId}`,
        emailOf(registration.driverKey),
        `Registered for ${event.name}: car ${registration.carNumber} ${registration.classCode}`,
        [
          `You are registered for ${event.name} on ${event.date} at ${event.venue}.`,
          '',
          `Car ${registration.carNumber} ${registration.classCode}`,
          `Run heat ${runHeat}`,
        ].join('\n'),
      ],
    );

    const factorText = factors[registration.classCode];
    const factorTt = factorText === undefined ? null : parseFactor(factorText);
    const runs: EntryInput['runs'] = [];
    for (let runNumber = 1; runNumber <= event.runsPerDriver; runNumber += 1) {
      const seeded = registration.runs.find((run) => run.runNumber === runNumber);
      const runId = stableId(`run:${event.key}:${registration.driverKey}:${runNumber}`);
      if (!seeded) {
        await client.query(
          `INSERT INTO runs (id, registration_id, run_number) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [runId, registrationId, runNumber],
        );
        runs.push({ runNumber, status: 'pending', outcome: null, adjustedMs: null, indexedMs: null });
        continue;
      }
      const committedAt = localInstant(seeded.committedAtLocal, club.timeZone);
      if (seeded.rawTime === null) {
        await client.query(
          `INSERT INTO runs (id, registration_id, run_number, status, outcome, factor_tt,
              committed_at, committed_by)
           VALUES ($1, $2, $3, 'committed', 'dnf', $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [runId, registrationId, runNumber, factorTt, committedAt, timingUserId],
        );
        runs.push({
          runNumber,
          status: 'committed',
          outcome: 'dnf',
          adjustedMs: null,
          indexedMs: null,
        });
      } else {
        const rawTimeMs = parseRawTime(seeded.rawTime);
        if (rawTimeMs === null || factorTt === null) {
          throw new Error(`Seed run ${runId} has an unreadable time`);
        }
        const times = computeRunTimes(rawTimeMs, seeded.cones ?? 0, factorTt);
        await client.query(
          `INSERT INTO runs (id, registration_id, run_number, status, outcome, raw_time_ms,
              cones, adjusted_ms, indexed_ms, factor_tt, committed_at, committed_by)
           VALUES ($1, $2, $3, 'committed', 'time', $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            runId,
            registrationId,
            runNumber,
            rawTimeMs,
            seeded.cones ?? 0,
            times.adjustedMs,
            times.indexedMs,
            factorTt,
            committedAt,
            timingUserId,
          ],
        );
        runs.push({
          runNumber,
          status: 'committed',
          outcome: 'time',
          adjustedMs: times.adjustedMs,
          indexedMs: times.indexedMs,
        });
      }
      commits.push({ registrationId, runNumber, at: committedAt });
    }

    entryInputs.push({
      registrationId,
      carNumber: registration.carNumber,
      classCode: registration.classCode,
      runs,
    });

    if (registration.stationName !== null && registration.stationHeat !== null) {
      const stationId = stableId(
        `station:${event.key}:${registration.stationHeat}:${registration.stationName}`,
      );
      await client.query(
        `UPDATE stations SET worker_registration_id = $2
          WHERE id = $1 AND worker_registration_id IS NULL`,
        [stationId, registrationId],
      );
      await client.query(
        `INSERT INTO email_deliveries (id, club_id, event_id, registration_id, kind, dedupe_key,
            recipient, subject, body, state, attempts, sent_at)
         VALUES ($1, $2, $3, $4, 'work_assignment', $5, $6, $7, $8, 'sent', 1, now())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          stableId(`delivery:assignment:${event.key}:${registration.driverKey}`),
          clubId,
          eventId,
          registrationId,
          `work_assignment:${stationId}:${registrationId}`,
          emailOf(registration.driverKey),
          `Work assignment for ${event.name}: ${registration.stationName}, heat ${registration.stationHeat}`,
          `You are working ${registration.stationName} in heat ${registration.stationHeat}.`,
        ],
      );
    }
  }

  await replayRankChanges(client, entryInputs, commits);
}

/** Fills each entry's latest rank-change badge by replaying the seeded commits in order. */
async function replayRankChanges(
  client: PoolClient,
  entries: EntryInput[],
  commits: { registrationId: string; runNumber: number; at: Date }[],
): Promise<void> {
  if (commits.length === 0) return;
  const played = new Map<string, EntryInput>(
    entries.map((entry) => [
      entry.registrationId,
      {
        ...entry,
        runs: entry.runs.map((run) => ({
          ...run,
          status: 'pending' as const,
          outcome: null,
          adjustedMs: null,
          indexedMs: null,
        })),
      },
    ]),
  );
  const order = [...commits].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const commit of order) {
    const before = rankEntries([...played.values()]);
    const target = played.get(commit.registrationId);
    const source = entries.find((entry) => entry.registrationId === commit.registrationId);
    if (!target || !source) continue;
    const finalRun = source.runs.find((run) => run.runNumber === commit.runNumber);
    const slot = target.runs.findIndex((run) => run.runNumber === commit.runNumber);
    if (!finalRun || slot === -1) continue;
    target.runs[slot] = finalRun;
    const after = rankEntries([...played.values()]);
    const afterEntry = after.find((entry) => entry.registrationId === commit.registrationId);
    if (!afterEntry) continue;
    const change = rankChangeFor(
      before.find((entry) => entry.registrationId === commit.registrationId),
      afterEntry,
    );
    await client.query(
      `UPDATE registrations
          SET last_change_run_number = $2, last_change_at = $3, last_change_indexed = $4,
              last_change_class = $5, last_change_raw = $6
        WHERE id = $1`,
      [commit.registrationId, commit.runNumber, commit.at, change.indexed, change.class, change.raw],
    );
  }
}

async function seedClub(client: PoolClient, club: SeedClub): Promise<void> {
  const clubId = stableId(`club:${club.slug}`);
  await client.query(
    `INSERT INTO clubs (id, slug, name, time_zone) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [clubId, club.slug, club.name, club.timeZone],
  );
  let timingUserId = '';
  let chairUserId = '';
  for (const user of club.users) {
    const id = await insertUser(client, user, clubId);
    if (user.roles.includes('timing')) timingUserId = id;
    if (user.roles.includes('chair')) chairUserId = id;
  }
  if (timingUserId === '') timingUserId = chairUserId;

  await client.query(
    `INSERT INTO index_tables (id, club_id, effective_date, factors, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (id) DO NOTHING`,
    [
      stableId(`index-table:${club.slug}:${club.indexTable.effectiveDate}`),
      clubId,
      club.indexTable.effectiveDate,
      JSON.stringify(club.indexTable.factors),
      chairUserId,
    ],
  );

  for (const event of club.events) {
    await seedEvent(client, club, clubId, event, timingUserId);
  }
}

export async function seed(): Promise<void> {
  await withTransaction(async (client) => {
    await insertUser(
      client,
      { key: 'operator', name: 'Rowan Pell', email: 'ops@pylonworks.test', roles: ['operator'] },
      null,
    );
    await seedClub(client, RIDGELINE);
    await seedClub(client, TIDEWATER);
  });
}
