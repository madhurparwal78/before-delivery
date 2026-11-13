/** Seed data: three households with adopted plans, one swap and costs.
 *  Applied idempotently at serve time. */
import { PoolClient } from 'pg';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { appendLog } from './db';
import { canonicalJson, digestOf } from '../lib/canonical';
import { splitAmount } from '../lib/money';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const test = scryptSync(password, salt, 32).toString('hex');
  return test === hash;
}

export async function seedIfEmpty(client: PoolClient): Promise<void> {
  const check = await client.query('SELECT 1 FROM households WHERE id = $1', ['9007199254740993']);
  if (check.rows.length > 0) return;
  await seedMapleFern(client);
  await seedBirchLane(client);
  await seedCedarCourt(client);
}

async function seedMapleFern(client: PoolClient): Promise<void> {
  const hid = '9007199254740993';
  await insertHousehold(client, hid, 'Maple & Fern', 'CAD', 'America/St_Johns',
    'Robin Okafor', 'robin@maple-fern.test', 'Hollow-Robin-2026',
    'Sam Lindqvist', 'sam@maple-fern.test', 'Hollow-Sam-2026');
  const versionBody = mapleFernVersion();
  const versionId = '9007199254740999';
  const bodyJson = JSON.stringify(versionBody);
  const etag = `"${digestOf(Buffer.from(canonicalJson(versionBody), 'utf8'))}"`;
  await client.query(
    `INSERT INTO plan_versions (id, household_id, number, status, effective_from, exchange_zone, first_exchange_at,
       base_pattern, base_anchor, split_planning_bp, split_other_bp, max_consecutive_nights, body, etag)
     VALUES ($1,$2,1,'adopted','2026-01-01','America/St_Johns','2026-01-01T17:00:00-03:30',
       $3,'2026-01-05',6000,4000,NULL,$4,$5)`,
    [versionId, hid, 'PPOOPPPPPOOOOO', bodyJson, etag],
  );
  await appendLog(client, hid, 'planning', 'household.created', hid);
  await appendLog(client, hid, 'other', 'household.joined', hid);
  await appendLog(client, hid, 'planning', 'plan.adopted', versionId);

  const swapId = '9007199254741031';
  await client.query(
    `INSERT INTO swaps (id, household_id, nights_start, nights_end, to_parent, created_by, note, state,
       sent_at, answer_by, answer_zone, answered_at, etag)
     VALUES ($1,$2,'2026-06-12','2026-06-14','other','planning',NULL,'settled',
       '2026-06-01T12:00:00Z','2026-06-04T20:39:00Z','America/St_Johns','2026-06-03T10:00:00Z',$3)`,
    [swapId, hid, etagFor(swapId)],
  );
  await appendLog(client, hid, 'planning', 'swap.sent', swapId);
  await appendLog(client, hid, 'other', 'swap.accepted', swapId);
  await appendLog(client, hid, 'system', 'swap.settled', swapId);

  await insertSeedCost(client, hid, '9007199254741021', 'School shoes', 'clothing', 4999,
    '2026-09-02T18:00:00-02:30', '2026-09-02', 'planning', versionId, 6000, 4000, 'settled',
    '2026-09-02T20:00:00Z', '2026-09-04T20:00:00Z');
  await insertSeedCost(client, hid, '9007199254741022', 'Swim lessons term', 'activities', 12501,
    '2026-10-01T18:00:00-02:30', '2026-10-01', 'other', versionId, 6000, 4000, 'accepted',
    '2026-10-01T20:00:00Z', '2026-10-03T20:00:00Z');
}

function mapleFernVersion(): Record<string, unknown> {
  return {
    effectiveFrom: '2026-01-01',
    exchangeZone: 'America/St_Johns',
    firstExchangeAt: '2026-01-01T17:00:00-03:30',
    base: { pattern: 'PPOOPPPPPOOOOO', anchor: '2026-01-05' },
    splitBp: { planning: 6000, other: 4000 },
    maxConsecutiveNights: null,
    rules: [
      { id: 'easter', kind: 'holiday', name: 'Easter', date: { type: 'easter' }, startOffset: -2, nights: 3, oddYears: 'planning', evenYears: 'other' },
      { id: 'thanksgiving', kind: 'holiday', name: 'Thanksgiving', date: { type: 'nth_weekday', month: 11, weekday: 4, n: 4 }, startOffset: -1, nights: 4, oddYears: 'planning', evenYears: 'other' },
      { id: 'xmas-eve', kind: 'holiday', name: 'Christmas Eve', date: { type: 'fixed', month: 12, day: 24 }, startOffset: 0, nights: 1, oddYears: 'other', evenYears: 'planning' },
      { id: 'xmas-day', kind: 'holiday', name: 'Christmas Day', date: { type: 'fixed', month: 12, day: 25 }, startOffset: 0, nights: 1, oddYears: 'planning', evenYears: 'other' },
      { id: 'winter-2026', kind: 'school_break', name: 'Winter break', nights: '2026-12-19/2027-01-04', split: 'halves', firstHalfOddYears: 'planning' },
      { id: 'spring-2027', kind: 'school_break', name: 'Spring break', nights: '2027-03-20/2027-03-28', split: 'halves', firstHalfOddYears: 'planning' },
      { id: 'winter-2027', kind: 'school_break', name: 'Winter break 2027', nights: '2027-12-18/2028-01-03', split: 'halves', firstHalfOddYears: 'planning' },
      { id: 'summer-2027', kind: 'vacation', name: 'Summer in Boston', parent: 'other', nights: '2027-07-10/2027-07-24', exchangeZone: 'America/New_York', firstExchangeAt: '2027-07-10T10:00:00-04:00' },
    ],
  };
}

async function seedBirchLane(client: PoolClient): Promise<void> {
  const hid = '9007199254740995';
  await insertHousehold(client, hid, 'Birch Lane', 'KWD', 'Australia/Lord_Howe',
    'Kai Moreno', 'kai@birch-lane.test', 'Hollow-Kai-2026',
    'Ari Moreno', 'ari@birch-lane.test', 'Hollow-Ari-2026');
  const versionId = '9007199254741001';
  const body = {
    effectiveFrom: '2026-01-01',
    exchangeZone: 'Australia/Lord_Howe',
    firstExchangeAt: '2026-01-01T18:00:00+11:00',
    base: { pattern: 'PPPPPPPOOOOOOO', anchor: '2026-01-05' },
    splitBp: { planning: 5000, other: 5000 },
    maxConsecutiveNights: null,
    rules: [],
  };
  await client.query(
    `INSERT INTO plan_versions (id, household_id, number, status, effective_from, exchange_zone, first_exchange_at,
       base_pattern, base_anchor, split_planning_bp, split_other_bp, max_consecutive_nights, body, etag)
     VALUES ($1,$2,1,'adopted','2026-01-01','Australia/Lord_Howe','2026-01-01T18:00:00+11:00',
       'PPPPPPPOOOOOOO','2026-01-05',5000,5000,NULL,$3,$4)`,
    [versionId, hid, JSON.stringify(body), `"${digestOf(Buffer.from(canonicalJson(body), 'utf8'))}"`],
  );
  await appendLog(client, hid, 'planning', 'household.created', hid);
  await appendLog(client, hid, 'other', 'household.joined', hid);
  await appendLog(client, hid, 'planning', 'plan.adopted', versionId);
  await insertSeedCost(client, hid, '9007199254741012', 'Piano lessons', 'activities', 8000,
    '2026-10-05T12:00:00+11:00', '2026-10-05', 'planning', versionId, 5000, 5000, 'accepted',
    '2026-10-05T06:00:00Z', '2026-10-07T06:00:00Z');
}

async function seedCedarCourt(client: PoolClient): Promise<void> {
  const hid = '9007199254740997';
  await insertHousehold(client, hid, 'Cedar Court', 'JPY', 'Pacific/Pago_Pago',
    'Noor Haddad', 'noor@cedar-court.test', 'Hollow-Noor-2026',
    'Tove Aalto', 'tove@cedar-court.test', 'Hollow-Tove-2026');
  const versionId = '9007199254741003';
  const body = {
    effectiveFrom: '2026-01-01',
    exchangeZone: 'Pacific/Pago_Pago',
    firstExchangeAt: '2026-01-01T09:00:00-11:00',
    base: { pattern: 'PPOO', anchor: '2026-01-05' },
    splitBp: { planning: 3333, other: 6667 },
    maxConsecutiveNights: null,
    rules: [],
  };
  await client.query(
    `INSERT INTO plan_versions (id, household_id, number, status, effective_from, exchange_zone, first_exchange_at,
       base_pattern, base_anchor, split_planning_bp, split_other_bp, max_consecutive_nights, body, etag)
     VALUES ($1,$2,1,'adopted','2026-01-01','Pacific/Pago_Pago','2026-01-01T09:00:00-11:00',
       'PPOO','2026-01-05',3333,6667,NULL,$3,$4)`,
    [versionId, hid, JSON.stringify(body), `"${digestOf(Buffer.from(canonicalJson(body), 'utf8'))}"`],
  );
  await appendLog(client, hid, 'planning', 'household.created', hid);
  await appendLog(client, hid, 'other', 'household.joined', hid);
  await appendLog(client, hid, 'planning', 'plan.adopted', versionId);
  await insertSeedCost(client, hid, '9007199254741013', 'Uniforms', 'school', 123456,
    '2026-10-05T12:00:00-11:00', '2026-10-05', 'planning', versionId, 3333, 6667, 'accepted',
    '2026-10-05T23:00:00Z', '2026-10-07T23:00:00Z');
}

async function insertHousehold(
  client: PoolClient,
  id: string,
  name: string,
  currency: string,
  zone: string,
  planningName: string,
  planningEmail: string,
  planningPassword: string,
  otherName: string,
  otherEmail: string,
  otherPassword: string,
): Promise<void> {
  void zone;
  await client.query(
    `INSERT INTO households (id, name, currency, planning_name, planning_email, planning_password_hash,
       other_name, other_email, other_password_hash, other_joined_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
    [id, name, currency, planningName, planningEmail, hashPassword(planningPassword),
      otherName, otherEmail, hashPassword(otherPassword)],
  );
}

async function insertSeedCost(
  client: PoolClient,
  hid: string,
  id: string,
  description: string,
  category: string,
  amountMinor: number,
  incurredAt: string,
  custodyDay: string,
  paidBy: 'planning' | 'other',
  versionId: string,
  planningBp: number,
  otherBp: number,
  state: string,
  sentAt: string,
  answerBy: string,
): Promise<void> {
  const sp = splitAmount(amountMinor, planningBp, paidBy);
  const sharePlanning = sp.planning;
  const shareOther = sp.other;
  const owedMinor = paidBy === 'planning' ? shareOther : sharePlanning;
  await client.query(
    `INSERT INTO costs (id, household_id, description, category, note, amount_minor, incurred_at, custody_day,
       paid_by, version_id, agreed_split_bp, split_planning_bp, split_other_bp, share_planning, share_other,
       owed_minor, state, sent_at, answer_by, answer_zone, answered_at, etag)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, hid, description, category, amountMinor, incurredAt, custodyDay, paidBy, versionId,
      planningBp, otherBp, sharePlanning, shareOther, owedMinor, state, sentAt, answerBy, 'UTC',
      state === 'accepted' || state === 'settled' ? sentAt : null, etagFor(id)],
  );
  await appendLog(client, hid, paidBy, 'cost.sent', id);
  if (state === 'accepted' || state === 'settled') {
    const answerer = paidBy === 'planning' ? 'other' : 'planning';
    await appendLog(client, hid, answerer, 'cost.accepted', id);
  }
  if (state === 'settled') {
    await appendLog(client, hid, paidBy, 'cost.settled', id);
  }
}

export function etagFor(id: string): string {
  return `"${createHash('sha256').update(id).digest('hex')}"`;
}
