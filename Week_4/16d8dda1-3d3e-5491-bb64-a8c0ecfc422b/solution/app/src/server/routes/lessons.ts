import type { PoolClient } from 'pg';
import type { ClassRole, Lesson } from '../../shared/wire';
import { authenticate, learnerCanOpen, openClass, requireOwner, type Caller } from '../access';
import { config } from '../config';
import { count, one, pool, rows, run, sole, tx } from '../db';
import { detectFile, type Detected } from '../domain/files';
import { notFound, Refusal, STORAGE_LOAD, STORAGE_SAVE } from '../errors';
import { characters, param, readBody, reply, STREAMED, textOf, UPLOAD_LIMIT, type Route } from '../http';
import { newId } from '../ids';
import { parseMultipart } from '../multipart';
import { deleteObject, getObject, lessonFileKey, putObject, storedBytes, StorageDown } from '../objects';
import { lessonFiles, lessonStateOf, lessonView, loadLesson, type FileRow, type LessonRow } from '../records';

const TAUGHT = 'This lesson is being taught right now.';

/** A lesson of a class the caller owns or co-teaches; anyone else gets 404. */
async function openLesson(caller: Caller, lessonId: string): Promise<{ lesson: LessonRow; role: ClassRole }> {
  const lesson = await loadLesson(lessonId);
  const { role } = await openClass(caller, lesson.class_id);
  return { lesson, role };
}

async function openLessonAsOwner(caller: Caller, lessonId: string): Promise<LessonRow> {
  const { lesson, role } = await openLesson(caller, lessonId);
  requireOwner(role);
  return lesson;
}

async function requireNotTaught(lessonId: string): Promise<void> {
  const taught = await one(pool, "SELECT 1 AS found FROM sessions WHERE lesson_id = $1 AND state IN ('live', 'breakouts')", [lessonId]);
  if (taught) throw new Refusal(409, TAUGHT);
}

async function fileOf(lessonId: string, fileId: string): Promise<FileRow> {
  const file = await one<FileRow>(
    pool,
    'SELECT id, lesson_id, name, kind, position, bytes, status, content_type FROM lesson_files WHERE id = $1 AND lesson_id = $2',
    [fileId, lessonId],
  );
  if (!file) throw notFound();
  return file;
}

async function nextPosition(client: PoolClient, lessonId: string, kind: string): Promise<number> {
  const top = await sole<{ top: number }>(client, 'SELECT COALESCE(MAX(position), -1) AS top FROM lesson_files WHERE lesson_id = $1 AND kind = $2', [lessonId, kind]);
  return top.top + 1;
}

interface Accepted extends Detected {
  id: string;
  name: string;
  data: Buffer;
}

/** Judges the files one at a time in request order: kind, then size, then the slide count. */
function acceptFiles(files: { name: string; data: Buffer }[], existingSlides: number): Accepted[] {
  const accepted: Accepted[] = [];
  let slides = existingSlides;
  for (const file of files) {
    const detected = detectFile(file.data);
    if (!detected) throw new Refusal(422, `${file.name} isn't a PNG, JPEG or glTF binary.`);
    const limit = detected.kind === 'slide' ? config.slideMaxBytes : config.modelMaxBytes;
    if (file.data.length > limit) throw new Refusal(413, `${file.name} is larger than the limit.`);
    if (detected.kind === 'slide') {
      slides += 1;
      if (slides > config.slidesMaxPerLesson) throw new Refusal(422, `A lesson holds at most ${config.slidesMaxPerLesson} slides.`);
    }
    accepted.push({ ...detected, id: newId('fil'), name: file.name, data: file.data });
  }
  return accepted;
}

async function storeAll(lesson: LessonRow, accepted: Accepted[]): Promise<void> {
  const wasReady = lesson.ready;
  await tx(async (client) => {
    // Uploads to one lesson take turns here, and the slide limit is checked again on the rows as they are now.
    await client.query('SELECT id FROM lessons WHERE id = $1 FOR UPDATE', [lesson.id]);
    const held = await sole<{ n: number }>(client, "SELECT count(*) AS n FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide'", [lesson.id]);
    if (held.n + accepted.filter((file) => file.kind === 'slide').length > config.slidesMaxPerLesson) {
      throw new Refusal(422, `A lesson holds at most ${config.slidesMaxPerLesson} slides.`);
    }
    const next = { slide: await nextPosition(client, lesson.id, 'slide'), model: await nextPosition(client, lesson.id, 'model') };
    for (const file of accepted) {
      const position = next[file.kind];
      next[file.kind] += 1;
      await run(
        client,
        "INSERT INTO lesson_files (id, lesson_id, name, kind, position, bytes, status, content_type) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)",
        [file.id, lesson.id, file.name, file.kind, position, file.data.length, file.contentType],
      );
    }
    await run(client, 'UPDATE lessons SET ready = false WHERE id = $1', [lesson.id]);
  });
  try {
    for (const file of accepted) {
      const key = lessonFileKey(lesson.id, file.id);
      await putObject(key, file.data, file.contentType);
      if ((await storedBytes(key)) !== file.data.length) throw new StorageDown('stored byte count differs');
    }
  } catch (error) {
    await Promise.all(accepted.map((file) => deleteObject(lessonFileKey(lesson.id, file.id)).catch(() => undefined)));
    await run(pool, 'DELETE FROM lesson_files WHERE id = ANY($1)', [accepted.map((file) => file.id)]);
    await run(pool, 'UPDATE lessons SET ready = $2 WHERE id = $1', [lesson.id, wasReady]);
    if (error instanceof StorageDown) throw new Refusal(503, STORAGE_SAVE);
    throw error;
  }
  await run(pool, "UPDATE lesson_files SET status = 'confirmed' WHERE id = ANY($1)", [accepted.map((file) => file.id)]);
}

/** The lesson as it is now, after a change. */
async function freshLesson(lessonId: string): Promise<Lesson> {
  return lessonView(await loadLesson(lessonId));
}

export const lessonRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/classes/:id/lessons',
    handler: async (ctx) => {
      const { cls, role } = await openClass(await authenticate(ctx.req), param(ctx.params, 'id'));
      requireOwner(role);
      const title = textOf((await ctx.json()).title)?.trim() ?? '';
      if (characters(title) < 1 || characters(title) > 120) throw new Refusal(422, 'Give the lesson a title of 1 to 120 characters.');
      const id = newId('les');
      await run(pool, 'INSERT INTO lessons (id, class_id, title) VALUES ($1, $2, $3)', [id, cls.id, title]);
      return reply(201, await freshLesson(id));
    },
  },
  {
    method: 'GET',
    path: '/api/lessons/:id',
    handler: async (ctx) => {
      const { lesson } = await openLesson(await authenticate(ctx.req), param(ctx.params, 'id'));
      return reply(200, await lessonView(lesson));
    },
  },
  {
    method: 'POST',
    path: '/api/lessons/:id/files',
    handler: async (ctx) => {
      const lesson = await openLessonAsOwner(await authenticate(ctx.req), param(ctx.params, 'id'));
      await requireNotTaught(lesson.id);
      const body = await readBody(ctx.req, UPLOAD_LIMIT);
      const files = parseMultipart(body, ctx.req.headers['content-type'] ?? '')
        .filter((part) => part.name === 'files' && part.filename !== undefined)
        .map((part) => ({ name: part.filename ?? '', data: part.data }));
      if (files.length === 0) throw new Refusal(422, 'Choose at least one file.');
      const existing = (await lessonFiles(lesson.id)).filter((file) => file.kind === 'slide').length;
      await storeAll(lesson, acceptFiles(files, existing));
      return reply(201, await freshLesson(lesson.id));
    },
  },
  {
    method: 'DELETE',
    path: '/api/lessons/:id/files/:fileId',
    handler: async (ctx) => {
      const lesson = await openLessonAsOwner(await authenticate(ctx.req), param(ctx.params, 'id'));
      const file = await fileOf(lesson.id, param(ctx.params, 'fileId')); // 404 before 409 (error order)
      await requireNotTaught(lesson.id);
      try {
        await deleteObject(lessonFileKey(lesson.id, file.id));
      } catch (error) {
        if (error instanceof StorageDown) throw new Refusal(503, STORAGE_SAVE);
        throw error;
      }
      await run(pool, 'DELETE FROM lesson_files WHERE id = $1', [file.id]);
      const slides = await count(pool, "SELECT count(*) AS n FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide'", [lesson.id]);
      if (slides === 0) await run(pool, 'UPDATE lessons SET ready = false WHERE id = $1', [lesson.id]);
      return reply(200, await freshLesson(lesson.id));
    },
  },
  {
    method: 'PUT',
    path: '/api/lessons/:id/order',
    handler: async (ctx) => {
      const lesson = await openLessonAsOwner(await authenticate(ctx.req), param(ctx.params, 'id'));
      await requireNotTaught(lesson.id);
      const listed = (await ctx.json()).slideIds;
      const slides = (await lessonFiles(lesson.id)).filter((file) => file.kind === 'slide').map((file) => file.id);
      const ids = Array.isArray(listed) ? listed : [];
      const complete = ids.length === slides.length && new Set(ids).size === ids.length && ids.every((id) => typeof id === 'string' && slides.includes(id));
      if (!Array.isArray(listed) || !complete) throw new Refusal(422, 'List every slide once.');
      await tx(async (client) => {
        for (const [position, id] of ids.entries()) await run(client, 'UPDATE lesson_files SET position = $2 WHERE id = $1', [id, position]);
      });
      return reply(200, await freshLesson(lesson.id));
    },
  },
  {
    method: 'POST',
    path: '/api/lessons/:id/ready',
    handler: async (ctx) => {
      const lesson = await openLessonAsOwner(await authenticate(ctx.req), param(ctx.params, 'id'));
      const files = await lessonFiles(lesson.id);
      if (lessonStateOf(false, files) === 'uploading') throw new Refusal(409, "Some files aren't confirmed yet.");
      if (!files.some((file) => file.kind === 'slide')) throw new Refusal(409, 'Add at least one slide first.');
      await run(pool, 'UPDATE lessons SET ready = true WHERE id = $1', [lesson.id]);
      return reply(200, await freshLesson(lesson.id));
    },
  },
  {
    method: 'GET',
    path: '/api/files/:id',
    handler: async (ctx) => {
      const caller = await authenticate(ctx.req);
      const file = await one<FileRow & { class_id: string }>(
        pool,
        `SELECT f.id, f.lesson_id, f.name, f.kind, f.position, f.bytes, f.status, f.content_type, l.class_id
           FROM lesson_files f JOIN lessons l ON l.id = f.lesson_id WHERE f.id = $1 AND f.status = 'confirmed'`,
        [param(ctx.params, 'id')],
      );
      if (!file) throw notFound();
      if (caller.kind === 'teacher') {
        await openClass(caller, file.class_id);
      } else {
        const sessions = await rows<{ id: string }>(pool, 'SELECT id FROM sessions WHERE lesson_id = $1', [file.lesson_id]);
        const allowed = await Promise.all(sessions.map((session) => learnerCanOpen(session.id, caller.id)));
        if (!allowed.some(Boolean)) throw notFound();
      }
      let data: Buffer;
      try {
        data = Buffer.from(await (await getObject(lessonFileKey(file.lesson_id, file.id))).arrayBuffer());
      } catch (error) {
        if (error instanceof StorageDown) throw new Refusal(503, STORAGE_LOAD);
        throw error;
      }
      ctx.res.writeHead(200, { 'content-type': file.content_type, 'content-length': data.length, 'cache-control': 'private, max-age=300' });
      ctx.res.end(data);
      return STREAMED;
    },
  },
];
