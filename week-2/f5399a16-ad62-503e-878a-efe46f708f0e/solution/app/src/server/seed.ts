// The published starting data, applied once per database with the schema.

import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { drawingSvg } from '../shared/drawing';
import { foldedKey } from '../shared/fold';
import { addDays, dateIn, nextClockChange, TOWN_ZONES, wallToInstant, weekdayOf } from '../shared/time';
import { timecode, type FrameRate } from '../shared/timecode';
import { SCHEMA, one, pool } from './db';
import { pageEndsAt, splitFee } from './domain';
import { cutSnapshot, newStamp, roundedNow } from './records';
import { pageToken } from './routes/pages';
import { hashPassword } from './session';

const SEED_PASSWORD = 'desk-pass-2027';

interface SeedJob {
  title: string;
  clientKey: string;
  rate: FrameRate;
  target: number;
  adId: string;
  durations: number[];
  state: string;
}

function drawingHash(seed: number): string {
  return createHash('sha256').update(drawingSvg(seed)).digest('hex');
}

async function insertDesk(tx: pg.PoolClient, name: string, email: string, hash: string, at: Date): Promise<string> {
  const id = randomUUID();
  await tx.query('INSERT INTO desks (id, name, email, email_key, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [id, name, email, foldedKey(email), hash, at]);
  return id;
}

async function insertClient(tx: pg.PoolClient, deskId: string, name: string, place: string, at: Date): Promise<string> {
  const id = randomUUID();
  await tx.query(`INSERT INTO clients (id, desk_id, name, name_key, place, state, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6)`, [id, deskId, name, foldedKey(name), place, at]);
  return id;
}

async function insertProducer(tx: pg.PoolClient, clientId: string, name: string, email: string, town: string, language: string, at: Date): Promise<string> {
  const id = randomUUID();
  await tx.query('INSERT INTO producers (id, client_id, name, name_key, email, town, language, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, clientId, name, foldedKey(name), email, town, language, at]);
  return id;
}

async function insertNote(tx: pg.PoolClient, jobId: string, producerId: string, pageId: string | null, typedName: string, text: string, state: string, code: string, at: Date): Promise<void> {
  await tx.query(
    `INSERT INTO notes (id, job_id, page_id, producer_id, frame, timecode, x, y, typed_name, state, text, created_at) VALUES ($1, $2, $3, $4, 4, $5, 50, 50, $6, $7, $8, $9)`,
    [randomUUID(), jobId, pageId, producerId, code, typedName, state, text, at],
  );
}

async function seedDesks(tx: pg.PoolClient, now: number): Promise<void> {
  const at = new Date(roundedNow(now));
  const today = dateIn(now, TOWN_ZONES.amsterdam);
  const hash = await hashPassword(SEED_PASSWORD);
  const noor = await insertDesk(tx, 'Noor Bakker', 'noor@noorbakkerboards.example', hash, at);
  const theo = await insertDesk(tx, 'Theo Lindqvist', 'theo@noorbakkerboards.example', hash, at);

  const hudson = await insertClient(tx, noor, 'Hudson Yard Pictures', 'newYork', at);
  const stichting = await insertClient(tx, noor, 'STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM', 'netherlands', at);
  const maple = await insertClient(tx, noor, 'Maple & Lake Films', 'ontario', at);
  const gulf = await insertClient(tx, noor, 'Gulf Meridian Airways', 'dubai', at);
  const marcus = await insertProducer(tx, hudson, 'Marcus Hale', 'marcus.hale@hudsonyard.example', 'newYork', 'en', at);
  await insertProducer(tx, stichting, 'Zoë Ørsted', 'zoe.orsted@noordzee.example', 'amsterdam', 'nl', at);
  const elodie = await insertProducer(tx, maple, 'Élodie Tremblay', 'elodie.tremblay@mapleandlake.example', 'toronto', 'fr', at);
  await insertProducer(tx, gulf, 'ليلى حداد', 'layla.haddad@gulfmeridian.example', 'dubai', 'ar', at);

  const clients: Record<string, string> = { hudson, stichting, maple, gulf };
  const due = addDays(today, 21);
  const jobs: SeedJob[] = [
    { title: 'Harbour Light', clientKey: 'hudson', rate: '29.97', target: 30, adId: 'HUDS0000301H', durations: Array<number>(12).fill(75), state: 'signedOff' },
    { title: 'Polder Run', clientKey: 'stichting', rate: '25', target: 30, adId: 'NOOR0000302H', durations: [...Array<number>(11).fill(62), 68], state: 'draft' },
    { title: 'Maple Line', clientKey: 'maple', rate: '23.976', target: 15, adId: 'MAPL0000303H', durations: Array<number>(12).fill(30), state: 'inReview' },
    { title: 'Gulf Morning', clientKey: 'gulf', rate: '25', target: 6, adId: 'GULF0000304D', durations: Array<number>(12).fill(12), state: 'draft' },
  ];
  const ids: Record<string, string> = {};
  for (const job of jobs) {
    const jobId = randomUUID();
    ids[job.title] = jobId;
    await tx.query(
      `INSERT INTO jobs (id, desk_id, client_id, title, title_key, ad_id, due_date, target_seconds, frame_rate, aspect, state, stamp, stamp_at, next_frame, next_cut, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '16:9', $10, $11, $12, 13, 3, $12)`,
      [jobId, noor, clients[job.clientKey], job.title, foldedKey(job.title), job.adId, due, job.target, job.rate, job.state, newStamp(), at],
    );
    const frames: Record<string, unknown>[] = [];
    for (const [index, duration] of job.durations.entries()) {
      const number = index + 1;
      const frame = {
        number,
        position: number,
        duration_frames: duration,
        action_note: `Action for frame ${number}.`,
        audio_note: '',
        shot: String(number),
        visual: `Action for frame ${number}.`,
        file_name: `frame-${number}.svg`,
        width: 1280,
        height: 720,
        sha256: drawingHash(number),
        drawing_seed: number,
      };
      frames.push(frame);
      await tx.query(
        `INSERT INTO frames (job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, drawing_seed)
         VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8, 1280, 720, $9, $10)`,
        [jobId, number, number, duration, frame.action_note, frame.shot, frame.visual, frame.file_name, frame.sha256, number],
      );
    }
    const snapshot = JSON.stringify(cutSnapshot(frames));
    for (const [number, name] of [[1, 'First pass'], [2, 'Second pass']] as const) {
      const signed = job.title === 'Harbour Light' && number === 1;
      await tx.query(
        'INSERT INTO cuts (id, job_id, number, name, frame_rate, frames, created_at, signed_off_at, signed_off_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [randomUUID(), jobId, number, name, job.rate, snapshot, at, signed ? at : null, signed ? 'Marcus Hale' : null],
      );
    }
  }

  const fourthFrame = (rate: FrameRate, duration: number) => timecode(duration * 3, rate);
  await insertNote(tx, ids['Harbour Light'] as string, marcus, null, 'Marcus Hale', 'Hold the harbour light a beat longer.', 'open', fourthFrame('29.97', 75), at);
  await insertNote(tx, ids['Harbour Light'] as string, marcus, null, 'Marcus Hale', 'Bring the boat in from the left.', 'done', fourthFrame('29.97', 75), at);
  const mapleJob = ids['Maple Line'] as string;
  const endedPage = randomUUID();
  await tx.query(
    `INSERT INTO private_pages (id, kind, token, job_id, producer_id, cut, ends_at, ended_at, ended_by, typed_name, reminder_sent, created_at)
     VALUES ($1, 'review', $2, $3, $4, 2, $5, $6, 'artist', 'Élodie Tremblay', true, $6)`,
    [endedPage, pageToken(), mapleJob, elodie, new Date(pageEndsAt('review', due, 'toronto', now)), at],
  );
  await insertNote(tx, mapleJob, elodie, endedPage, 'Élodie Tremblay', 'Le plan est un peu court.', 'open', fourthFrame('23.976', 30), at);

  await tx.query(
    `INSERT INTO cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id) VALUES ($1, $2, 'hr-1001', 'Lantern Street', 'Ilse Voss', 30, 'NL', $3, $4, '120.00', 'lic-401')`,
    [randomUUID(), ids['Polder Run'], addDays(today, -30), addDays(today, -1)],
  );
  const torontoToday = dateIn(now, TOWN_ZONES.toronto);
  await tx.query(
    `INSERT INTO cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id) VALUES ($1, $2, 'hr-1002', 'Tidal Grid', 'Joost Amani', 15, 'CA', $3, $4, '120.00', 'lic-402')`,
    [randomUUID(), mapleJob, addDays(torontoToday, -30), addDays(torontoToday, 3)],
  );

  const change = [nextClockChange(today, TOWN_ZONES.newYork), nextClockChange(today, TOWN_ZONES.amsterdam)].sort()[0] as string;
  let before = addDays(change, -1);
  while (weekdayOf(before) === 0 || weekdayOf(before) === 6) before = addDays(before, -1);
  let after = addDays(change, 1);
  while (weekdayOf(after) === 0 || weekdayOf(after) === 6) after = addDays(after, 1);
  for (const date of [before, after]) {
    const startsAt = wallToInstant(date, '09:00', TOWN_ZONES.newYork) as number;
    await tx.query(
      `INSERT INTO calls (id, desk_id, producer_id, date, time, minutes, note, starts_at, ends_at, uid, sequence, state, created_at)
       VALUES ($1, $2, $3, $4, '09:00', 30, '', $5, $6, $7, 0, 'booked', $8)`,
      [randomUUID(), noor, marcus, date, new Date(startsAt), new Date(startsAt + 1_800_000), `${randomUUID()}@noorbakkerboards.example`, at],
    );
  }

  const { milestones, taxMinor } = splitFee(600000, 'ontario');
  const feePage = randomUUID();
  await tx.query(
    `INSERT INTO private_pages (id, kind, token, job_id, producer_id, ends_at, created_at) VALUES ($1, 'fee', $2, $3, $4, $5, $6)`,
    [feePage, pageToken(), mapleJob, elodie, new Date(pageEndsAt('fee', due, 'toronto', now)), at],
  );
  await tx.query(
    `INSERT INTO letters (id, job_id, currency, scope, fee_minor, tax_minor, milestones, state, stamp, stamp_at, producer_id, page_id)
     VALUES ($1, $2, 'CAD', 'Boards and story reel', 600000, $3, $4, 'sent', $5, $6, $7, $8)`,
    [randomUUID(), mapleJob, taxMinor, JSON.stringify(milestones), newStamp(), at, elodie, feePage],
  );

  const fjordlight = await insertClient(tx, theo, 'Fjordlight Studio', 'netherlands', at);
  await tx.query(
    `INSERT INTO jobs (id, desk_id, client_id, title, title_key, ad_id, due_date, target_seconds, frame_rate, aspect, state, stamp, stamp_at, created_at)
     VALUES ($1, $2, $3, 'Quiet Harbour', $4, 'FJOR0000401H', $5, 15, '25', '16:9', 'draft', $6, $7, $7)`,
    [randomUUID(), theo, fjordlight, foldedKey('Quiet Harbour'), due, newStamp(), at],
  );
}

/** Schema and seed under one lock, so several starts on a database apply them once. */
export async function prepareDatabase(): Promise<void> {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query('SELECT pg_advisory_xact_lock(727201)');
    await tx.query(SCHEMA);
    if (!(await one(tx, `SELECT 1 FROM meta WHERE key = 'seeded'`))) {
      await seedDesks(tx, Date.now());
      await tx.query(`INSERT INTO meta (key, value) VALUES ('seeded', 'yes')`);
    }
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
