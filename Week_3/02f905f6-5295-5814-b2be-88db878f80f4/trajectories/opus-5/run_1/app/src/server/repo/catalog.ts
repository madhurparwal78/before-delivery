import type { Clay, Cone, Kiln, KilnProfile, Post, ProfileSegment, RateSet, Stage } from '../../shared/types';
import { query, queryOne } from '../db/pool';
import { firingHoursString } from '../domain/schedule';
import { SHELF_POSTS } from '../../shared/placement';
import { halfUnitsToInches, HALF_UNITS_PER_INCH } from '../domain/measure';
import type { RateSetDraft } from '../domain/fee';

interface ClayRow {
  id: string;
  name: string;
  max_cone: Cone;
}

interface KilnRow {
  id: string;
  name: string;
  shelf_diameter_in: string;
  layers: number;
  post_height_in: string;
  usable_cubic_inches: number;
}

interface ProfileRow {
  id: string;
  kiln_id: string;
  name: string;
  stage: Stage;
  cone: Cone;
  segments: ProfileSegment[];
  cool_down_hours: number;
}

interface RateSetRow {
  id: number;
  bisque_rate: string;
  glaze_rate: string;
  member_discount_percent: number;
  order_minimum_cents: number;
  effective_date: Date | string;
  created_at: Date;
}

export async function listClays(): Promise<Clay[]> {
  const rows = await query<ClayRow>('select id, name, max_cone from clays order by sort, name');
  return rows.map((row) => ({ id: row.id, name: row.name, max_cone: row.max_cone }));
}

export async function findClay(id: unknown): Promise<Clay | null> {
  if (typeof id !== 'string') return null;
  const row = await queryOne<ClayRow>('select id, name, max_cone from clays where id = $1', [id]);
  return row ? { id: row.id, name: row.name, max_cone: row.max_cone } : null;
}

export const shelfPosts = (): Post[] =>
  SHELF_POSTS.map((post) => ({
    x: halfUnitsToInches(post.x),
    y: halfUnitsToInches(post.y),
    size_in: halfUnitsToInches(post.size),
  }));

function toProfile(row: ProfileRow): KilnProfile {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    cone: row.cone,
    segments: row.segments,
    cool_down_hours: row.cool_down_hours,
    firing_hours: firingHoursString(row.segments),
  };
}

export interface KilnRecord extends Kiln {
  /** Post height in half-inch units, for the placement rules. */
  postHeightHalfUnits: number;
}

export async function listKilns(): Promise<KilnRecord[]> {
  const kilns = await query<KilnRow>('select * from kilns order by sort, name');
  const profiles = await query<ProfileRow>('select * from kiln_profiles order by sort, name');
  const open = await query<{ id: string; kiln_id: string }>(
    'select id, kiln_id from firings where unloaded_at is null',
  );
  return kilns.map((kiln) => ({
    id: kiln.id,
    name: kiln.name,
    shelf_diameter_in: kiln.shelf_diameter_in,
    layers: kiln.layers,
    post_height_in: kiln.post_height_in,
    usable_cubic_inches: kiln.usable_cubic_inches,
    posts: shelfPosts(),
    profiles: profiles.filter((profile) => profile.kiln_id === kiln.id).map(toProfile),
    current_firing_id: open.find((firing) => firing.kiln_id === kiln.id)?.id ?? null,
    postHeightHalfUnits: Math.round(Number(kiln.post_height_in) * HALF_UNITS_PER_INCH),
  }));
}

export async function findKiln(id: unknown): Promise<KilnRecord | null> {
  if (typeof id !== 'string') return null;
  const kilns = await listKilns();
  return kilns.find((kiln) => kiln.id === id) ?? null;
}

export async function findProfile(kilnId: string, profileId: unknown): Promise<KilnProfile | null> {
  if (typeof profileId !== 'string') return null;
  const row = await queryOne<ProfileRow>(
    'select * from kiln_profiles where id = $1 and kiln_id = $2',
    [profileId, kilnId],
  );
  return row ? toProfile(row) : null;
}

export async function saveProfile(args: {
  profileId: string;
  kilnId: string;
  segments: ProfileSegment[];
  coolDownHours: number;
}): Promise<KilnProfile | null> {
  const row = await queryOne<ProfileRow>(
    `update kiln_profiles set segments = $1::jsonb, cool_down_hours = $2
     where id = $3 and kiln_id = $4 returning *`,
    [JSON.stringify(args.segments), args.coolDownHours, args.profileId, args.kilnId],
  );
  return row ? toProfile(row) : null;
}

/** The tallest piece any seeded kiln can take, in half-inch units. */
export async function maxPieceHeightHalfUnits(): Promise<number> {
  const row = await queryOne<{ tallest: string | null }>(
    'select max(post_height_in) as tallest from kilns',
  );
  const tallest = Number(row?.tallest ?? 0);
  return Math.round((tallest - 1) * HALF_UNITS_PER_INCH);
}

function toRateSet(row: RateSetRow): RateSet {
  const effective =
    row.effective_date instanceof Date
      ? row.effective_date.toISOString().slice(0, 10)
      : String(row.effective_date).slice(0, 10);
  return {
    id: row.id,
    bisque_rate: row.bisque_rate,
    glaze_rate: row.glaze_rate,
    member_discount_percent: row.member_discount_percent,
    order_minimum_cents: row.order_minimum_cents,
    effective_date: effective,
    created_at: row.created_at.toISOString(),
  };
}

export async function listRateSets(): Promise<RateSet[]> {
  const rows = await query<RateSetRow>(
    'select * from rate_sets order by effective_date desc, id desc',
  );
  return rows.map(toRateSet);
}

/** The rate set in force on a studio date: the newest already in effect. */
export async function rateSetFor(studioDate: string): Promise<RateSet | null> {
  const row = await queryOne<RateSetRow>(
    `select * from rate_sets where effective_date <= $1::date
     order by effective_date desc, id desc limit 1`,
    [studioDate],
  );
  return row ? toRateSet(row) : null;
}

export async function createRateSet(draft: RateSetDraft): Promise<RateSet | 'date_taken'> {
  const row = await queryOne<RateSetRow>(
    `insert into rate_sets
       (bisque_rate, glaze_rate, member_discount_percent, order_minimum_cents, effective_date)
     values ($1, $2, $3, $4, $5::date)
     on conflict (effective_date) do nothing
     returning *`,
    [
      draft.bisque_rate,
      draft.glaze_rate,
      draft.member_discount_percent,
      draft.order_minimum_cents,
      draft.effective_date,
    ],
  );
  return row ? toRateSet(row) : 'date_taken';
}
