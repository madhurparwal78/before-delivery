import type { Zone } from '../../shared/countries.js';
import type { PledgeState } from '../../shared/types.js';
import { CLAIMING_STATES_SQL } from '../domain/transitions.js';
import type { Db } from './db.js';

export interface PledgeRow {
  id: string;
  campaign_id: string;
  backer_id: string;
  tier_id: string;
  country: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  state: PledgeState;
  card_last4: string | null;
  replaces: string | null;
  killbill_payment_id: string | null;
  platform_fee: number | null;
  processing_fee: number | null;
  to_creator: number | null;
  fix_code: string | null;
  fix_deadline_utc: Date | null;
  fix_attempt: number;
  fix_payment_id: string | null;
  card_fixed: boolean | null;
  card_captures: boolean;
  fix_notices_sent: number;
  errored_at: Date | null;
  captured_at: Date | null;
  created_at: Date;
}

export interface PledgeHistoryEntry {
  state: PledgeState;
  at: Date;
}

const COLUMNS = `id, campaign_id, backer_id, tier_id, country, zone, reward, shipping, add_on,
  amount, state, card_last4, replaces, killbill_payment_id, platform_fee, processing_fee,
  to_creator, fix_code, fix_deadline_utc, fix_attempt, fix_payment_id, card_fixed,
  card_captures, fix_notices_sent, errored_at, captured_at, created_at`;

export interface NewPledge {
  id: string;
  campaign_id: string;
  backer_id: string;
  tier_id: string;
  country: string;
  zone: Zone;
  reward: number;
  shipping: number;
  add_on: number;
  amount: number;
  card_last4: string;
  card_captures: boolean;
  replaces: string | null;
}

/** A claim takes its copy here, in state authorising, before any Kill Bill call. */
export async function insertPledge(db: Db, pledge: NewPledge): Promise<PledgeRow> {
  const result = await db.query<PledgeRow>(
    `insert into pledges (id, campaign_id, backer_id, tier_id, country, zone, reward, shipping,
       add_on, amount, state, card_last4, card_captures, replaces)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'authorising', $11, $12, $13)
     returning ${COLUMNS}`,
    [
      pledge.id,
      pledge.campaign_id,
      pledge.backer_id,
      pledge.tier_id,
      pledge.country,
      pledge.zone,
      pledge.reward,
      pledge.shipping,
      pledge.add_on,
      pledge.amount,
      pledge.card_last4,
      pledge.card_captures,
      pledge.replaces,
    ],
  );
  await appendHistory(db, pledge.id, 'authorising');
  return result.rows[0] as PledgeRow;
}

async function appendHistory(db: Db, pledgeId: string, state: PledgeState): Promise<void> {
  await db.query('insert into pledge_history (pledge_id, state) values ($1, $2)', [
    pledgeId,
    state,
  ]);
}

/** The one place a pledge state change is written; every change appends to history. */
export async function movePledge(
  db: Db,
  id: string,
  state: PledgeState,
  extra: Partial<{
    killbill_payment_id: string;
    platform_fee: number;
    processing_fee: number;
    to_creator: number;
    fix_code: string;
    fix_deadline_utc: Date;
    card_fixed: boolean;
  }> = {},
): Promise<PledgeRow> {
  const sets: string[] = ['state = $2', 'updated_at = now()'];
  const values: unknown[] = [id, state];
  const push = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (extra.killbill_payment_id !== undefined)
    push('killbill_payment_id', extra.killbill_payment_id);
  if (extra.platform_fee !== undefined) push('platform_fee', extra.platform_fee);
  if (extra.processing_fee !== undefined) push('processing_fee', extra.processing_fee);
  if (extra.to_creator !== undefined) push('to_creator', extra.to_creator);
  if (extra.fix_code !== undefined) push('fix_code', extra.fix_code);
  if (extra.fix_deadline_utc !== undefined) push('fix_deadline_utc', extra.fix_deadline_utc);
  if (extra.card_fixed !== undefined) push('card_fixed', extra.card_fixed);
  if (state === 'captured') sets.push('captured_at = now()');
  if (state === 'errored') sets.push('errored_at = now()');

  const result = await db.query<PledgeRow>(
    `update pledges set ${sets.join(', ')} where id = $1 returning ${COLUMNS}`,
    values,
  );
  await appendHistory(db, id, state);
  return result.rows[0] as PledgeRow;
}

/** A decline or Kill Bill failure while authorising removes the attempt entirely. */
export async function deletePledge(db: Db, id: string): Promise<void> {
  await db.query('delete from pledges where id = $1', [id]);
}

export async function setPledgePayment(db: Db, id: string, paymentId: string): Promise<void> {
  await db.query('update pledges set killbill_payment_id = $2, updated_at = now() where id = $1', [
    id,
    paymentId,
  ]);
}

export async function recordFixHold(
  db: Db,
  id: string,
  attempt: number,
  paymentId: string,
): Promise<void> {
  await db.query(
    `update pledges set fix_attempt = $2, fix_payment_id = $3, card_fixed = true,
       updated_at = now() where id = $1`,
    [id, attempt, paymentId],
  );
}

export async function setFixCard(
  db: Db,
  id: string,
  last4: string,
  captures: boolean,
): Promise<void> {
  await db.query(
    'update pledges set card_last4 = $2, card_captures = $3, updated_at = now() where id = $1',
    [id, last4, captures],
  );
}

export async function bumpFixNotices(db: Db, id: string, sent: number): Promise<void> {
  await db.query('update pledges set fix_notices_sent = $2 where id = $1', [id, sent]);
}

export async function findPledge(db: Db, id: string): Promise<PledgeRow | null> {
  const result = await db.query<PledgeRow>(`select ${COLUMNS} from pledges where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function findPledgeByFixCode(db: Db, code: string): Promise<PledgeRow | null> {
  const result = await db.query<PledgeRow>(`select ${COLUMNS} from pledges where fix_code = $1`, [
    code,
  ]);
  return result.rows[0] ?? null;
}

export async function findActivePledge(
  db: Db,
  campaignId: string,
  backerId: string,
): Promise<PledgeRow | null> {
  const result = await db.query<PledgeRow>(
    `select ${COLUMNS} from pledges where campaign_id = $1 and backer_id = $2
       and state in (${CLAIMING_STATES_SQL})`,
    [campaignId, backerId],
  );
  return result.rows[0] ?? null;
}

export async function findAuthorisedPledge(
  db: Db,
  campaignId: string,
  backerId: string,
): Promise<PledgeRow | null> {
  const result = await db.query<PledgeRow>(
    `select ${COLUMNS} from pledges where campaign_id = $1 and backer_id = $2 and state = 'authorised'`,
    [campaignId, backerId],
  );
  return result.rows[0] ?? null;
}

export async function listPledgesByCampaign(
  db: Db,
  campaignId: string,
  states?: readonly PledgeState[],
): Promise<PledgeRow[]> {
  const filter = states === undefined ? '' : ' and state = any($2::text[])';
  const values: unknown[] = states === undefined ? [campaignId] : [campaignId, [...states]];
  const result = await db.query<PledgeRow>(
    `select ${COLUMNS} from pledges where campaign_id = $1${filter} order by created_at`,
    values,
  );
  return result.rows;
}

export async function listPledgesByBacker(db: Db, backerId: string): Promise<PledgeRow[]> {
  const result = await db.query<PledgeRow>(
    `select ${COLUMNS} from pledges where backer_id = $1 order by created_at desc`,
    [backerId],
  );
  return result.rows;
}

export async function listErroredPledges(db: Db): Promise<PledgeRow[]> {
  const result = await db.query<PledgeRow>(
    `select ${COLUMNS} from pledges where state = 'errored'`,
  );
  return result.rows;
}

export async function historyFor(
  db: Db,
  pledgeIds: readonly string[],
): Promise<Map<string, PledgeHistoryEntry[]>> {
  const map = new Map<string, PledgeHistoryEntry[]>();
  if (pledgeIds.length === 0) return map;
  const result = await db.query<{ pledge_id: string; state: PledgeState; at: Date }>(
    `select pledge_id, state, at from pledge_history
     where pledge_id = any($1::text[]) order by id`,
    [[...pledgeIds]],
  );
  for (const id of pledgeIds) map.set(id, []);
  for (const row of result.rows) {
    map.get(row.pledge_id)?.push({ state: row.state, at: row.at });
  }
  return map;
}
