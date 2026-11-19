import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import type { LessonFileJson, LessonJson, LessonState } from '../../shared/types.js';
import { ApiError, asString, errors, readJsonBody, sendJson } from '../http.js';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { newId } from '../ids.js';
import { judgeUpload, type JudgedFile, type UploadPart } from '../domain/files.js';
import { objectKeyFor, store, StorageError } from '../storage.js';
import { openClass, openLesson, requireClassOwner, requireViewer, type Viewer } from '../access.js';
import type { Router } from '../router.js';

interface FileRow {
  id: string;
  lesson_id: string;
  kind: string;
  name: string;
  content_type: string;
  bytes: number;
  status: string;
  position: number;
}

async function lessonBody(lessonId: string): Promise<LessonJson> {
  const lesson = await queryOne<{ id: string; class_id: string; title: string; state: LessonState }>(
    'SELECT id, class_id, title, state FROM lessons WHERE id = $1',
    [lessonId]
  );
  if (lesson === null) throw errors.notFound();
  const files = await query<FileRow>(
    'SELECT * FROM lesson_files WHERE lesson_id = $1 ORDER BY position ASC, created_at ASC',
    [lessonId]
  );
  const toJson = (rows: FileRow[]): LessonFileJson[] =>
    rows.map((row, index) => ({
      fileId: row.id,
      name: row.name,
      number: index + 1,
      bytes: row.bytes,
      status: row.status === 'confirmed' ? 'confirmed' : 'pending'
    }));
  return {
    id: lesson.id,
    classId: lesson.class_id,
    title: lesson.title,
    state: lesson.state,
    slides: toJson(files.filter((file) => file.kind === 'slide')),
    models: toJson(files.filter((file) => file.kind === 'model'))
  };
}

/** DP-16: a lesson is `uploading` while any file is pending, and `draft` otherwise. */
async function settleLessonState(lessonId: string): Promise<void> {
  const lesson = await queryOne<{ state: LessonState }>('SELECT state FROM lessons WHERE id = $1', [lessonId]);
  if (lesson === null) return;
  const pending = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM lesson_files WHERE lesson_id = $1 AND status = 'pending'",
    [lessonId]
  );
  const slides = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide'",
    [lessonId]
  );
  const next: LessonState =
    (pending?.count ?? 0) > 0 ? 'uploading' : lesson.state === 'ready' && (slides?.count ?? 0) > 0 ? 'ready' : 'draft';
  if (next !== lesson.state) await query('UPDATE lessons SET state = $2 WHERE id = $1', [lessonId, next]);
}

async function requireQuietLesson(lessonId: string): Promise<void> {
  const teaching = await queryOne<{ id: string }>(
    `SELECT s.id FROM sessions s WHERE s.lesson_id = $1 AND s.state IN ('live', 'breakouts')`,
    [lessonId]
  );
  if (teaching !== null) throw new ApiError(409, 'This lesson is being taught right now.');
}

async function readParts(req: IncomingMessage): Promise<UploadPart[]> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > config.maxUploadBytes) throw errors.tooLarge();
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'multipart/form-data') throw errors.sendJson();
  return new Promise<UploadPart[]>((resolve, reject) => {
    const parts: UploadPart[] = [];
    const parser = busboy({ headers: req.headers, limits: { fileSize: config.maxUploadBytes } });
    let total = 0;
    parser.on('file', (field, stream, info) => {
      if (field !== 'files') {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        chunks.push(chunk);
      });
      stream.on('limit', () => reject(errors.tooLarge()));
      stream.on('end', () => {
        if (total > config.maxUploadBytes) {
          reject(errors.tooLarge());
          return;
        }
        parts.push({ name: info.filename, bytes: Buffer.concat(chunks) });
      });
    });
    parser.on('close', () => resolve(parts));
    parser.on('error', (error) => reject(error));
    req.pipe(parser);
  });
}

async function storeFiles(lessonId: string, judged: JudgedFile[], startingSlides: number, startingModels: number): Promise<void> {
  const created: { fileId: string; objectKey: string }[] = [];
  let slidePosition = startingSlides;
  let modelPosition = startingModels;
  try {
    for (const file of judged) {
      const fileId = newId('fil');
      const position = file.kind === 'slide' ? (slidePosition += 1) : (modelPosition += 1);
      await query(
        `INSERT INTO lesson_files (id, lesson_id, kind, name, content_type, bytes, status, position)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
        [fileId, lessonId, file.kind, file.name, file.contentType, file.bytes.byteLength, position]
      );
      created.push({ fileId, objectKey: objectKeyFor(lessonId, fileId) });
      await store.put(objectKeyFor(lessonId, fileId), file.bytes, file.contentType);
      const confirmed = await store.confirm(objectKeyFor(lessonId, fileId), file.bytes.byteLength);
      if (!confirmed) throw new StorageError(`${file.name} was not confirmed`);
      await query("UPDATE lesson_files SET status = 'confirmed' WHERE id = $1", [fileId]);
    }
  } catch (error) {
    for (const entry of created) {
      await query('DELETE FROM lesson_files WHERE id = $1', [entry.fileId]);
      await store.remove(entry.objectKey).catch(() => undefined);
    }
    if (error instanceof StorageError) throw errors.filesUnsaved();
    throw error;
  }
}

async function fileForViewer(viewer: Viewer, fileId: string): Promise<FileRow> {
  const file = await queryOne<FileRow>('SELECT * FROM lesson_files WHERE id = $1', [fileId]);
  if (file === null) throw errors.notFound();
  const lesson = await queryOne<{ class_id: string }>('SELECT class_id FROM lessons WHERE id = $1', [file.lesson_id]);
  if (lesson === null) throw errors.notFound();
  if (viewer.kind === 'teacher') {
    await openClass(viewer, lesson.class_id);
    return file;
  }
  const allowed = await queryOne<{ id: string }>(
    `SELECT s.id FROM sessions s
       JOIN session_learners sl ON sl.session_id = s.id AND sl.learner_id = $2
      WHERE s.lesson_id = $1 AND s.world_id = $3
        AND (sl.via_join OR EXISTS (SELECT 1 FROM presence p WHERE p.session_id = s.id AND p.learner_id = $2))
      LIMIT 1`,
    [file.lesson_id, viewer.id, viewer.worldId]
  );
  if (allowed === null) throw errors.notFound();
  return file;
}

export function lessonRoutes(router: Router): void {
  router.add('POST', '/api/classes/:classId/lessons', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { cls, role } = await openClass(signedIn, params.classId as string);
    requireClassOwner(role);
    const body = await readJsonBody(req);
    const title = asString(body.title).trim();
    if (title.length < 1 || title.length > 120) {
      throw new ApiError(422, 'Give the lesson a title of 1 to 120 characters.');
    }
    const id = newId('les');
    await query("INSERT INTO lessons (id, world_id, class_id, title, state) VALUES ($1, $2, $3, $4, 'draft')", [
      id,
      cls.world_id,
      cls.id,
      title
    ]);
    sendJson(res, 201, await lessonBody(id));
  });

  router.add('GET', '/api/lessons/:lessonId', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { lesson } = await openLesson(signedIn, params.lessonId as string);
    sendJson(res, 200, await lessonBody(lesson.id));
  });

  router.add('POST', '/api/lessons/:lessonId/files', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { lesson, role } = await openLesson(signedIn, params.lessonId as string);
    requireClassOwner(role);
    await requireQuietLesson(lesson.id);
    const parts = await readParts(req);
    const existing = await query<{ kind: string }>('SELECT kind FROM lesson_files WHERE lesson_id = $1', [lesson.id]);
    const slides = existing.filter((file) => file.kind === 'slide').length;
    const models = existing.length - slides;
    const judged = judgeUpload(parts, slides);
    await query("UPDATE lessons SET state = 'uploading' WHERE id = $1 AND state <> 'uploading'", [lesson.id]);
    try {
      await storeFiles(lesson.id, judged, slides, models);
    } finally {
      await settleLessonState(lesson.id);
    }
    sendJson(res, 201, await lessonBody(lesson.id));
  });

  router.add('DELETE', '/api/lessons/:lessonId/files/:fileId', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { lesson, role } = await openLesson(signedIn, params.lessonId as string);
    requireClassOwner(role);
    const file = await queryOne<FileRow>('SELECT * FROM lesson_files WHERE id = $1 AND lesson_id = $2', [
      params.fileId as string,
      lesson.id
    ]);
    if (file === null) throw errors.notFound();
    await requireQuietLesson(lesson.id);
    await query('DELETE FROM lesson_files WHERE id = $1', [file.id]);
    try {
      await store.remove(objectKeyFor(lesson.id, file.id));
    } catch (error) {
      if (error instanceof StorageError) throw errors.filesUnsaved();
      throw error;
    }
    await settleLessonState(lesson.id);
    sendJson(res, 200, await lessonBody(lesson.id));
  });

  router.add('PUT', '/api/lessons/:lessonId/order', async ({ req, res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { lesson, role } = await openLesson(signedIn, params.lessonId as string);
    requireClassOwner(role);
    await requireQuietLesson(lesson.id);
    const body = await readJsonBody(req);
    const slideIds = Array.isArray(body.slideIds) ? body.slideIds.map((id) => (typeof id === 'string' ? id : '')) : [];
    const current = await query<{ id: string }>(
      "SELECT id FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide' ORDER BY position ASC",
      [lesson.id]
    );
    const expected = new Set(current.map((row) => row.id));
    const listed = new Set(slideIds);
    if (slideIds.length !== expected.size || listed.size !== slideIds.length || [...listed].some((id) => !expected.has(id))) {
      throw new ApiError(422, 'List every slide once.');
    }
    for (const [index, fileId] of slideIds.entries()) {
      await query('UPDATE lesson_files SET position = $2 WHERE id = $1', [fileId, index + 1]);
    }
    sendJson(res, 200, await lessonBody(lesson.id));
  });

  router.add('POST', '/api/lessons/:lessonId/ready', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const { lesson, role } = await openLesson(signedIn, params.lessonId as string);
    requireClassOwner(role);
    const files = await query<{ kind: string; status: string }>(
      'SELECT kind, status FROM lesson_files WHERE lesson_id = $1',
      [lesson.id]
    );
    if (files.some((file) => file.status === 'pending')) {
      throw new ApiError(409, "Some files aren't confirmed yet.");
    }
    if (!files.some((file) => file.kind === 'slide')) {
      throw new ApiError(409, 'Add at least one slide first.');
    }
    await query("UPDATE lessons SET state = 'ready' WHERE id = $1", [lesson.id]);
    sendJson(res, 200, await lessonBody(lesson.id));
  });

  router.add('GET', '/api/files/:fileId', async ({ res, viewer, params }) => {
    const signedIn = requireViewer(viewer);
    const file = await fileForViewer(signedIn, params.fileId as string);
    let bytes: Buffer | null;
    try {
      bytes = await store.get(objectKeyFor(file.lesson_id, file.id));
    } catch (error) {
      if (error instanceof StorageError) throw errors.filesUnreadable();
      throw error;
    }
    if (bytes === null) throw errors.notFound();
    res.writeHead(200, {
      'content-type': file.content_type,
      'content-length': bytes.byteLength,
      'cache-control': 'private, max-age=60',
      'x-slatehall-instance': config.instanceName
    });
    res.end(bytes);
  });
}
