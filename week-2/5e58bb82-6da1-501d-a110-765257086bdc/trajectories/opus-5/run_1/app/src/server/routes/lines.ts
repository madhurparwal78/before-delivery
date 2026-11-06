import { createHash } from 'node:crypto';
import { CHECKSUM_MISMATCH_COPY } from '../../shared/copy.js';
import { UPLOAD_PART_BYTES } from '../config.js';
import { newId, pool, withTransaction } from '../db.js';
import { conflict, notFound, storageUnavailable, validation } from '../errors.js';
import { recordEvent } from '../events.js';
import { jsonObject, requireUser, sendJson, sendRaw, type Ctx, type Router } from '../http.js';
import { maybeRecovering } from '../missionFlow.js';
import { reportStorageDown, storageIsDown } from '../probes.js';
import { findLine, listVessels, toLine, type LineRow, type MissionRow } from '../repo.js';
import { recomputeHolidays } from '../state.js';
import { getObject, lineFileKey, putObject, StorageUnreachable } from '../storage.js';
import { lineByIdInScope, lockRecord, staffOnly } from './guards.js';

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;

const FILE_NAME_MESSAGE =
  'Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens';
const SHA_MESSAGE = 'Enter the 64-character SHA-256 from the logger';

function header(ctx: Ctx, name: string): string {
  const value = ctx.req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first ?? '';
}

async function lineRecord(line: LineRow): Promise<ReturnType<typeof toLine>> {
  const names = new Map((await listVessels(pool)).map((vessel) => [vessel.id, vessel.name]));
  const fresh = (await findLine(pool, line.id)) ?? line;
  return toLine(fresh, fresh.vessel_id ? names.get(fresh.vessel_id) ?? null : null, 0);
}

/**
 * Records a stored file: the line becomes Delivered, a re-run supersedes its
 * original, and the mission's holidays and status follow.
 */
async function recordStoredFile(
  mission: MissionRow,
  line: LineRow,
  fileName: string,
  bytes: number,
  sha256: string,
  actor: string,
  now: Date,
): Promise<void> {
  await withTransaction(async (client) => {
    await lockRecord(client, 'mission', mission.id);
    await client.query(
      `UPDATE lines SET status = 'Delivered', file_state = 'Stored', file_name = $2,
         file_size = $3, file_sha256 = $4, file_stored_at = $5 WHERE id = $1`,
      [line.id, fileName, bytes, sha256.toLowerCase(), now.toISOString()],
    );
    await recordEvent(client, mission.id, 'line', actor, `${line.label} Surveyed → Delivered`, now);
    await recordEvent(client, mission.id, 'file', actor, `${line.label} file stored`, now);
    if (line.rerun_of !== null) {
      const original = await findLine(client, line.rerun_of);
      if (original && (original.status === 'Surveyed' || original.status === 'Delivered')) {
        await client.query(`UPDATE lines SET status = 'Superseded' WHERE id = $1`, [original.id]);
        await recordEvent(
          client,
          mission.id,
          'line',
          actor,
          `${original.label} ${original.status} → Superseded`,
          now,
        );
      }
    }
    await recomputeHolidays(client, mission.id);
    await maybeRecovering(client, mission.id, now);
  });
}

async function storeBytes(
  mission: MissionRow,
  line: LineRow,
  fileName: string,
  bytes: Buffer,
  sha256: string,
): Promise<void> {
  try {
    await putObject(
      lineFileKey(mission.id, line.id, fileName),
      bytes,
      'application/octet-stream',
      sha256.toLowerCase(),
    );
  } catch (error) {
    if (error instanceof StorageUnreachable) {
      await reportStorageDown();
      throw storageUnavailable();
    }
    throw error;
  }
}

export function registerLineRoutes(router: Router): void {
  router.add({
    method: 'PUT',
    pattern: '/api/lines/:lineId/file',
    body: 'raw',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const { mission, line } = await lineByIdInScope(pool, user, ctx.params.lineId!);
      staffOnly(user);

      const bytes = ctx.rawBody ?? Buffer.alloc(0);
      const declared = header(ctx, 'x-content-sha256');
      const fileName = header(ctx, 'x-line-file-name');

      // An identical re-upload to a Delivered line returns the original result.
      if (
        line.status === 'Delivered' &&
        line.file_sha256 !== null &&
        SHA256.test(declared) &&
        line.file_sha256 === declared.toLowerCase() &&
        line.file_size === bytes.byteLength
      ) {
        sendJson(ctx.res, 200, await lineRecord(line));
        return;
      }

      if (line.status === 'Delivered') {
        throw conflict('already_delivered', `${line.label} already holds a different file`);
      }
      if (line.status !== 'Surveyed') {
        throw conflict('line_not_surveyed', `${line.label} has no data to deliver yet`);
      }

      const errors: Record<string, string> = {};
      if (bytes.byteLength < 1) errors.file = 'The file is empty';
      if (!FILE_NAME.test(fileName)) errors.file_name = FILE_NAME_MESSAGE;
      if (!SHA256.test(declared)) errors.sha256 = SHA_MESSAGE;
      if (Object.keys(errors).length > 0) throw validation(errors);

      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== declared.toLowerCase()) {
        throw validation({ sha256: CHECKSUM_MISMATCH_COPY });
      }

      const winner = await withTransaction(async (client) => {
        await lockRecord(client, 'line', line.id);
        const current = await findLine(client, line.id);
        if (!current) throw notFound();
        if (current.status === 'Delivered') {
          if (current.file_sha256 === actual && current.file_size === bytes.byteLength) {
            return 'replay' as const;
          }
          throw conflict('already_delivered', `${line.label} already holds a different file`);
        }
        if (current.status !== 'Surveyed') {
          throw conflict('line_not_surveyed', `${line.label} has no data to deliver yet`);
        }
        await client.query(`UPDATE lines SET file_state = 'Awaiting upload' WHERE id = $1`, [line.id]);
        return 'go' as const;
      });

      if (winner === 'replay') {
        sendJson(ctx.res, 200, await lineRecord(line));
        return;
      }

      await storeBytes(mission, line, fileName, bytes, actual);
      await recordStoredFile(mission, line, fileName, bytes.byteLength, actual, user.name, ctx.now);
      sendJson(ctx.res, 201, await lineRecord(line));
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/lines/:lineId/file',
    body: 'none',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const { mission, line } = await lineByIdInScope(pool, user, ctx.params.lineId!);
      // A line-file download checks storage right after the role check.
      if (await storageIsDown(pool)) throw storageUnavailable();
      if (line.file_state !== 'Stored' || line.file_name === null) {
        throw conflict('file_not_stored', `${line.label} has no stored file`);
      }
      let object: Awaited<ReturnType<typeof getObject>>;
      try {
        object = await getObject(lineFileKey(mission.id, line.id, line.file_name));
      } catch (error) {
        if (error instanceof StorageUnreachable) {
          await reportStorageDown();
          throw storageUnavailable();
        }
        throw error;
      }
      if (!object) throw storageUnavailable();
      const chunks: Buffer[] = [];
      const reader = object.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      sendRaw(ctx.res, 200, Buffer.concat(chunks), {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${line.file_name}"`,
        'x-content-sha256': line.file_sha256 ?? '',
        'cache-control': 'no-store',
      });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/lines/:lineId/uploads',
    body: 'json',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const { line } = await lineByIdInScope(pool, user, ctx.params.lineId!);
      staffOnly(user);
      const body = jsonObject(ctx);
      const size = body.size_bytes;
      const sha = typeof body.sha256 === 'string' ? body.sha256 : '';

      if (
        line.status === 'Delivered' &&
        line.file_sha256 !== null &&
        SHA256.test(sha) &&
        line.file_sha256 === sha.toLowerCase() &&
        line.file_size === size
      ) {
        sendJson(ctx.res, 200, await lineRecord(line));
        return;
      }
      if (line.status === 'Delivered') {
        throw conflict('already_delivered', `${line.label} already holds a different file`);
      }
      if (line.status !== 'Surveyed') {
        throw conflict('line_not_surveyed', `${line.label} has no data to deliver yet`);
      }

      const errors: Record<string, string> = {};
      if (
        typeof size !== 'number' ||
        !Number.isInteger(size) ||
        size < 1 ||
        size > 50_000_000
      ) {
        errors.size_bytes = 'The file must be 1 to 50,000,000 bytes';
      }
      if (!SHA256.test(sha)) errors.sha256 = SHA_MESSAGE;
      if (Object.keys(errors).length > 0) throw validation(errors);

      const result = await withTransaction(async (client) => {
        await lockRecord(client, 'line', line.id);
        const open = await client.query<{ id: string; received_bytes: number }>(
          `SELECT id, received_bytes FROM uploads
           WHERE line_id = $1 AND open AND size_bytes = $2 AND sha256 = $3 LIMIT 1`,
          [line.id, size, (sha as string).toLowerCase()],
        );
        const existing = open.rows[0];
        if (existing) {
          return { status: 200, id: existing.id, received: existing.received_bytes };
        }
        await client.query('UPDATE uploads SET open = false WHERE line_id = $1 AND open', [line.id]);
        const id = newId('up');
        await client.query(
          `INSERT INTO uploads (id, line_id, size_bytes, sha256, received_bytes, open)
           VALUES ($1,$2,$3,$4,0,true)`,
          [id, line.id, size, (sha as string).toLowerCase()],
        );
        return { status: 201, id, received: 0 };
      });

      sendJson(ctx.res, result.status, {
        upload_id: result.id,
        part_bytes: UPLOAD_PART_BYTES,
        received_bytes: result.received,
      });
    },
  });

  router.add({
    method: 'PUT',
    pattern: '/api/lines/:lineId/uploads/:uploadId',
    body: 'raw',
    handler: async (ctx) => {
      const user = requireUser(ctx);
      const { mission, line } = await lineByIdInScope(pool, user, ctx.params.lineId!);
      staffOnly(user);
      const uploadId = ctx.params.uploadId!;
      const part = ctx.rawBody ?? Buffer.alloc(0);

      const upload = await pool.query<{
        id: string;
        size_bytes: number;
        sha256: string;
        received_bytes: number;
      }>(
        `SELECT id, size_bytes, sha256, received_bytes FROM uploads
         WHERE id = $1 AND line_id = $2 AND open`,
        [uploadId, line.id],
      );
      const current = upload.rows[0];
      if (!current) throw notFound();

      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header(ctx, 'content-range'));
      if (!range) throw validation({ content_range: 'Send Content-Range as bytes <first>-<last>/<size>' });
      const first = Number(range[1]);
      const last = Number(range[2]);
      const total = Number(range[3]);
      if (
        total !== current.size_bytes ||
        last - first + 1 !== part.byteLength ||
        part.byteLength > UPLOAD_PART_BYTES ||
        part.byteLength < 1
      ) {
        throw conflict('range_mismatch', 'That part does not continue this upload.', {
          received_bytes: current.received_bytes,
        });
      }
      if (first !== current.received_bytes) {
        throw conflict('range_mismatch', 'That part does not continue this upload.', {
          received_bytes: current.received_bytes,
        });
      }

      const received = await withTransaction(async (client) => {
        await lockRecord(client, 'line', line.id);
        const fresh = await client.query<{ received_bytes: number }>(
          'SELECT received_bytes FROM uploads WHERE id = $1 AND open FOR UPDATE',
          [uploadId],
        );
        const at = fresh.rows[0];
        if (!at) throw notFound();
        if (at.received_bytes !== first) {
          throw conflict('range_mismatch', 'That part does not continue this upload.', {
            received_bytes: at.received_bytes,
          });
        }
        await client.query(
          `INSERT INTO upload_parts (upload_id, first_byte, bytes) VALUES ($1,$2,$3)
           ON CONFLICT (upload_id, first_byte) DO UPDATE SET bytes = $3`,
          [uploadId, first, part],
        );
        const updated = await client.query<{ received_bytes: number }>(
          'UPDATE uploads SET received_bytes = $2 WHERE id = $1 RETURNING received_bytes',
          [uploadId, first + part.byteLength],
        );
        return updated.rows[0]!.received_bytes;
      });

      if (received < current.size_bytes) {
        sendJson(ctx.res, 200, { received_bytes: received });
        return;
      }

      const parts = await pool.query<{ bytes: Buffer }>(
        'SELECT bytes FROM upload_parts WHERE upload_id = $1 ORDER BY first_byte',
        [uploadId],
      );
      const whole = Buffer.concat(parts.rows.map((row) => row.bytes));
      const actual = createHash('sha256').update(whole).digest('hex');
      if (actual !== current.sha256) {
        await pool.query('DELETE FROM upload_parts WHERE upload_id = $1', [uploadId]);
        await pool.query('UPDATE uploads SET open = false WHERE id = $1', [uploadId]);
        throw validation({ sha256: CHECKSUM_MISMATCH_COPY });
      }

      const fileName = header(ctx, 'x-line-file-name');
      const name = FILE_NAME.test(fileName) ? fileName : `${line.label}.raw`;
      try {
        await storeBytes(mission, line, name, whole, actual);
      } catch (error) {
        await pool.query('UPDATE uploads SET received_bytes = $2 WHERE id = $1', [
          uploadId,
          first,
        ]);
        await pool.query('DELETE FROM upload_parts WHERE upload_id = $1 AND first_byte = $2', [
          uploadId,
          first,
        ]);
        throw error;
      }
      await recordStoredFile(mission, line, name, whole.byteLength, actual, user.name, ctx.now);
      await pool.query('UPDATE uploads SET open = false WHERE id = $1', [uploadId]);
      await pool.query('DELETE FROM upload_parts WHERE upload_id = $1', [uploadId]);
      sendJson(ctx.res, 201, await lineRecord(line));
    },
  });
}
