import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from './config.js';
import { now } from './clock.js';
import { query, queryOne, withClient, type Db } from './db.js';
import { newId, hashPassword, foldEmail } from './util.js';
import { log } from './log.js';
import { businessDateAt, addDays } from './domain/time.js';
import { computeDayInstants } from './domain/barndays.js';
import { lineAngle, alignmentOf, type Hoof } from './domain/marks.js';
import { objectKeys, putObject } from './services/storage.js';
import { forgetPractice } from './domain/practice.js';

/**
 * An empty database is migrated and seeded when the app serves, so a reset database is
 * seeded again. The seed is written exactly once even when several instances start at
 * the same moment: an advisory lock serialises it and the seed_state row records it.
 */
const SEED_LOCK = 8471120354190003n;
const SEED_PASSWORD = 'hoofcare-2026';
const PRACTICE_ZONE = 'America/Denver';

interface SeedUser {
  name: string;
  email: string;
  role: 'farrier' | 'apprentice' | 'owner' | 'barn_manager';
  phone?: string;
  barn?: 'cedar' | 'larkspur';
}

const USERS: SeedUser[] = [
  { name: 'Marlow Tesk', email: 'farrier@clinchline.test', role: 'farrier' },
  { name: 'Ike Ferreira', email: 'apprentice@clinchline.test', role: 'apprentice' },
  { name: 'Rosa Vint', email: 'manager.cedar@clinchline.test', role: 'barn_manager', barn: 'cedar' },
  { name: 'Hollis Breen', email: 'manager.larkspur@clinchline.test', role: 'barn_manager', barn: 'larkspur' },
  { name: 'Ada Quill', email: 'owner.ada@clinchline.test', role: 'owner', phone: '+1 303 555 0141' },
  { name: 'Bram Lowe', email: 'owner.bram@clinchline.test', role: 'owner', phone: '+1 303 555 0142' },
  { name: 'Cleo Marsh', email: 'owner.cleo@clinchline.test', role: 'owner', phone: '+1 303 555 0143' },
  { name: 'Dev Ansel', email: 'owner.dev@clinchline.test', role: 'owner', phone: '+1 303 555 0144' },
];

interface SeedHorse {
  name: string;
  owner: string;
  barn: 'cedar' | 'larkspur';
  stall: string;
  cycleWeeks: number;
}

const HORSES: SeedHorse[] = [
  { name: 'Juniper', owner: 'owner.ada@clinchline.test', barn: 'cedar', stall: '4', cycleWeeks: 6 },
  { name: 'Pilot', owner: 'owner.ada@clinchline.test', barn: 'cedar', stall: '7', cycleWeeks: 8 },
  { name: 'Saffron', owner: 'owner.bram@clinchline.test', barn: 'cedar', stall: '5', cycleWeeks: 5 },
  { name: 'Quarry', owner: 'owner.bram@clinchline.test', barn: 'cedar', stall: '9', cycleWeeks: 6 },
  { name: 'Tamarack', owner: 'owner.cleo@clinchline.test', barn: 'cedar', stall: '12', cycleWeeks: 7 },
  { name: 'Wicket', owner: 'owner.cleo@clinchline.test', barn: 'cedar', stall: '11', cycleWeeks: 8 },
  { name: 'Fern', owner: 'owner.dev@clinchline.test', barn: 'cedar', stall: '14', cycleWeeks: 6 },
  { name: 'Maple', owner: 'owner.dev@clinchline.test', barn: 'larkspur', stall: '2', cycleWeeks: 6 },
];

/** History visits were billed before Clinchline, so they carry no invoice and no booking. */
const HISTORY: { horse: string; dayOffset: number }[] = [
  { horse: 'Juniper', dayOffset: -84 },
  { horse: 'Juniper', dayOffset: -42 },
  { horse: 'Pilot', dayOffset: -63 },
  { horse: 'Saffron', dayOffset: -10 },
  { horse: 'Maple', dayOffset: -30 },
];

interface SeedMarks {
  hoof: Hoof;
  wall: [number, number, number, number];
  pastern: [number, number, number, number];
  asset: string;
}

const JUNIPER_MARKS: Record<number, SeedMarks[]> = {
  [-84]: [
    { hoof: 'LF', wall: [300, 800, 700, 297], pastern: [700, 700, 1100, 107], asset: 'hoof-lf-earlier' },
    { hoof: 'RF', wall: [300, 800, 700, 330], pastern: [700, 700, 1100, 170], asset: 'hoof-rf-earlier' },
  ],
  [-42]: [
    { hoof: 'LF', wall: [300, 820, 700, 269], pastern: [700, 700, 1100, 129], asset: 'hoof-lf-later' },
    { hoof: 'RF', wall: [300, 800, 700, 310], pastern: [700, 700, 1100, 210], asset: 'hoof-rf-later' },
  ],
};

function assetPath(name: string): string {
  return resolve(import.meta.dirname, 'assets', `${name}.jpg`);
}

export async function seedIfEmpty(): Promise<void> {
  await withClient(async (db) => {
    await db.query('SELECT pg_advisory_lock($1)', [SEED_LOCK]);
    try {
      const existing = await queryOne<{ id: number }>(db, 'SELECT id FROM seed_state WHERE id = 1');
      if (existing !== null) return;
      await db.query('BEGIN');
      try {
        await writeSeed(db);
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
      forgetPractice();
      log.event({ event: 'seed_written' });
    } finally {
      await db.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK]);
    }
  });
}

async function writeSeed(db: Db): Promise<void> {
  const instant = now();
  const seedDate = businessDateAt(instant, PRACTICE_ZONE);

  await query(db, 'INSERT INTO practice (id, name, time_zone) VALUES (1, $1, $2)', [
    'Rasp & Rein',
    PRACTICE_ZONE,
  ]);

  const barnIds: Record<'cedar' | 'larkspur', string> = { cedar: newId(), larkspur: newId() };
  await query(db, 'INSERT INTO barns (id, name, name_folded, trip_fee_cents) VALUES ($1,$2,$3,$4)', [
    barnIds.cedar,
    'Cedar Hollow Stables',
    'cedar hollow stables',
    4500,
  ]);
  await query(db, 'INSERT INTO barns (id, name, name_folded, trip_fee_cents) VALUES ($1,$2,$3,$4)', [
    barnIds.larkspur,
    'Larkspur Farm',
    'larkspur farm',
    6000,
  ]);

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const id = newId();
    userIds.set(user.email, id);
    await query(
      db,
      `INSERT INTO users (id, name, email, email_folded, phone, role, password_hash, barn_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        user.name,
        user.email,
        foldEmail(user.email),
        user.phone ?? null,
        user.role,
        passwordHash,
        user.barn === undefined ? null : barnIds[user.barn],
        instant,
      ],
    );
  }

  const horseIds = new Map<string, string>();
  for (const horse of HORSES) {
    const id = newId();
    horseIds.set(horse.name, id);
    await query(
      db,
      `INSERT INTO horses (id, name, name_folded, owner_id, barn_id, stall, cycle_weeks, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        horse.name,
        horse.name.toLowerCase(),
        userIds.get(horse.owner),
        barnIds[horse.barn],
        horse.stall,
        horse.cycleWeeks,
        instant,
      ],
    );
  }

  await query(
    db,
    `INSERT INTO price_lists (id, effective_from, deposit_cents, trim_cents, front_reset_cents,
                              full_reset_cents, front_new_cents, full_new_cents, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [newId(), '2026-01-01', 2500, 5500, 12000, 19000, 15000, 24000, instant],
  );

  const farrierId = userIds.get('farrier@clinchline.test') as string;

  for (const entry of HISTORY) {
    const visitId = newId();
    const businessDate = addDays(seedDate, entry.dayOffset);
    await query(
      db,
      `INSERT INTO visits (id, horse_id, booking_id, barn_day_id, business_date, status, note,
                           work_codes, seeded_history, closed_at, created_at)
       VALUES ($1,$2,NULL,NULL,$3,'invoiced',NULL,NULL,true,$4,$4)`,
      [visitId, horseIds.get(entry.horse), businessDate, instant],
    );

    if (entry.horse !== 'Juniper') continue;
    const marksForVisit = JUNIPER_MARKS[entry.dayOffset] ?? [];
    for (const marks of marksForVisit) {
      const photoId = newId();
      const key = objectKeys.photo(visitId, marks.hoof, 'after', photoId, 'jpg');
      const bytes = await readFile(assetPath(marks.asset));
      await putObject(key, bytes, 'image/jpeg');
      await query(
        db,
        `INSERT INTO photos (id, visit_id, hoof, phase, content_type, extension, width, height,
                             stored_bytes, object_key, thumbnail_status, thumbnail_key, created_at)
         VALUES ($1,$2,$3,'after','image/jpeg','jpg',1200,900,$4,$5,'pending',NULL,$6)`,
        [photoId, visitId, marks.hoof, bytes.length, key, instant],
      );
      await query(
        db,
        `INSERT INTO jobs (id, kind, status, payload, max_attempts, run_at, dedupe_key, created_at, updated_at)
         VALUES ($1,'thumbnail','queued',$2::jsonb,$3,$4,$5,$4,$4)`,
        [
          newId(),
          JSON.stringify({ photo_id: photoId }),
          config.jobMaxAttempts,
          instant,
          `thumbnail:${photoId}`,
        ],
      );

      const wallAngle = lineAngle({
        x1: marks.wall[0],
        y1: marks.wall[1],
        x2: marks.wall[2],
        y2: marks.wall[3],
      });
      const pasternAngle = lineAngle({
        x1: marks.pastern[0],
        y1: marks.pastern[1],
        x2: marks.pastern[2],
        y2: marks.pastern[3],
      });
      await query(
        db,
        `INSERT INTO hoof_marks (id, visit_id, hoof, version, wall_x1, wall_y1, wall_x2, wall_y2,
                                 past_x1, past_y1, past_x2, past_y2, wall_angle, past_angle,
                                 alignment, saved_by, saved_at, restored_from, current)
         VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL,true)`,
        [
          newId(),
          visitId,
          marks.hoof,
          marks.wall[0],
          marks.wall[1],
          marks.wall[2],
          marks.wall[3],
          marks.pastern[0],
          marks.pastern[1],
          marks.pastern[2],
          marks.pastern[3],
          wallAngle,
          pasternAngle,
          alignmentOf(wallAngle, pasternAngle),
          farrierId,
          instant,
        ],
      );
    }
  }

  await insertBarnDay(db, {
    barnId: barnIds.cedar,
    businessDate: addDays(seedDate, 14),
    startTime: '07:30',
    slotCount: 4,
    slotMinutes: 45,
    tripFeeCents: 4500,
    status: 'published',
    at: instant,
  });
  await insertBarnDay(db, {
    barnId: barnIds.larkspur,
    businessDate: addDays(seedDate, 21),
    startTime: '08:00',
    slotCount: 2,
    slotMinutes: 60,
    tripFeeCents: 6000,
    status: 'draft',
    at: instant,
  });

  await query(db, 'INSERT INTO seed_state (id, seeded_at, seed_date) VALUES (1,$1,$2)', [
    instant,
    seedDate,
  ]);
}

interface SeedDay {
  barnId: string;
  businessDate: string;
  startTime: string;
  slotCount: number;
  slotMinutes: number;
  tripFeeCents: number;
  status: 'draft' | 'published';
  at: Date;
}

async function insertBarnDay(db: Db, day: SeedDay): Promise<void> {
  const instants = computeDayInstants(day.businessDate, day.startTime, PRACTICE_ZONE);
  if (instants === null) throw new Error('seed barn day start does not exist');
  const id = newId();
  await query(
    db,
    `INSERT INTO barn_days (id, barn_id, business_date, start_time, starts_at,
                            cancellation_cutoff_at, slot_count, slot_minutes, trip_fee_cents,
                            status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      day.barnId,
      day.businessDate,
      day.startTime,
      instants.startsAt,
      instants.cutoffAt,
      day.slotCount,
      day.slotMinutes,
      day.tripFeeCents,
      day.status,
      day.at,
    ],
  );
  for (let position = 0; position < day.slotCount; position += 1) {
    const slotInstant = new Date(instants.startsAt.getTime() + position * day.slotMinutes * 60000);
    await query(
      db,
      'INSERT INTO slots (id, barn_day_id, position, slot_time) VALUES ($1,$2,$3,$4)',
      [newId(), id, position, businessTime(slotInstant)],
    );
  }
}

function businessTime(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PRACTICE_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}
