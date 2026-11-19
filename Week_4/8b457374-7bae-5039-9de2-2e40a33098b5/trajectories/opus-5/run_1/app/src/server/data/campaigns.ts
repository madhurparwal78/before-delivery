import type { CampaignStatus } from '../../shared/types.js';
import { COUNTING_STATES_SQL } from '../domain/transitions.js';
import type { Db } from './db.js';

export interface StretchPoint {
  copies: number;
  amount: number;
}

export interface CampaignRow {
  id: string;
  creator_id: string;
  title: string;
  story: string;
  status: CampaignStatus;
  goal: number;
  min_run_copies: number;
  stretch: StretchPoint[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: Date;
  created_at: Date;
  launched_at: Date | null;
  closed_at: Date | null;
  settled_at: Date | null;
}

export interface CampaignTotals {
  total: number;
  captured_total: number;
  backer_count: number;
}

const COLUMNS = `id, creator_id, title, story, status, goal, min_run_copies, stretch,
  ships_from, time_zone, deadline_local, deadline_utc, created_at, launched_at, closed_at, settled_at`;

export interface CampaignDraftFields {
  title: string;
  story: string;
  goal: number;
  min_run_copies: number;
  stretch: StretchPoint[];
  ships_from: string;
  time_zone: string;
  deadline_local: string;
  deadline_utc: Date;
}

export async function insertCampaign(
  db: Db,
  id: string,
  creatorId: string,
  fields: CampaignDraftFields,
): Promise<CampaignRow> {
  const result = await db.query<CampaignRow>(
    `insert into campaigns (id, creator_id, title, story, status, goal, min_run_copies, stretch,
       ships_from, time_zone, deadline_local, deadline_utc)
     values ($1, $2, $3, $4, 'draft', $5, $6, $7::jsonb, $8, $9, $10, $11)
     returning ${COLUMNS}`,
    [
      id,
      creatorId,
      fields.title,
      fields.story,
      fields.goal,
      fields.min_run_copies,
      JSON.stringify(fields.stretch),
      fields.ships_from,
      fields.time_zone,
      fields.deadline_local,
      fields.deadline_utc,
    ],
  );
  return result.rows[0] as CampaignRow;
}

export async function updateCampaignFields(
  db: Db,
  id: string,
  fields: CampaignDraftFields,
): Promise<CampaignRow> {
  const result = await db.query<CampaignRow>(
    `update campaigns set title = $2, story = $3, goal = $4, min_run_copies = $5,
       stretch = $6::jsonb, ships_from = $7, time_zone = $8, deadline_local = $9, deadline_utc = $10
     where id = $1 returning ${COLUMNS}`,
    [
      id,
      fields.title,
      fields.story,
      fields.goal,
      fields.min_run_copies,
      JSON.stringify(fields.stretch),
      fields.ships_from,
      fields.time_zone,
      fields.deadline_local,
      fields.deadline_utc,
    ],
  );
  return result.rows[0] as CampaignRow;
}

export async function findCampaign(db: Db, id: string): Promise<CampaignRow | null> {
  const result = await db.query<CampaignRow>(`select ${COLUMNS} from campaigns where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listPublicCampaigns(db: Db): Promise<CampaignRow[]> {
  const result = await db.query<CampaignRow>(
    `select ${COLUMNS} from campaigns where status <> 'draft'
     order by (status = 'live') desc,
       case when status = 'live' then deadline_utc end asc,
       case when status <> 'live' then deadline_utc end desc`,
  );
  return result.rows;
}

export async function listCampaignsByCreator(db: Db, creatorId: string): Promise<CampaignRow[]> {
  const result = await db.query<CampaignRow>(
    `select ${COLUMNS} from campaigns where creator_id = $1 order by created_at desc`,
    [creatorId],
  );
  return result.rows;
}

export async function setCampaignStatus(
  db: Db,
  id: string,
  status: CampaignStatus,
  stamp: 'launched_at' | 'closed_at' | 'settled_at' | null,
): Promise<void> {
  const column = stamp === null ? '' : `, ${stamp} = now()`;
  await db.query(`update campaigns set status = $2${column} where id = $1`, [id, status]);
}

export async function campaignTotals(db: Db, id: string): Promise<CampaignTotals> {
  const result = await db.query<{ total: number; captured_total: number; backer_count: number }>(
    `select
       coalesce(sum(amount) filter (where state in (${COUNTING_STATES_SQL})), 0) as total,
       coalesce(sum(amount) filter (where state = 'captured'), 0) as captured_total,
       count(*) filter (where state in (${COUNTING_STATES_SQL})) as backer_count
     from pledges where campaign_id = $1`,
    [id],
  );
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    captured_total: Number(row?.captured_total ?? 0),
    backer_count: Number(row?.backer_count ?? 0),
  };
}

export async function totalsForCampaigns(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, CampaignTotals>> {
  const map = new Map<string, CampaignTotals>();
  if (ids.length === 0) return map;
  const result = await db.query<{
    campaign_id: string;
    total: number;
    captured_total: number;
    backer_count: number;
  }>(
    `select campaign_id,
       coalesce(sum(amount) filter (where state in (${COUNTING_STATES_SQL})), 0) as total,
       coalesce(sum(amount) filter (where state = 'captured'), 0) as captured_total,
       count(*) filter (where state in (${COUNTING_STATES_SQL})) as backer_count
     from pledges where campaign_id = any($1::text[]) group by campaign_id`,
    [[...ids]],
  );
  for (const id of ids) map.set(id, { total: 0, captured_total: 0, backer_count: 0 });
  for (const row of result.rows) {
    map.set(row.campaign_id, {
      total: Number(row.total),
      captured_total: Number(row.captured_total),
      backer_count: Number(row.backer_count),
    });
  }
  return map;
}

export async function listCampaignsPastDeadline(db: Db): Promise<CampaignRow[]> {
  const result = await db.query<CampaignRow>(
    `select ${COLUMNS} from campaigns where status = 'live' and deadline_utc <= now()`,
  );
  return result.rows;
}

export async function listCampaignsInStatus(
  db: Db,
  statuses: readonly CampaignStatus[],
): Promise<CampaignRow[]> {
  const result = await db.query<CampaignRow>(
    `select ${COLUMNS} from campaigns where status = any($1::text[])`,
    [[...statuses]],
  );
  return result.rows;
}
