import type { PoolClient } from 'pg';
import type {
  ConditionPhoto,
  EventKind,
  Exhibition,
  ExhibitionResponse,
  HangEvent,
  Lender,
  LoanObject,
  Placement,
  PlacementStatus,
  Role,
  Staff,
  Wall,
} from '../../shared/types';
import { withClient } from '../db/pool';
import { CLOSED_WEEKDAYS, openDays, openHours } from '../db/seed';
import { toIsoDate } from '../time';

type Row = Record<string, unknown>;

const text = (row: Row, key: string): string => String(row[key]);
const maybeText = (row: Row, key: string): string | null =>
  row[key] === null || row[key] === undefined ? null : String(row[key]);
const num = (row: Row, key: string): number => Number(row[key]);
const bool = (row: Row, key: string): boolean => row[key] === true;

export const placementSelect = `
  select p.id, p.object_id, p.wall_id, p.offset_mm, p.centre_height_mm, p.height_override,
         p.status, p.claimed_by, p.planned_lux, p.planned_lux_hours, p.lux_status, p.version,
         o.title as object_title, o.object_number, o.lender_id, o.width_mm, o.height_mm,
         o.lux_limit, o.lux_hour_budget,
         w.name as wall_name, w.sort as wall_sort,
         s.name as holder_name
  from placements p
  join loan_objects o on o.id = p.object_id
  join walls w on w.id = p.wall_id
  left join staff s on s.id = p.claimed_by
`;

export function rowToPlacement(row: Row): Placement {
  const holderId = maybeText(row, 'claimed_by');
  return {
    id: text(row, 'id'),
    objectId: text(row, 'object_id'),
    objectTitle: text(row, 'object_title'),
    objectNumber: text(row, 'object_number'),
    lenderId: maybeText(row, 'lender_id'),
    wallId: text(row, 'wall_id'),
    wallName: text(row, 'wall_name'),
    offsetMm: num(row, 'offset_mm'),
    centreHeightMm: num(row, 'centre_height_mm'),
    widthMm: num(row, 'width_mm'),
    heightMm: num(row, 'height_mm'),
    heightOverride: bool(row, 'height_override'),
    plannedLux: num(row, 'planned_lux'),
    plannedLuxHours: num(row, 'planned_lux_hours'),
    luxLimit: num(row, 'lux_limit'),
    luxHourBudget: num(row, 'lux_hour_budget'),
    luxStatus: text(row, 'lux_status') === 'over' ? 'over' : 'within',
    status: text(row, 'status') as PlacementStatus,
    claimedBy: holderId ? { id: holderId, name: text(row, 'holder_name') } : null,
    version: num(row, 'version'),
  };
}

export function rowToPhoto(row: Row): ConditionPhoto {
  return {
    id: text(row, 'id'),
    objectId: text(row, 'object_id'),
    key: text(row, 'key'),
    bytes: num(row, 'bytes'),
    sha256: text(row, 'sha256'),
    contentType: text(row, 'content_type'),
    attachedAt: new Date(String(row['attached_at'])).toISOString(),
  };
}

export function rowToWall(row: Row): Wall {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    lengthMm: num(row, 'length_mm'),
    heightMm: num(row, 'height_mm'),
    plannedLux: num(row, 'planned_lux'),
  };
}

export function rowToObject(row: Row): LoanObject {
  return {
    id: text(row, 'id'),
    objectNumber: text(row, 'object_number'),
    title: text(row, 'title'),
    medium: text(row, 'medium'),
    lenderId: maybeText(row, 'lender_id'),
    lenderName: maybeText(row, 'lender_name'),
    widthMm: num(row, 'width_mm'),
    heightMm: num(row, 'height_mm'),
    luxLimit: num(row, 'lux_limit'),
    luxHourBudget: num(row, 'lux_hour_budget'),
    insuranceValueGbp: num(row, 'insurance_value_gbp'),
    registrarNote: text(row, 'registrar_note'),
    conditionRecorded: num(row, 'photo_count') > 0,
    photos: Array.isArray(row['photos'])
      ? (row['photos'] as Row[]).map(rowToPhoto)
      : [],
    placementId: maybeText(row, 'placement_id'),
    placementStatus: (maybeText(row, 'placement_status') as PlacementStatus | null) ?? null,
  };
}

export const objectSelect = `
  select o.id, o.object_number, o.title, o.medium, o.lender_id, o.width_mm, o.height_mm,
         o.lux_limit, o.lux_hour_budget, o.insurance_value_gbp, o.registrar_note,
         l.name as lender_name,
         coalesce(l.name, 'Ashgrove collection') as lender_sort_name,
         (select count(*) from condition_photos c where c.object_id = o.id) as photo_count,
         coalesce((
           select json_agg(json_build_object(
             'id', c.id, 'object_id', c.object_id, 'key', c.key, 'bytes', c.bytes,
             'sha256', c.sha256, 'content_type', c.content_type, 'attached_at', c.attached_at
           ) order by c.attached_at, c.id)
           from condition_photos c where c.object_id = o.id
         ), '[]'::json) as photos,
         pl.id as placement_id, pl.status as placement_status
  from loan_objects o
  left join lenders l on l.id = o.lender_id
  left join placements pl on pl.object_id = o.id and pl.status <> 'removed'
`;

export async function getStaff(id: string): Promise<Staff | null> {
  const rows = await withClient(async (client) =>
    (await client.query('select id, name, role from staff where id = $1', [id])).rows,
  );
  const row = rows[0];
  if (!row) return null;
  return { id: text(row, 'id'), name: text(row, 'name'), role: text(row, 'role') as Role };
}

export async function listStaff(): Promise<Staff[]> {
  const rows = await withClient(
    async (client) => (await client.query('select id, name, role from staff order by sort')).rows,
  );
  return rows.map((row) => ({
    id: text(row, 'id'),
    name: text(row, 'name'),
    role: text(row, 'role') as Role,
  }));
}

export async function listLenders(client?: PoolClient): Promise<Lender[]> {
  const run = async (c: PoolClient): Promise<Row[]> =>
    (await c.query('select id, name, email from lenders order by sort')).rows;
  const rows = client ? await run(client) : await withClient(run);
  return rows.map((row) => ({
    id: text(row, 'id'),
    name: text(row, 'name'),
    email: text(row, 'email'),
  }));
}

export async function getExhibitionRow(client: PoolClient): Promise<Exhibition> {
  const row = (
    await client.query(
      `select id, title, museum, time_zone, run_start, run_end, open_hours_per_day
       from exhibitions limit 1`,
    )
  ).rows[0];
  if (!row) throw new Error('exhibition seed missing');
  return {
    id: text(row, 'id'),
    title: text(row, 'title'),
    museum: text(row, 'museum'),
    timeZone: text(row, 'time_zone'),
    runStart: toIsoDate(row['run_start'] as Date),
    runEnd: toIsoDate(row['run_end'] as Date),
    openHoursPerDay: num(row, 'open_hours_per_day'),
    closedWeekdays: CLOSED_WEEKDAYS,
    openDays,
    openHours,
  };
}

export async function getExhibition(): Promise<Exhibition> {
  return withClient(getExhibitionRow);
}

export async function getWalls(client?: PoolClient): Promise<Wall[]> {
  const run = async (c: PoolClient): Promise<Row[]> =>
    (
      await c.query(
        'select id, name, length_mm, height_mm, planned_lux from walls order by sort',
      )
    ).rows;
  const rows = client ? await run(client) : await withClient(run);
  return rows.map(rowToWall);
}

export async function getExhibitionResponse(): Promise<ExhibitionResponse> {
  return withClient(async (client) => {
    const exhibition = await getExhibitionRow(client);
    const galleryRow = (await client.query('select id, name from galleries limit 1')).rows[0];
    const walls = await getWalls(client);
    const lenders = await listLenders(client);
    return {
      exhibition,
      gallery: {
        id: galleryRow ? text(galleryRow, 'id') : '',
        name: galleryRow ? text(galleryRow, 'name') : '',
        walls,
      },
      lenders,
    };
  });
}

export async function getPlacementById(
  client: PoolClient,
  id: string,
  forUpdate = false,
): Promise<Placement | null> {
  if (forUpdate) {
    const locked = (
      await client.query('select id from placements where id = $1 for no key update', [id])
    ).rows;
    if (locked.length === 0) return null;
  }
  const rows = (await client.query(`${placementSelect} where p.id = $1`, [id])).rows;
  const row = rows[0];
  return row ? rowToPlacement(row) : null;
}

export async function listPlacements(client: PoolClient): Promise<Placement[]> {
  const rows = (
    await client.query(
      `${placementSelect} where p.status <> 'removed' order by w.sort, p.offset_mm, p.id`,
    )
  ).rows;
  return rows.map(rowToPlacement);
}

export async function listWallNeighbours(
  client: PoolClient,
  wallId: string,
  excludePlacementId: string | null,
): Promise<{ title: string; offsetMm: number; widthMm: number }[]> {
  const rows = (
    await client.query(
      `select o.title, p.offset_mm, o.width_mm
       from placements p join loan_objects o on o.id = p.object_id
       where p.wall_id = $1 and p.status <> 'removed' and ($2::text is null or p.id <> $2)
       order by p.offset_mm, p.id`,
      [wallId, excludePlacementId],
    )
  ).rows;
  return rows.map((row) => ({
    title: text(row, 'title'),
    offsetMm: num(row, 'offset_mm'),
    widthMm: num(row, 'width_mm'),
  }));
}

export function rowToEvent(row: Row): HangEvent {
  const actorId = maybeText(row, 'actor_id');
  return {
    seq: num(row, 'seq'),
    kind: text(row, 'kind') as EventKind,
    at: new Date(String(row['at'])).toISOString(),
    actor: actorId ? { id: actorId, name: text(row, 'actor_name') } : null,
    placementId: maybeText(row, 'placement_id'),
    objectId: maybeText(row, 'object_id'),
    wallId: maybeText(row, 'wall_id'),
    previewId: maybeText(row, 'preview_id'),
    title: maybeText(row, 'title'),
    wallName: maybeText(row, 'wall_name'),
    offsetMm: row['offset_mm'] === null ? null : num(row, 'offset_mm'),
    plannedLux: row['planned_lux'] === null ? null : num(row, 'planned_lux'),
    publishAtDisplay: maybeText(row, 'publish_at_display'),
    recipientCount: row['recipient_count'] === null ? null : num(row, 'recipient_count'),
  };
}

export async function countOverBudget(client: PoolClient): Promise<number> {
  const row = (
    await client.query(
      `select count(*) as total from placements where status <> 'removed' and lux_status = 'over'`,
    )
  ).rows[0];
  return row ? num(row, 'total') : 0;
}
