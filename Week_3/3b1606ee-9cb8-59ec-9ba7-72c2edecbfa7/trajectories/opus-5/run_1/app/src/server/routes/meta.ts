import type { AvailabilityRecord, ConfigRecord } from '../../shared/types.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { availability } from '../domain/usernames.js';
import { sendJson, type RequestContext } from '../http.js';
import { storageHealthy } from '../storage.js';

export async function getHealth(ctx: RequestContext): Promise<void> {
  const ok = await storageHealthy();
  sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
}

export async function getConfig(ctx: RequestContext): Promise<void> {
  const body: ConfigRecord = {
    attachment_max_bytes: config.attachmentMaxBytes,
    timers: config.timers,
    grading: config.grading,
  };
  sendJson(ctx.res, 200, body);
}

export async function getAvailability(ctx: RequestContext): Promise<void> {
  const raw = ctx.params['username'] ?? '';
  const record: AvailabilityRecord = await availability(pool, decodeURIComponent(raw));
  sendJson(ctx.res, 200, record);
}
