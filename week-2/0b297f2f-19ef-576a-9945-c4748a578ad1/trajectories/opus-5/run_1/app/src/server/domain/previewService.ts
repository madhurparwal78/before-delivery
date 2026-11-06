import type { PoolClient } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { fieldMessages } from '../../shared/copy';
import type {
  DeliveryState,
  Preview,
  PreviewRecipient,
  PreviewStatus,
  Snapshot,
  Staff,
} from '../../shared/types';
import { config } from '../config';
import { withClient, withTransaction } from '../db/pool';
import { errors } from '../http/errors';
import { putObject } from '../services/imageStore';
import { Raster, type Rgb } from '../services/png';
import { formatMuseumDisplay, isoDateParts, zonedTimeToInstant } from '../time';
import { writeEvent } from './events';
import { getExhibitionRow, getWalls, listLenders } from './repository';
import { assertRole } from './transitions';

type Row = Record<string, unknown>;

interface PreviewRow {
  id: string;
  status: PreviewStatus;
  date: Date | null;
  publish_at: Date | null;
  published_at: Date | null;
  withdrawn_at: Date | null;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function currentPreviewRow(client: PoolClient, forUpdate = false): Promise<PreviewRow | null> {
  const rows = (
    await client.query(
      `select id, status, date, publish_at, published_at, withdrawn_at
       from previews order by sort desc limit 1${forUpdate ? ' for update' : ''}`,
    )
  ).rows as PreviewRow[];
  return rows[0] ?? null;
}

async function recipientsOf(client: PoolClient, previewId: string): Promise<PreviewRecipient[]> {
  const rows = (
    await client.query(
      `select r.lender_id, l.name as lender_name, l.email, r.delivery, r.sent_at
       from preview_recipients r join lenders l on l.id = r.lender_id
       where r.preview_id = $1 order by l.sort`,
      [previewId],
    )
  ).rows as Row[];
  return rows.map((row) => ({
    lenderId: String(row['lender_id']),
    lenderName: String(row['lender_name']),
    email: String(row['email']),
    delivery: String(row['delivery']) as DeliveryState,
    sentAt: row['sent_at'] === null ? null : new Date(String(row['sent_at'])).toISOString(),
  }));
}

async function toPreview(client: PoolClient, row: PreviewRow | null): Promise<Preview> {
  if (!row) {
    return {
      id: null,
      status: 'draft',
      date: null,
      publishAt: null,
      publishAtDisplay: null,
      remainingMs: null,
      publishedAt: null,
      publishedAtDisplay: null,
      withdrawnAt: null,
      withdrawnAtDisplay: null,
      recipients: [],
    };
  }
  const exhibition = await getExhibitionRow(client);
  const zone = exhibition.timeZone;
  const publishAt = row.publish_at ? new Date(row.publish_at) : null;
  const publishedAt = row.published_at ? new Date(row.published_at) : null;
  const withdrawnAt = row.withdrawn_at ? new Date(row.withdrawn_at) : null;
  return {
    id: row.id,
    status: row.status,
    date: row.date ? new Date(row.date).toISOString().slice(0, 10) : null,
    publishAt: publishAt ? publishAt.toISOString() : null,
    publishAtDisplay: publishAt ? formatMuseumDisplay(publishAt, zone) : null,
    remainingMs:
      row.status === 'scheduled' && publishAt
        ? Math.max(0, publishAt.getTime() - Date.now())
        : null,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    publishedAtDisplay: publishedAt ? formatMuseumDisplay(publishedAt, zone) : null,
    withdrawnAt: withdrawnAt ? withdrawnAt.toISOString() : null,
    withdrawnAtDisplay: withdrawnAt ? formatMuseumDisplay(withdrawnAt, zone) : null,
    recipients: await recipientsOf(client, row.id),
  };
}

export async function getPreview(): Promise<Preview> {
  return withClient(async (client) => toPreview(client, await currentPreviewRow(client)));
}

/** The publish time: 09:00 museum time on the chosen date, or the configured test delay. */
function resolvePublishAt(
  date: string,
  timeZone: string,
): { publishAt: Date } | { field: string } {
  const parts = isoDateParts(date);
  if (!parts) return { field: fieldMessages.dateFormat };
  if (config.previewPublishDelaySeconds !== null) {
    return { publishAt: new Date(Date.now() + config.previewPublishDelaySeconds * 1000) };
  }
  const publishAt = zonedTimeToInstant(parts.year, parts.month, parts.day, 9, 0, timeZone);
  if (publishAt.getTime() - Date.now() < TWO_HOURS_MS) {
    return { field: fieldMessages.dateTooSoon };
  }
  return { publishAt };
}

export async function schedulePreview(
  staff: Staff,
  date: unknown,
): Promise<{ preview: Preview; seq: number }> {
  assertRole(staff, 'curator');
  return withTransaction(async (client) => {
    const exhibition = await getExhibitionRow(client);
    const current = await currentPreviewRow(client, true);
    if (current && current.status !== 'draft' && current.status !== 'withdrawn') {
      throw errors.conflict('preview_conflict', 'The preview cannot be scheduled in this state.');
    }
    if (typeof date !== 'string') {
      throw errors.validationFailed({ date: fieldMessages.dateFormat });
    }
    const resolved = resolvePublishAt(date, exhibition.timeZone);
    if ('field' in resolved) throw errors.validationFailed({ date: resolved.field });

    let previewId: string;
    if (current && current.status === 'draft') {
      previewId = current.id;
      await client.query(
        `update previews set status = 'scheduled', date = $2, publish_at = $3,
           published_at = null, withdrawn_at = null where id = $1`,
        [previewId, date, resolved.publishAt.toISOString()],
      );
    } else {
      previewId = `prev-${randomUUID()}`;
      await client.query(
        `insert into previews (id, exhibition_id, status, date, publish_at)
         values ($1, $2, 'scheduled', $3, $4)`,
        [previewId, exhibition.id, date, resolved.publishAt.toISOString()],
      );
    }
    const publishAtDisplay = formatMuseumDisplay(resolved.publishAt, exhibition.timeZone);
    const seq = await writeEvent(client, {
      kind: 'preview.scheduled',
      actorId: staff.id,
      previewId,
      publishAtDisplay,
    });
    const preview = await toPreview(client, await currentPreviewRow(client));
    return { preview, seq };
  });
}

export async function cancelPreviewSchedule(
  staff: Staff,
): Promise<{ preview: Preview; seq: number }> {
  assertRole(staff, 'curator');
  return withTransaction(async (client) => {
    const current = await currentPreviewRow(client, true);
    if (!current || current.status !== 'scheduled') {
      throw errors.conflict('preview_conflict', 'There is no scheduled preview to cancel.');
    }
    await client.query(
      `update previews set status = 'draft', date = null, publish_at = null where id = $1`,
      [current.id],
    );
    const seq = await writeEvent(client, {
      kind: 'preview.cancelled',
      actorId: staff.id,
      previewId: current.id,
    });
    return { preview: await toPreview(client, await currentPreviewRow(client)), seq };
  });
}

export async function withdrawPreview(staff: Staff): Promise<{ preview: Preview; seq: number }> {
  assertRole(staff, 'curator');
  return withTransaction(async (client) => {
    const current = await currentPreviewRow(client, true);
    if (!current || current.status !== 'published') {
      throw errors.conflict('preview_conflict', 'There is no published preview to withdraw.');
    }
    await client.query(`update previews set status = 'withdrawn', withdrawn_at = now() where id = $1`, [
      current.id,
    ]);
    await client.query(
      `update preview_recipients set delivery = 'cancelled' where preview_id = $1 and delivery = 'queued'`,
      [current.id],
    );
    await client.query(
      `update preview_recipients set notice_pending = true where preview_id = $1 and delivery = 'sent'`,
      [current.id],
    );
    const seq = await writeEvent(client, {
      kind: 'preview.withdrawn',
      actorId: staff.id,
      previewId: current.id,
    });
    return { preview: await toPreview(client, await currentPreviewRow(client)), seq };
  });
}

const PLASTER: Rgb = [245, 241, 234];
const INK: Rgb = [26, 24, 22];
const STONE: Rgb = [196, 188, 176];
const ACCENT: Rgb = [194, 91, 32];

function drawSnapshotPng(snapshot: Snapshot): Buffer {
  const scale = 0.075;
  const margin = 40;
  const bandGap = 44;
  const bandHeights = snapshot.walls.map((wall) => Math.round(wall.heightMm * scale));
  const width = Math.round(
    margin * 2 + Math.max(...snapshot.walls.map((wall) => wall.lengthMm)) * scale,
  );
  const height =
    margin * 2 + bandHeights.reduce((total, band) => total + band + bandGap, 0) - bandGap;
  const raster = new Raster(width, height, PLASTER);
  let top = margin;
  for (const [index, wall] of snapshot.walls.entries()) {
    const bandHeight = bandHeights[index] as number;
    const bandWidth = Math.round(wall.lengthMm * scale);
    raster.fillRect(margin, top, bandWidth, bandHeight, STONE);
    const hangLineY = top + Math.round((wall.heightMm - 1450) * scale);
    raster.fillRect(margin, hangLineY, bandWidth, 2, ACCENT);
    for (const work of snapshot.works) {
      if (work.wallName !== wall.name) continue;
      const workWidth = Math.max(2, Math.round(work.widthMm * scale));
      const workHeight = Math.max(2, Math.round(work.heightMm * scale));
      const workLeft = margin + Math.round((work.offsetMm - work.widthMm / 2) * scale);
      const workTop =
        top + Math.round((wall.heightMm - (work.centreHeightMm + work.heightMm / 2)) * scale);
      raster.fillRect(workLeft, workTop, workWidth, workHeight, PLASTER);
      raster.strokeRect(workLeft, workTop, workWidth, workHeight, INK, 2);
    }
    top += bandHeight + bandGap;
  }
  return raster.toPng();
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Publishes every due preview: freezes one snapshot per lender with placed works, creates one
 * link per such lender and queues one email each.
 */
export async function publishDuePreviews(): Promise<void> {
  const due = await withClient(async (client) => {
    const rows = (
      await client.query(
        `select id from previews where status = 'scheduled' and publish_at <= now() order by sort`,
      )
    ).rows as Row[];
    return rows.map((row) => String(row['id']));
  });
  for (const previewId of due) {
    await publishPreview(previewId);
  }
}

async function publishPreview(previewId: string): Promise<void> {
  const prepared = await withClient(async (client) => {
    const exhibition = await getExhibitionRow(client);
    const walls = await getWalls(client);
    const lenders = await listLenders(client);
    const rows = (
      await client.query(
        `select o.lender_id, o.title, o.object_number, p.offset_mm, p.centre_height_mm,
                o.width_mm, o.height_mm, w.name as wall_name, w.sort as wall_sort
         from placements p
         join loan_objects o on o.id = p.object_id
         join walls w on w.id = p.wall_id
         where p.status <> 'removed' and o.lender_id is not null
         order by w.sort, p.offset_mm`,
      )
    ).rows as Row[];
    return { exhibition, walls, lenders, rows };
  });

  const publishedAt = new Date();
  const publishedAtDisplay = formatMuseumDisplay(publishedAt, prepared.exhibition.timeZone);
  const perLender = new Map<string, Snapshot>();
  for (const lender of prepared.lenders) {
    const works = prepared.rows
      .filter((row) => String(row['lender_id']) === lender.id)
      .map((row) => ({
        title: String(row['title']),
        objectNumber: String(row['object_number']),
        wallName: String(row['wall_name']),
        offsetMm: Number(row['offset_mm']),
        centreHeightMm: Number(row['centre_height_mm']),
        widthMm: Number(row['width_mm']),
        heightMm: Number(row['height_mm']),
      }));
    if (works.length === 0) continue;
    perLender.set(lender.id, {
      exhibition: {
        title: prepared.exhibition.title,
        runStart: prepared.exhibition.runStart,
        runEnd: prepared.exhibition.runEnd,
      },
      lender: { name: lender.name },
      publishedAt: publishedAt.toISOString(),
      publishedAtDisplay,
      walls: prepared.walls.map((wall) => ({
        id: wall.id,
        name: wall.name,
        lengthMm: wall.lengthMm,
        heightMm: wall.heightMm,
      })),
      works,
    });
  }

  const frozen: {
    lenderId: string;
    token: string;
    jsonKey: string;
    pngKey: string;
    json: Buffer;
    png: Buffer;
  }[] = [];
  for (const [lenderId, snapshot] of perLender) {
    const json = Buffer.from(JSON.stringify(snapshot), 'utf8');
    const png = drawSnapshotPng(snapshot);
    const jsonKey = `previews/${previewId}/${lenderId}/snapshot.json`;
    const pngKey = `previews/${previewId}/${lenderId}/snapshot.png`;
    await putObject(jsonKey, json, 'application/json');
    await putObject(pngKey, png, 'image/png');
    frozen.push({ lenderId, token: newToken(), jsonKey, pngKey, json, png });
  }

  await withTransaction(async (client) => {
    const row = (
      await client.query(`select status from previews where id = $1 for update`, [previewId])
    ).rows[0] as { status: PreviewStatus } | undefined;
    if (!row || row.status !== 'scheduled') return;
    for (const item of frozen) {
      await client.query(
        `insert into preview_recipients (preview_id, lender_id, token, delivery,
           snapshot_json_key, snapshot_png_key, snapshot_json, snapshot_png)
         values ($1, $2, $3, 'queued', $4, $5, $6, $7)
         on conflict (preview_id, lender_id) do nothing`,
        [previewId, item.lenderId, item.token, item.jsonKey, item.pngKey, item.json, item.png],
      );
    }
    await client.query(
      `update previews set status = 'published', published_at = $2 where id = $1`,
      [previewId, publishedAt.toISOString()],
    );
    await writeEvent(client, {
      kind: 'preview.published',
      actorId: null,
      previewId,
      recipientCount: frozen.length,
    });
  });
}

export interface SnapshotDelivery {
  previewId: string;
  lenderId: string;
  lenderName: string;
  status: PreviewStatus;
  json: Buffer;
  png: Buffer;
}

export async function findSnapshotByToken(token: string): Promise<SnapshotDelivery | null> {
  return withClient(async (client) => {
    const row = (
      await client.query(
        `select r.preview_id, r.lender_id, l.name as lender_name, p.status,
                r.snapshot_json, r.snapshot_png
         from preview_recipients r
         join previews p on p.id = r.preview_id
         join lenders l on l.id = r.lender_id
         where r.token = $1`,
        [token],
      )
    ).rows[0] as Row | undefined;
    if (!row) return null;
    return {
      previewId: String(row['preview_id']),
      lenderId: String(row['lender_id']),
      lenderName: String(row['lender_name']),
      status: String(row['status']) as PreviewStatus,
      json: row['snapshot_json'] as Buffer,
      png: row['snapshot_png'] as Buffer,
    };
  });
}
