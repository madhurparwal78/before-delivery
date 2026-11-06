import pg from 'pg';
import { SCHEMA_SQL, SEED_SQL } from './db.js';
import type { DbClient } from './db.js';

export interface StaffRow { id: string; name: string; role: string }
export interface LenderRow { id: string; name: string; email: string }
export interface WallRow { id: string; name: string; lengthMm: number; heightMm: number; plannedLux: number }
export interface ExhibitionRow {
  id: string; title: string; museum: string; timeZone: string;
  runStart: string; runEnd: string; openHoursPerDay: number; closedWeekdays: number[];
}
export interface GalleryRow { id: string; name: string }

export interface ObjectRow {
  id: string; objectNumber: string; title: string; medium: string;
  lenderId: string | null; lenderName: string | null;
  widthMm: number; heightMm: number; luxLimit: number; luxHourBudget: number;
  insuranceValueGbp: number; registrarNote: string;
}

export interface PlacementRow {
  id: string; objectId: string; objectTitle: string; objectNumber: string;
  lenderId: string | null; wallId: string; wallName: string;
  offsetMm: number; centreHeightMm: number; heightOverride: boolean;
  widthMm: number; heightMm: number;
  plannedLux: number; plannedLuxHours: number; luxLimit: number; luxHourBudget: number;
  luxStatus: 'within' | 'over';
  status: 'proposed' | 'claimed' | 'hung' | 'signed_off' | 'removed';
  claimedBy: StaffRow | null; version: number;
  objectLuxLimit: number; objectLuxHourBudget: number;
  wallLengthMm: number; wallHeightMm: number;
}

export interface PhotoRow {
  id: string; objectId: string; key: string; bytes: number;
  sha256: string; contentType: string; attachedAt: string;
}

export interface EventRow {
  seq: number; kind: EventKind; at: string;
  actor: { id: string; name: string } | null;
  placementId: string | null; objectId: string | null; wallId: string | null;
  title: string | null; wallName: string | null; offsetMm: number | null;
  plannedLux: number | null; previewId: string | null;
  publishAtDisplay: string | null; recipientCount: number | null;
}

export type EventKind =
  | 'placement.placed' | 'placement.moved' | 'placement.removed' | 'placement.restored'
  | 'placement.claimed' | 'placement.released' | 'placement.hung' | 'placement.signed_off'
  | 'object.created' | 'object.updated' | 'photo.attached'
  | 'wall.lux_changed'
  | 'preview.scheduled' | 'preview.cancelled' | 'preview.published' | 'preview.withdrawn';

export interface UndoRow {
  actionId: string; kind: 'remove' | 'move';
  staffId: string; placementId: string;
  beforeWallId: string | null; beforeOffsetMm: number | null;
  beforeCentreHeightMm: number | null; beforeHeightOverride: boolean | null;
  beforeStatus: string | null; beforeClaimedBy: string | null;
  undoUntil: string; undone: boolean;
}

export interface PreviewRow {
  id: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'withdrawn';
  date: string | null; publishAt: string | null; scheduledAt: string | null;
  publishedAt: string | null; withdrawnAt: string | null;
  recipients: PreviewRecipientRow[];
}

export interface PreviewRecipientRow {
  lenderId: string; lenderName: string; email: string;
  token: string; delivery: 'queued' | 'sent' | 'cancelled'; sentAt: string | null;
}

export interface OpenHoursInfo { openHours: number; openDays: number }

const PLACEMENT_SELECT = `
  SELECT p.id, p.object_id, p.wall_id, p.offset_mm, p.centre_height_mm, p.height_override,
         p.status, p.claimed_by, p.version, w.name AS wall_name,
         o.title AS object_title, o.object_number, o.lender_id, o.width_mm, o.height_mm,
         o.lux_limit, o.lux_hour_budget, w.planned_lux, w.length_mm AS wall_length_mm, w.height_mm AS wall_height_mm,
         st.id AS claimer_id, st.name AS claimer_name
  FROM placements p
  JOIN walls w ON w.id = p.wall_id
  JOIN objects o ON o.id = p.object_id
  LEFT JOIN staff st ON st.id = p.claimed_by
`;

interface RawPlacement {
  id: string; object_id: string; wall_id: string; offset_mm: number; centre_height_mm: number;
  height_override: boolean; status: PlacementRow['status']; claimed_by: string | null; version: number;
  wall_name: string; object_title: string; object_number: string; lender_id: string | null;
  width_mm: number; height_mm: number; lux_limit: number; lux_hour_budget: number;
  planned_lux: number; wall_length_mm: number; wall_height_mm: number;
  claimer_id: string | null; claimer_name: string | null;
}

export class Store {
  constructor(private readonly pool: pg.Pool, private openHoursValue: number) {}

  setOpenHours(hours: number): void {
    this.openHoursValue = hours;
  }

  async query<T extends pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
    return this.pool.query(text, params);
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // connection already broken
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
    await this.pool.query(SEED_SQL);
  }

  async staff(): Promise<StaffRow[]> {
    const { rows } = await this.pool.query<StaffRow & pg.QueryResultRow>(
      'SELECT id, name, role FROM staff ORDER BY name'
    );
    return rows.map(toStaff);
  }

  async staffById(id: string): Promise<StaffRow | null> {
    const { rows } = await this.pool.query<StaffRow & pg.QueryResultRow>(
      'SELECT id, name, role FROM staff WHERE id = $1', [id]
    );
    return rows[0] ? toStaff(rows[0]) : null;
  }

  async lenders(): Promise<LenderRow[]> {
    const { rows } = await this.pool.query('SELECT id, name, email FROM lenders ORDER BY name');
    return rows as unknown as LenderRow[];
  }

  async lenderById(id: string): Promise<LenderRow | null> {
    const { rows } = await this.pool.query(
      'SELECT id, name, email FROM lenders WHERE id = $1', [id]
    );
    return (rows[0] as unknown as LenderRow) ?? null;
  }

  async exhibition(): Promise<ExhibitionRow> {
    const { rows } = await this.pool.query(
      'SELECT id, title, museum, time_zone, run_start, run_end, open_hours_per_day, closed_weekdays FROM exhibitions LIMIT 1'
    );
    const r = rows[0] as unknown as {
      id: string; title: string; museum: string; time_zone: string;
      run_start: Date; run_end: Date; open_hours_per_day: number; closed_weekdays: number[];
    };
    return {
      id: r.id, title: r.title, museum: r.museum, timeZone: r.time_zone,
      runStart: r.run_start.toISOString().slice(0, 10),
      runEnd: r.run_end.toISOString().slice(0, 10),
      openHoursPerDay: r.open_hours_per_day,
      closedWeekdays: r.closed_weekdays,
    };
  }

  async gallery(): Promise<GalleryRow> {
    const { rows } = await this.pool.query('SELECT id, name FROM galleries LIMIT 1');
    return rows[0] as unknown as GalleryRow;
  }

  async walls(): Promise<WallRow[]> {
    const { rows } = await this.pool.query(
      'SELECT id, name, length_mm, height_mm, planned_lux FROM walls ORDER BY sort_order'
    );
    return rows.map((r: pg.QueryResultRow) => ({
      id: r['id'] as string, name: r['name'] as string,
      lengthMm: Number(r['length_mm']), heightMm: Number(r['height_mm']),
      plannedLux: Number(r['planned_lux']),
    }));
  }

  async wallById(id: string): Promise<WallRow | null> {
    const { rows } = await this.pool.query(
      'SELECT id, name, length_mm, height_mm, planned_lux FROM walls WHERE id = $1', [id]
    );
    const r = rows[0];
    return r ? {
      id: r['id'] as string, name: r['name'] as string,
      lengthMm: Number(r['length_mm']), heightMm: Number(r['height_mm']),
      plannedLux: Number(r['planned_lux']),
    } : null;
  }

  async objects(filter: {
    q?: string; lender?: string; sort: 'number' | 'title' | 'lender' | 'lux'; dir: 'asc' | 'desc';
  }): Promise<ObjectRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.q !== undefined && filter.q !== '') {
      params.push(`%${filter.q.toLowerCase()}%`);
      conditions.push(`(LOWER(o.title) LIKE $${params.length} OR LOWER(o.object_number) LIKE $${params.length})`);
    }
    if (filter.lender === 'collection') {
      conditions.push('o.lender_id IS NULL');
    } else if (filter.lender !== undefined && filter.lender !== '') {
      params.push(filter.lender);
      conditions.push(`o.lender_id = $${params.length}`);
    }
    const dir = filter.dir === 'desc' ? 'DESC' : 'ASC';
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = {
      number: 'o.object_number',
      title: 'o.title',
      lender: 'l.name',
      lux: 'o.lux_limit',
    }[filter.sort];
    const { rows } = await this.pool.query(
      `SELECT o.*, l.name AS lender_name FROM objects o
       LEFT JOIN lenders l ON l.id = o.lender_id
       ${where}
       ORDER BY ${order} ${dir} NULLS LAST, o.object_number ASC`,
      params
    );
    return rows.map(toObject);
  }

  async objectById(id: string, client?: DbClient): Promise<ObjectRow | null> {
    const executor = client ?? this.pool;
    const { rows } = await executor.query(
      `SELECT o.*, l.name AS lender_name FROM objects o
       LEFT JOIN lenders l ON l.id = o.lender_id WHERE o.id = $1`, [id]
    );
    return rows[0] ? toObject(rows[0]) : null;
  }

  async objectByNumber(objectNumber: string): Promise<ObjectRow | null> {
    const { rows } = await this.pool.query(
      `SELECT o.*, l.name AS lender_name FROM objects o
       LEFT JOIN lenders l ON l.id = o.lender_id WHERE o.object_number = $1`, [objectNumber]
    );
    return rows[0] ? toObject(rows[0]) : null;
  }

  async photosFor(objectId: string, client?: DbClient): Promise<PhotoRow[]> {
    const executor = client ?? this.pool;
    const { rows } = await executor.query(
      `SELECT id, object_id, key, bytes, sha256, content_type, attached_at
       FROM photos WHERE object_id = $1 ORDER BY attached_at, id`, [objectId]
    );
    return rows.map(toPhoto);
  }

  async photoById(objectId: string, photoId: string): Promise<PhotoRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, object_id, key, bytes, sha256, content_type, attached_at
       FROM photos WHERE object_id = $1 AND id = $2`, [objectId, photoId]
    );
    return rows[0] ? toPhoto(rows[0]) : null;
  }

  /** Every non-removed placement with its server-computed lux figures. */
  async placements(): Promise<PlacementRow[]> {
    const { rows } = await this.pool.query(`${PLACEMENT_SELECT} WHERE p.status <> 'removed' ORDER BY w.sort_order, p.offset_mm`);
    return rows.map(toPlacement(this.openHoursValue));
  }

  async placementsOnWall(wallId: string, client?: DbClient): Promise<PlacementRow[]> {
    const executor = client ?? this.pool;
    const { rows } = await executor.query(`${PLACEMENT_SELECT} WHERE p.wall_id = $1 AND p.status <> 'removed' ORDER BY p.offset_mm`, [wallId]);
    return rows.map(toPlacement(this.openHoursValue));
  }

  async placementById(id: string, client?: DbClient): Promise<PlacementRow | null> {
    const executor = client ?? this.pool;
    const { rows } = await executor.query(`${PLACEMENT_SELECT} WHERE p.id = $1`, [id]);
    return rows[0] ? toPlacement(this.openHoursValue)(rows[0]) : null;
  }

  async activePlacementFor(objectId: string): Promise<PlacementRow | null> {
    const { rows } = await this.pool.query(`${PLACEMENT_SELECT} WHERE p.object_id = $1 AND p.status <> 'removed'`, [objectId]);
    return rows[0] ? toPlacement(this.openHoursValue)(rows[0]) : null;
  }

  async overBudgetCount(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM placements p
       JOIN walls w ON w.id = p.wall_id
       JOIN objects o ON o.id = p.object_id
       WHERE p.status <> 'removed' AND (w.planned_lux > o.lux_limit OR w.planned_lux * $1 > o.lux_hour_budget)`,
      [this.openHoursValue]
    );
    return Number((rows[0] as { n: number })['n']);
  }

  async events(after: number, limit: number): Promise<EventRow[]> {
    const { rows } = await this.pool.query(
      `SELECT e.seq, e.kind, e.at, e.actor_id, e.actor_name, e.placement_id, e.object_id,
              e.wall_id, e.title, e.wall_name, e.offset_mm, e.planned_lux, e.preview_id,
              e.publish_at_display, e.recipient_count
       FROM events e WHERE e.seq > $1 ORDER BY e.seq ASC LIMIT $2`, [after, limit]
    );
    return rows.map(toEvent);
  }

  async latestSeq(): Promise<number> {
    const { rows } = await this.pool.query('SELECT COALESCE(MAX(seq), 0) AS latest FROM events');
    return Number((rows[0] as { latest: string })['latest']);
  }

  async undoById(actionId: string): Promise<UndoRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM undo_actions WHERE action_id = $1', [actionId]);
    return rows[0] ? toUndo(rows[0]) : null;
  }

  async preview(): Promise<PreviewRow> {
    const { rows } = await this.pool.query(
      'SELECT * FROM previews ORDER BY scheduled_at DESC NULLS LAST, published_at DESC NULLS LAST LIMIT 1'
    );
    if (rows.length === 0) return { id: null, status: 'draft', date: null, publishAt: null, scheduledAt: null, publishedAt: null, withdrawnAt: null, recipients: [] };
    const r = rows[0] as unknown as {
      id: string; status: PreviewRow['status']; date: Date | null;
      publish_at: Date | null; scheduled_at: Date | null; published_at: Date | null; withdrawn_at: Date | null;
    };
    const recipients = await this.previewRecipients(r.id);
    return {
      id: r.id, status: r.status,
      date: r.date ? r.date.toISOString().slice(0, 10) : null,
      publishAt: r.publish_at ? r.publish_at.toISOString() : null,
      scheduledAt: r.scheduled_at ? r.scheduled_at.toISOString() : null,
      publishedAt: r.published_at ? r.published_at.toISOString() : null,
      withdrawnAt: r.withdrawn_at ? r.withdrawn_at.toISOString() : null,
      recipients,
    };
  }

  async previewRecipients(previewId: string): Promise<PreviewRecipientRow[]> {
    const { rows } = await this.pool.query(
      `SELECT pr.lender_id, l.name AS lender_name, l.email, pr.token, pr.delivery, pr.sent_at
       FROM preview_recipients pr JOIN lenders l ON l.id = pr.lender_id
       WHERE pr.preview_id = $1 ORDER BY l.name`, [previewId]
    );
    return rows.map((r: pg.QueryResultRow) => ({
      lenderId: r['lender_id'] as string,
      lenderName: r['lender_name'] as string,
      email: r['email'] as string,
      token: r['token'] as string,
      delivery: r['delivery'] as PreviewRecipientRow['delivery'],
      sentAt: r['sent_at'] ? (r['sent_at'] as Date).toISOString() : null,
    }));
  }
}

function toStaff(r: pg.QueryResultRow): StaffRow {
  return { id: r['id'] as string, name: r['name'] as string, role: r['role'] as string };
}

function toObject(r: pg.QueryResultRow): ObjectRow {
  return {
    id: r['id'] as string,
    objectNumber: r['object_number'] as string,
    title: r['title'] as string,
    medium: r['medium'] as string,
    lenderId: (r['lender_id'] as string | null) ?? null,
    lenderName: (r['lender_name'] as string | null) ?? null,
    widthMm: Number(r['width_mm']),
    heightMm: Number(r['height_mm']),
    luxLimit: Number(r['lux_limit']),
    luxHourBudget: Number(r['lux_hour_budget']),
    insuranceValueGbp: Number(r['insurance_value_gbp']),
    registrarNote: (r['registrar_note'] as string) ?? '',
  };
}

function toPhoto(r: pg.QueryResultRow): PhotoRow {
  return {
    id: r['id'] as string,
    objectId: r['object_id'] as string,
    key: r['key'] as string,
    bytes: Number(r['bytes']),
    sha256: r['sha256'] as string,
    contentType: r['content_type'] as string,
    attachedAt: (r['attached_at'] as Date).toISOString(),
  };
}

function toPlacement(openHours: number): (r: pg.QueryResultRow) => PlacementRow {
  return (r: pg.QueryResultRow): PlacementRow => {
    const raw = r as unknown as RawPlacement;
    const plannedLux = raw.planned_lux;
    const plannedLuxHours = plannedLux * openHours;
    const luxStatus: 'within' | 'over' =
      plannedLux > raw.lux_limit || plannedLuxHours > Number(raw.lux_hour_budget) ? 'over' : 'within';
    return {
      id: raw.id, objectId: raw.object_id, objectTitle: raw.object_title,
      objectNumber: raw.object_number, lenderId: raw.lender_id,
      wallId: raw.wall_id, wallName: raw.wall_name,
      offsetMm: raw.offset_mm, centreHeightMm: raw.centre_height_mm,
      heightOverride: raw.height_override,
      widthMm: raw.width_mm, heightMm: raw.height_mm,
      plannedLux, plannedLuxHours,
      luxLimit: raw.lux_limit, luxHourBudget: Number(raw.lux_hour_budget),
      luxStatus,
      status: raw.status,
      claimedBy: raw.claimer_id ? { id: raw.claimer_id, name: raw.claimer_name ?? '', role: '' } : null,
      version: raw.version,
      objectLuxLimit: raw.lux_limit,
      objectLuxHourBudget: Number(raw.lux_hour_budget),
      wallLengthMm: Number(raw.wall_length_mm),
      wallHeightMm: Number(raw.wall_height_mm),
    };
  };
}

function toEvent(r: pg.QueryResultRow): EventRow {
  const actorId = (r['actor_id'] as string | null) ?? null;
  return {
    seq: Number(r['seq']), kind: r['kind'] as EventKind,
    at: (r['at'] as Date).toISOString(),
    actor: actorId ? { id: actorId, name: r['actor_name'] as string } : null,
    placementId: (r['placement_id'] as string | null) ?? null,
    objectId: (r['object_id'] as string | null) ?? null,
    wallId: (r['wall_id'] as string | null) ?? null,
    title: (r['title'] as string | null) ?? null,
    wallName: (r['wall_name'] as string | null) ?? null,
    offsetMm: r['offset_mm'] === null ? null : Number(r['offset_mm']),
    plannedLux: r['planned_lux'] === null ? null : Number(r['planned_lux']),
    previewId: (r['preview_id'] as string | null) ?? null,
    publishAtDisplay: (r['publish_at_display'] as string | null) ?? null,
    recipientCount: r['recipient_count'] === null ? null : Number(r['recipient_count']),
  };
}

function toUndo(r: pg.QueryResultRow): UndoRow {
  return {
    actionId: r['action_id'] as string,
    kind: r['kind'] as UndoRow['kind'],
    staffId: r['staff_id'] as string,
    placementId: r['placement_id'] as string,
    beforeWallId: (r['before_wall_id'] as string | null) ?? null,
    beforeOffsetMm: r['before_offset_mm'] === null ? null : Number(r['before_offset_mm']),
    beforeCentreHeightMm: r['before_centre_height_mm'] === null ? null : Number(r['before_centre_height_mm']),
    beforeHeightOverride: (r['before_height_override'] as boolean | null) ?? null,
    beforeStatus: (r['before_status'] as string | null) ?? null,
    beforeClaimedBy: (r['before_claimed_by'] as string | null) ?? null,
    undoUntil: (r['undo_until'] as Date).toISOString(),
    undone: Boolean(r['undone']),
  };
}
