import { config } from './config.js';
import { pool, withTransaction, type Queryable } from './db.js';
import { newId } from './seed.js';
import { apiError } from './api-error.js';
import {
  loadRequestRow, loadSeatRows, renderRequest, requestFullView, writeAudit,
  getRates, loadPrepFiles, durationMinutesOf, type RequestRow,
} from './store.js';
import { seatTotal, MIN_ASSIGNMENT_MINUTES, MAX_ASSIGNMENT_MINUTES } from './rules.js';
import { queueEmail } from './services/outbox.js';
import { putObject } from './services/s3.js';
import { centsToMoney } from './money.js';
import { MS_PER_MINUTE, parseInstant, parseNominalDate, agencyWallClockToInstant } from './time.js';
import type { RequestView, SessionUser, Setting } from './types.js';
import type pg from 'pg';

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v);

const SETTINGS: Setting[] = ['medical', 'legal', 'education', 'community'];

export interface RequestInput {
  title: unknown;
  setting: unknown;
  location: unknown;
  start: unknown;
  end: unknown;
  consumer_id: unknown;
  notes: unknown;
}

interface ValidatedRequest {
  title: string;
  setting: Setting;
  location: string;
  startMs: number;
  endMs: number;
  consumerId: string;
  notes: string;
}

async function validateRequestInput(
  q: Queryable, input: RequestInput, orgId: string, loggedAfter: boolean, isPatch: boolean, existing?: ValidatedRequest,
): Promise<ValidatedRequest> {
  const fields: Record<string, string> = {};

  const base = existing ?? { title: '', setting: 'medical', location: '', startMs: 0, endMs: 0, consumerId: '', notes: '' };

  let title = base.title;
  if (input.title !== undefined) {
    title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 1 || title.length > 120) fields.title = 'Title must be 1-120 characters.';
  } else if (!isPatch) fields.title = 'Title is required.';

  let setting = base.setting;
  if (input.setting !== undefined) {
    setting = (SETTINGS as string[]).includes(String(input.setting)) ? input.setting as Setting : base.setting;
    if (!(SETTINGS as string[]).includes(String(input.setting))) fields.setting = 'Setting must be one of the four settings.';
  } else if (!isPatch) fields.setting = 'Setting is required.';

  let location = base.location;
  if (input.location !== undefined) {
    location = typeof input.location === 'string' ? input.location.trim() : '';
    if (location.length < 1 || location.length > 200) fields.location = 'Location must be 1-200 characters.';
  } else if (!isPatch) fields.location = 'Location is required.';

  let startMs = base.startMs;
  if (input.start !== undefined) {
    const parsed = parseInstant(String(input.start));
    if (!parsed) {
      fields.start = 'Enter a valid date and time.';
    } else {
      startMs = parsed.getTime();
    }
  } else if (!isPatch) fields.start = 'Start is required.';

  let endMs = base.endMs;
  if (input.end !== undefined) {
    const parsed = parseInstant(String(input.end));
    if (!parsed) {
      fields.end = 'Enter a valid date and time.';
    } else {
      endMs = parsed.getTime();
    }
  } else if (!isPatch) fields.end = 'End is required.';

  let consumerId = base.consumerId;
  if (input.consumer_id !== undefined) {
    const res = await q.query<Row>('SELECT id FROM consumers WHERE id = $1', [String(input.consumer_id)]);
    if (res.rows.length === 0) {
      fields.consumer_id = 'Pick a Deaf consumer.';
    } else {
      consumerId = String(input.consumer_id);
    }
  } else if (!isPatch) fields.consumer_id = 'Pick a Deaf consumer.';

  let notes = base.notes;
  if (input.notes !== undefined) {
    notes = typeof input.notes === 'string' ? input.notes : '';
    if (notes.length > 2000) fields.notes = 'Notes must be at most 2000 characters.';
  }

  if (startMs && endMs && Object.keys(fields).length === 0) {
    const minutes = Math.round((endMs - startMs) / MS_PER_MINUTE);
    if (endMs <= startMs) {
      fields.end = 'End must be after start.';
    } else if (minutes < MIN_ASSIGNMENT_MINUTES || minutes > MAX_ASSIGNMENT_MINUTES) {
      fields.end = 'Length must be from 30 minutes to 10 hours.';
    }
    const nowMs = Date.now();
    if (!loggedAfter && startMs <= nowMs) {
      fields.start = 'Start must be in the future.';
    }
    if (loggedAfter) {
      if (startMs > nowMs) {
        fields.start = 'Start must be in the past.';
      } else if (nowMs - startMs > 14 * 24 * 60 * MS_PER_MINUTE) {
        fields.start = 'Start must be no more than 14 days ago.';
      }
    }
  }

  if (Object.keys(fields).length > 0) throw apiError('validation', { fields });

  return { title, setting, location, startMs, endMs, consumerId, notes };
}

export async function createRequest(
  user: SessionUser, input: RequestInput & { org_id?: unknown; logged_after?: unknown },
): Promise<RequestView> {
  const loggedAfter = user.role === 'coordinator' && input.logged_after === true;
  const orgId = user.role === 'coordinator' ? String(input.org_id ?? '') : user.org_id!;
  if (user.role === 'coordinator') {
    const org = await pool.query<Row>('SELECT id FROM orgs WHERE id = $1', [orgId]);
    if (org.rows.length === 0) throw apiError('validation', { fields: { org_id: 'Pick an organisation.' } });
  }

  return withTransaction(async (client) => {
    const v = await validateRequestInput(client, input, orgId, loggedAfter, false);
    const ref = await nextRef(client);
    const requestId = newId('req');
    const durationMin = Math.round((v.endMs - v.startMs) / MS_PER_MINUTE);
    const total = seatTotal(v.setting, durationMin);
    const status = loggedAfter ? 'submitted' : 'draft';
    await client.query(
      `INSERT INTO requests (id, ref, org_id, title, setting, location, start_at, end_at, consumer_id, notes, logged_after, status, seats_total, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())`,
      [requestId, ref, orgId, v.title, v.setting, v.location, new Date(v.startMs), new Date(v.endMs), v.consumerId, v.notes, loggedAfter, status, total],
    );
    for (let i = 1; i <= total; i++) {
      await client.query(
        'INSERT INTO seats (id, request_id, position, status) VALUES ($1,$2,$3,$4)',
        [newId('seat'), requestId, i, 'open'],
      );
    }
    await writeAudit(client, {
      actorUserId: user.id, action: 'request.created', entity: 'request', entityId: requestId,
      from: null, to: status,
    });
    return await requestFullView(client, requestId);
  });
}

export async function patchRequest(user: SessionUser, requestId: string, input: RequestInput): Promise<RequestView> {
  return withTransaction(async (client) => {
    const r = await loadRequestRow(client, requestId);
    if (r.org_id !== user.org_id) throw apiError('not_found');
    if (r.status !== 'draft') {
      throw apiError('invalid_transition', { from: r.status }, { from: r.status });
    }
    const current: ValidatedRequest = {
      title: r.title, setting: r.setting, location: r.location, startMs: r.start_ms, endMs: r.end_ms,
      consumerId: r.consumer_id, notes: r.notes,
    };
    const v = await validateRequestInput(client, input, r.org_id, r.logged_after, true, current);

    await client.query(
      `UPDATE requests SET title = $1, setting = $2, location = $3, start_at = $4, end_at = $5,
        consumer_id = $6, notes = $7, updated_at = now() WHERE id = $8`,
      [v.title, v.setting, v.location, new Date(v.startMs), new Date(v.endMs), v.consumerId, v.notes, requestId],
    );

    // Seats are recomputed when a draft is edited.
    const durationMin = Math.round((v.endMs - v.startMs) / MS_PER_MINUTE);
    const total = seatTotal(v.setting, durationMin);
    const seats = await loadSeatRows(client, requestId);
    if (seats.length !== total) {
      const claimed = seats.some((s) => s.status !== 'open');
      if (!claimed) {
        await client.query('DELETE FROM offers WHERE seat_id IN (SELECT id FROM seats WHERE request_id = $1)', [requestId]);
        await client.query('DELETE FROM seats WHERE request_id = $1', [requestId]);
        for (let i = 1; i <= total; i++) {
          await client.query(
            'INSERT INTO seats (id, request_id, position, status) VALUES ($1,$2,$3,$4)',
            [newId('seat'), requestId, i, 'open'],
          );
        }
        await client.query('UPDATE requests SET seats_total = $1 WHERE id = $2', [total, requestId]);
      }
    }

    await writeAudit(client, {
      actorUserId: user.id, action: 'request.updated', entity: 'request', entityId: requestId,
      from: 'draft', to: 'draft',
    });
    return await requestFullView(client, requestId);
  });
}

export async function submitRequest(user: SessionUser, requestId: string): Promise<RequestView> {
  return withTransaction(async (client) => {
    const r = await loadRequestRow(client, requestId);
    if (r.org_id !== user.org_id) throw apiError('not_found');
    if (r.status !== 'draft') {
      throw apiError('invalid_transition', { from: r.status }, { from: r.status });
    }
    if (!r.logged_after && r.start_ms <= Date.now()) {
      throw apiError('validation', { fields: { start: 'Start must be in the future.' } });
    }
    await client.query('UPDATE requests SET status = $1, updated_at = now() WHERE id = $2', ['submitted', requestId]);
    await writeAudit(client, {
      actorUserId: user.id, action: 'request.submitted', entity: 'request', entityId: requestId,
      from: 'draft', to: 'submitted',
    });
    return await requestFullView(client, requestId);
  });
}

async function nextRef(client: Queryable): Promise<string> {
  const res = await client.query<Row>(
    `SELECT max(substring(ref from 4)::int) AS maxnum FROM requests WHERE ref ~ '^FA-[0-9]+$'`,
  );
  const max = res.rows[0]?.maxnum ? num(res.rows[0].maxnum) : 1000;
  return `FA-${max + 1}`;
}

// ---------- prep files ----------

export const PREP_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'image/png', 'image/jpeg'];
export const SCAN_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function sniffType(bytes: Buffer, declared: string): string | null {
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from('%PDF'))) return 'application/pdf';
  if (bytes.length >= 8 && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (declared.includes('wordprocessing')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (declared.includes('presentationml') || declared.includes('powerpoint')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return null;
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const printable = bytes.length === 0 || bytes.subarray(0, Math.min(bytes.length, 512)).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128);
  if (printable && (declared.startsWith('text/') || declared.includes('plain'))) return 'text/plain';
  if (printable && declared === '') return 'text/plain';
  return null;
}

export async function attachPrepFile(
  user: SessionUser, requestId: string, filename: string, bytes: Buffer, declared: string,
): Promise<{ id: string; filename: string; size: number; content_type: string }> {
  const contentType = sniffType(bytes, declared);
  if (!contentType || !PREP_TYPES.includes(contentType)) throw apiError('unsupported_media_type');
  return withTransaction(async (client) => {
    const r = await loadRequestRow(client, requestId);
    if (r.org_id !== user.org_id) throw apiError('not_found');
    if (!['draft', 'submitted', 'partially_staffed', 'staffed'].includes(r.status)) {
      throw apiError('invalid_transition', { from: r.status }, { from: r.status });
    }
    const fileId = newId('file');
    const safeName = filename.replace(/[/\\]/g, '_');
    const key = `prep/${r.org_id}/${requestId}/${fileId}/${safeName}`;
    try {
      await putObject(key, bytes, contentType);
    } catch {
      throw apiError('storage_unavailable');
    }
    await client.query(
      `INSERT INTO prep_files (id, request_id, filename, content_type, size_bytes, storage_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [fileId, requestId, safeName, contentType, bytes.length, key],
    );
    return { id: fileId, filename: safeName, size: bytes.length, content_type: contentType };
  });
}

// ---------- credentials ----------

export async function addCredential(
  user: SessionUser, interpreterId: string, type: string, credNumber: string,
  expiresOn: string, filename: string, bytes: Buffer, declared: string,
): Promise<{ id: string; type: string; number: string; expires_on: string; status: string }> {
  const contentType = sniffType(bytes, declared);
  if (!contentType || !SCAN_TYPES.includes(contentType)) throw apiError('unsupported_media_type');
  return withTransaction(async (client) => {
    const fields: Record<string, string> = {};
    const CRED_TYPES = ['NIC', 'CDI', 'SC:L', 'EIPA-4.0'];
    if (!CRED_TYPES.includes(type)) fields.type = 'Credential type must be NIC, CDI, SC:L or EIPA-4.0.';
    if (credNumber.trim().length < 1 || credNumber.trim().length > 40) fields.number = 'Credential number must be 1-40 characters.';
    const expiresMs = parseNominalDate(expiresOn);
    if (!expiresMs) fields.expires_on = 'Enter a valid date.';
    if (Object.keys(fields).length > 0) throw apiError('validation', { fields });
    const expiryMs = expiresMs!;

    const credId = newId('cred');
    const safeName = filename.replace(/[/\\]/g, '_');
    const key = `credentials/${interpreterId}/${credId}/${safeName}`;
    try {
      await putObject(key, bytes, contentType);
    } catch {
      throw apiError('storage_unavailable');
    }
    await client.query(
      `INSERT INTO credentials (id, interpreter_id, type, number, expires_on, scan_key, scan_filename, warning_sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
      [credId, interpreterId, type, credNumber.trim(), expiresOn, key, safeName],
    );
    await writeAudit(client, {
      actorUserId: user.id, action: 'credential.added', entity: 'credential', entityId: credId,
      from: null, to: null,
    });
    const status = expiryMs < startOfTodayUtc() ? 'expired'
      : expiryMs <= startOfTodayUtc() + 30 * 86_400_000 ? 'expiring' : 'valid';
    return { id: credId, type, number: credNumber.trim(), expires_on: expiresOn, status };
  });
}

function startOfTodayUtc(): number {
  const now = new Date();
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parseNominalDate(key) ?? 0;
}
