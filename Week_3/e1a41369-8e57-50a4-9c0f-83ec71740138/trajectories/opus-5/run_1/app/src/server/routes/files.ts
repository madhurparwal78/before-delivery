import { randomUUID } from 'node:crypto';
import type { ImportRecord } from '../../shared/types.js';
import { BANNER_FILE_LIMIT, IMPORT_FILE_LIMIT } from '../config.js';
import { query, transaction, type Client } from '../db.js';
import { Router, type Ctx } from '../http/core.js';
import { ApiError, fail } from '../http/errors.js';
import { importFileIsText, parseImportFile } from '../domain/importFormat.js';
import { bannerObjectKey, getObject, importObjectKey, putObject } from '../storage.js';
import { loadUser, type UserRow } from '../services/player.js';
import { publishBanner, publishParty, publishTasks } from '../services/notify.js';
import { countOfType } from '../services/tasks.js';
import { bannerUrlFor, currentBanner } from '../services/party.js';
import { requireLeader, requireMembership } from './party.js';

async function currentUser(ctx: Ctx): Promise<UserRow> {
  const session = ctx.requireUser();
  const user = await loadUser({ query }, session.id);
  if (!user) throw fail('unauthenticated');
  return user;
}

async function importJson(client: Client, importId: string): Promise<ImportRecord | null> {
  const found = await client.query<{
    id: string;
    filename: string;
    size: number;
    status: string;
    created_at: Date;
  }>('select id, filename, size, status, created_at from imports where id = $1', [importId]);
  const row = found.rows[0];
  if (!row) return null;
  const lines = await client.query<{ line: number; task_id: string | null; type: string | null; title: string | null }>(
    'select line, task_id, type, title from import_lines where import_id = $1 order by line',
    [importId],
  );
  const errors = await client.query<{ line: number; message: string }>(
    'select line, message from import_errors where import_id = $1 order by id',
    [importId],
  );
  return {
    id: row.id,
    filename: row.filename,
    size: row.size,
    status: row.status as ImportRecord['status'],
    createdAt: row.created_at.toISOString(),
    taskCount: lines.rowCount ?? 0,
    errorCount: errors.rowCount ?? 0,
    lines: lines.rows.map((line) => ({
      line: line.line,
      taskId: line.task_id,
      type: line.type,
      title: line.title,
    })),
    errors: errors.rows.map((error) => ({ line: error.line, message: error.message })),
  };
}

function detectImageType(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export function registerFileRoutes(router: Router): void {
  router.add(
    'POST',
    '/api/imports',
    async (ctx) => {
      const user = await currentUser(ctx);
      if (ctx.bodyTooLarge) throw fail('file_too_large');
      const upload = await ctx.file();
      if (upload.bytes.byteLength > IMPORT_FILE_LIMIT) throw fail('file_too_large');
      if (!importFileIsText(upload.filename, upload.bytes)) throw fail('unsupported_file_type');

      const importId = randomUUID();
      await putObject(importObjectKey(user.id, importId), upload.bytes, 'text/plain; charset=utf-8');

      const parsed = parseImportFile(upload.bytes.toString('utf8'));
      const record = await transaction(async (client) => {
        await client.query(
          'insert into imports (id, user_id, filename, size, status, object_key) values ($1, $2, $3, $4, $5, $6)',
          [
            importId,
            user.id,
            upload.filename,
            upload.bytes.byteLength,
            parsed.errors.length > 0 ? 'rejected' : 'imported',
            importObjectKey(user.id, importId),
          ],
        );
        for (const error of parsed.errors) {
          await client.query('insert into import_errors (import_id, line, message) values ($1, $2, $3)', [
            importId,
            error.line,
            error.message,
          ]);
        }
        for (const task of parsed.tasks) {
          const position = (await countOfType(client, user.id, task.type)) + 1;
          const created = await client.query<{ id: string }>(
            `insert into tasks (user_id, type, title, difficulty, value, streak, done, weekdays, price_cents,
               position, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, date_trunc('milliseconds', now())) returning id`,
            [
              user.id,
              task.type,
              task.title,
              task.type === 'reward' ? null : task.difficulty,
              task.type === 'reward' ? null : 0,
              task.type === 'daily' ? 0 : null,
              task.type === 'daily' || task.type === 'todo' ? false : null,
              task.type === 'daily' ? task.weekdays : null,
              task.type === 'reward' ? task.priceCents : null,
              position,
            ],
          );
          const taskId = created.rows[0]?.id as string;
          const items = task.checklist ?? [];
          for (let index = 0; index < items.length; index += 1) {
            await client.query('insert into checklist_items (task_id, text, position) values ($1, $2, $3)', [
              taskId,
              items[index] as string,
              index + 1,
            ]);
          }
          await client.query(
            'insert into import_lines (import_id, line, task_id, type, title) values ($1, $2, $3, $4, $5)',
            [importId, task.line, taskId, task.type, task.title],
          );
        }
        return importJson(client, importId);
      });

      if (parsed.errors.length > 0) {
        throw new ApiError(422, { importId, errors: parsed.errors });
      }
      await publishTasks({ query }, user.id);
      ctx.send(201, record);
    },
    true,
  );

  router.add('GET', '/api/imports', async (ctx) => {
    const user = await currentUser(ctx);
    const found = await query<{ id: string }>(
      'select id from imports where user_id = $1 order by created_at desc, id desc',
      [user.id],
    );
    const imports = [];
    for (const row of found.rows) {
      const record = await importJson({ query }, row.id);
      if (record) imports.push(record);
    }
    ctx.send(200, { imports });
  });

  router.add('GET', '/api/imports/:id', async (ctx) => {
    const user = await currentUser(ctx);
    const owned = await query('select 1 from imports where id = $1 and user_id = $2', [ctx.param('id'), user.id]);
    if (owned.rowCount === 0) throw fail('not_found');
    ctx.send(200, await importJson({ query }, ctx.param('id')));
  });

  router.add('GET', '/api/imports/:id/original', async (ctx) => {
    const user = await currentUser(ctx);
    const found = await query<{ filename: string; object_key: string }>(
      'select filename, object_key from imports where id = $1 and user_id = $2',
      [ctx.param('id'), user.id],
    );
    const record = found.rows[0];
    if (!record) throw fail('not_found');
    const bytes = await getObject(record.object_key);
    if (!bytes) throw fail('not_found');
    ctx.sendBytes(200, bytes, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${record.filename.replace(/"/g, '')}"`,
    });
  });

  router.add(
    'PUT',
    '/api/parties/:id/banner',
    async (ctx) => {
      const user = await currentUser(ctx);
      const partyId = ctx.param('id');
      await requireLeader({ query }, partyId, user.id);
      if (ctx.bodyTooLarge) throw fail('file_too_large');
      const upload = await ctx.file();
      if (upload.bytes.byteLength > BANNER_FILE_LIMIT) throw fail('file_too_large');
      const contentType = detectImageType(upload.bytes);
      if (!contentType) throw fail('unsupported_file_type');

      const uploadId = randomUUID();
      const key = bannerObjectKey(partyId, uploadId, contentType);
      await putObject(key, upload.bytes, contentType);
      await query('insert into banners (id, party_id, object_key, content_type) values ($1, $2, $3, $4)', [
        uploadId,
        partyId,
        key,
        contentType,
      ]);
      const bannerUrl = bannerUrlFor(partyId, uploadId);
      await publishBanner({ query }, partyId, bannerUrl);
      await publishParty({ query }, partyId);
      ctx.send(201, { bannerUrl });
    },
    true,
  );

  router.add('GET', '/api/parties/:id/banner', async (ctx) => {
    const user = await currentUser(ctx);
    const partyId = ctx.param('id');
    await requireMembership({ query }, partyId, user.id);
    const banner = await currentBanner({ query }, partyId);
    if (!banner) throw fail('not_found');
    const bytes = await getObject(banner.object_key);
    if (!bytes) throw fail('not_found');
    ctx.sendBytes(200, bytes, { 'content-type': banner.content_type });
  });
}
