import { randomUUID } from 'node:crypto';
import { query, transaction } from '../db.js';
import { storageUnavailable, tooLarge, validation } from '../http/errors.js';
import { filePart } from '../http/multipart.js';
import { type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { parseEnergyLog } from '../domain/energy.js';
import { requireYacht } from '../records.js';
import { putObject, StorageUnreachable } from '../services/storage.js';
import { toInstantString, ZONES } from '../../shared/zone.js';
import { json } from './helpers.js';

export const LOG_LIMIT_BYTES = 2_000_000;

interface LogRow {
  readonly id: string;
  readonly file_name: string;
  readonly size_bytes: string;
  readonly object_key: string;
  readonly uploaded_at: Date;
  readonly uploaded_by_name: string;
  readonly day_count: string;
}

const LOG_SELECT = `
  SELECT l.id, l.file_name, l.size_bytes, l.object_key, l.uploaded_at, l.uploaded_by_name,
    (SELECT count(*) FROM energy_log_days d WHERE d.log_id = l.id) AS day_count
  FROM energy_logs l`;

function logJson(log: LogRow): Record<string, unknown> {
  return {
    id: log.id,
    fileName: log.file_name,
    sizeBytes: Number(log.size_bytes),
    uploadedAt: toInstantString(log.uploaded_at),
    uploadedBy: log.uploaded_by_name,
    objectKey: log.object_key,
    dayCount: Number(log.day_count),
  };
}

async function uploadLog(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'energy_logs');
  const part = filePart(ctx, 'log');
  if (part === null) throw validation({ log: FIELD_ERRORS.required });
  if (part.content.length > LOG_LIMIT_BYTES) throw tooLarge(LOG_LIMIT_BYTES);
  const days = parseEnergyLog(part.content, ZONES[yacht.base]);
  const id = randomUUID();
  const objectKey = `energy-logs/${yacht.slug}/${id}.jsonl`;
  try {
    await putObject(objectKey, part.content, 'application/x-ndjson');
  } catch (error) {
    if (error instanceof StorageUnreachable) throw storageUnavailable();
    throw error;
  }
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO energy_logs (id, workspace_id, yacht_id, file_name, size_bytes, object_key,
          uploaded_at, uploaded_by_member_id, uploaded_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        actor.workspaceId,
        yacht.id,
        part.fileName ?? 'log.jsonl',
        part.content.length,
        objectKey,
        ctx.now,
        actor.id,
        actor.name,
      ],
    );
    for (const day of days) {
      await client.query(
        `INSERT INTO energy_log_days (log_id, day_date, start_charge_pct, end_charge_pct,
            lowest_charge_pct, solar_wh)
          VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, day.date, day.startChargePct, day.endChargePct, day.lowestChargePct, day.solarWh],
      );
    }
  });
  const stored = await query<LogRow>(`${LOG_SELECT} WHERE l.id = $1`, [id]);
  return json(201, { log: logJson(stored[0]) });
}

async function listLogs(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'energy_logs');
  const logs = await query<LogRow>(`${LOG_SELECT} WHERE l.yacht_id = $1 ORDER BY l.uploaded_at DESC`, [
    yacht.id,
  ]);
  return json(200, { logs: logs.map(logJson) });
}

async function listDays(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'energy_logs');
  const days = await query<{
    day_date: string;
    start_charge_pct: string;
    end_charge_pct: string;
    lowest_charge_pct: string;
    solar_wh: string;
  }>(
    `SELECT DISTINCT ON (d.day_date) d.day_date, d.start_charge_pct, d.end_charge_pct,
            d.lowest_charge_pct, d.solar_wh
       FROM energy_log_days d JOIN energy_logs l ON l.id = d.log_id
      WHERE l.yacht_id = $1
      ORDER BY d.day_date, l.uploaded_at DESC, l.id DESC`,
    [yacht.id],
  );
  return json(200, {
    base: yacht.base,
    days: days.map((day) => ({
      date: day.day_date,
      startChargePct: Math.floor(Number(day.start_charge_pct)),
      endChargePct: Math.floor(Number(day.end_charge_pct)),
      lowestChargePct: Math.floor(Number(day.lowest_charge_pct)),
      solarKwh: Number(day.solar_wh) / 1000,
    })),
  });
}

export function registerEnergyRoutes(router: Router): void {
  router.add(
    '/api/w/:ws/yachts/:yachtSlug/energy-logs',
    { POST: uploadLog, GET: listLogs },
    { fileLimitBytes: LOG_LIMIT_BYTES },
  );
  router.add('/api/w/:ws/yachts/:yachtSlug/energy-days', { GET: listDays });
}
