// Typed reads of the records the routes share.
import type { Layout, Lesson, LessonFile, LessonState, SessionState } from '../shared/wire';
import { one, rows, type Db, pool } from './db';
import { notFound } from './errors';

export interface ClassRow {
  id: string;
  world_id: string;
  owner_id: string;
  title: string;
  time_zone: string;
  code: string;
  layout: Layout;
}

export interface SessionRow {
  id: string;
  class_id: string;
  lesson_id: string;
  state: SessionState;
  starts_local: string;
  ends_local: string;
  starts_ms: number;
  ends_ms: number;
  current_slide: number;
  locked: boolean;
  final_seats: Record<string, string> | null;
  world_id: string;
  owner_id: string;
  title: string;
  time_zone: string;
  layout: Layout;
}

export interface LessonRow {
  id: string;
  class_id: string;
  title: string;
  ready: boolean;
}

export interface FileRow {
  id: string;
  lesson_id: string;
  name: string;
  kind: 'slide' | 'model';
  position: number;
  bytes: number;
  status: 'pending' | 'confirmed';
  content_type: string;
}

/** The class, or the 404 every caller gives for a class that is not there. */
export async function loadClass(id: string, db: Db = pool): Promise<ClassRow> {
  const found = await one<ClassRow>(db, 'SELECT id, world_id, owner_id, title, time_zone, code, layout FROM classes WHERE id = $1', [id]);
  if (!found) throw notFound();
  return found;
}

/** The session, or the 404 every caller gives for a session that is not there. */
export async function loadSession(id: string, db: Db = pool): Promise<SessionRow> {
  const found = await one<SessionRow>(
    db,
    `SELECT s.id, s.class_id, s.lesson_id, s.state, s.starts_local, s.ends_local, s.starts_ms, s.ends_ms, s.current_slide,
            s.locked, s.final_seats, c.world_id, c.owner_id, c.title, c.time_zone, c.layout
       FROM sessions s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`,
    [id],
  );
  if (!found) throw notFound();
  return found;
}

/** The lesson, or the 404 every caller gives for a lesson that is not there. */
export async function loadLesson(id: string, db: Db = pool): Promise<LessonRow> {
  const found = await one<LessonRow>(db, 'SELECT id, class_id, title, ready FROM lessons WHERE id = $1', [id]);
  if (!found) throw notFound();
  return found;
}

export function lessonStateOf(ready: boolean, files: { status: string }[]): LessonState {
  if (files.some((file) => file.status === 'pending')) return 'uploading';
  return ready ? 'ready' : 'draft';
}

export async function lessonFiles(lessonId: string, db: Db = pool): Promise<FileRow[]> {
  return rows<FileRow>(
    db,
    `SELECT id, lesson_id, name, kind, position, bytes, status, content_type
       FROM lesson_files WHERE lesson_id = $1 ORDER BY position, id`,
    [lessonId],
  );
}

/** The files of one kind in their order, each with its 1-based number. */
export function numbered(files: FileRow[], kind: FileRow['kind']): { file: FileRow; number: number }[] {
  return files.filter((file) => file.kind === kind).map((file, index) => ({ file, number: index + 1 }));
}

export async function lessonView(lesson: LessonRow, db: Db = pool): Promise<Lesson> {
  const files = await lessonFiles(lesson.id, db);
  const describe = (kind: FileRow['kind']): LessonFile[] =>
    numbered(files, kind).map(({ file, number }) => ({ fileId: file.id, name: file.name, number, bytes: file.bytes, status: file.status }));
  return {
    id: lesson.id,
    classId: lesson.class_id,
    title: lesson.title,
    state: lessonStateOf(lesson.ready, files),
    slides: describe('slide'),
    models: describe('model'),
  };
}
