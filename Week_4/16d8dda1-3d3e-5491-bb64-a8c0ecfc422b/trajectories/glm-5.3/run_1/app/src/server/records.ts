import { pool } from './db.js'
import { arrangeRoom, type ArrangedRoom, type Layout } from '../shared/rules.js'
import { utcToWallString, validZone, wallParts, localToUtc } from './walltime.js'
import type { ClassRecord, LessonRecord, SessionRecord } from './access.js'

// Reading and shaping the records the pages see.

export function arrangedRoom(layout: Layout): ArrangedRoom {
  const answer = arrangeRoom(layout)
  if ('error' in answer) throw new Error(answer.error)
  return answer.room
}

export async function loadClass(classId: string): Promise<ClassRecord | null> {
  const answer = await pool.query<ClassRecord>(
    `SELECT id, world_id, owner_id, title, time_zone, code, layout FROM classes WHERE id = $1`,
    [classId]
  )
  return answer.rows[0] ?? null
}

export async function loadLesson(lessonId: string): Promise<LessonRecord | null> {
  const answer = await pool.query<LessonRecord>(
    `SELECT id, world_id, class_id, title, state FROM lessons WHERE id = $1`,
    [lessonId]
  )
  return answer.rows[0] ?? null
}

export async function loadSession(sessionId: string): Promise<SessionRecord | null> {
  const answer = await pool.query<SessionRecord>(
    `SELECT id, world_id, class_id, lesson_id, state, starts_at, ends_at, current_slide,
            locked, hands_taken, breakout_rounds, ended_at
     FROM sessions WHERE id = $1`,
    [sessionId]
  )
  return answer.rows[0] ?? null
}

export function sessionTimes(record: SessionRecord, zone: string): {
  startsAt: string, endsAt: string, startsAtUtc: string, endsAtUtc: string
} {
  return {
    startsAt: utcToWallString(zone, record.startsAt),
    endsAt: utcToWallString(zone, record.endsAt),
    startsAtUtc: record.startsAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    endsAtUtc: record.endsAt.toISOString().replace(/\.\d{3}Z$/, 'Z')
  }
}

/** Parses a wall time in the class zone, with the DP-26 refusals. */
export function parseWallTime(zone: string, wall: string): { at: Date | null; error?: string } {
  const parts = wallParts(wall)
  if (!parts) return { at: null, error: 'Use a date and time like 2027-03-09T19:00.' }
  const { at, skipped } = localToUtc(zone, parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second)
  if (skipped) return { at: null, error: `That time doesn't exist in ${zone}.` }
  return { at }
}

export async function lessonFiles(lessonId: string): Promise<{
  slides: { fileId: string; name: string; number: number; bytes: number; status: 'pending' | 'confirmed' }[]
  models: { fileId: string; name: string; number: number; bytes: number; status: 'pending' | 'confirmed' }[]
}> {
  const answer = await pool.query<{
    id: string; kind: 'slide' | 'model'; name: string; number: number; bytes: number; status: 'pending' | 'confirmed'
  }>(
    `SELECT id, kind, name, number, bytes, status FROM lesson_files WHERE lesson_id = $1
     ORDER BY number ASC`,
    [lessonId]
  )
  const slides: { fileId: string; name: string; number: number; bytes: number; status: 'pending' | 'confirmed' }[] = []
  const models: typeof slides = []
  for (const row of answer.rows) {
    const file = { fileId: row.id, name: row.name, number: row.number, bytes: row.bytes, status: row.status }
    if (row.kind === 'slide') slides.push(file)
    else models.push(file)
  }
  return { slides, models }
}

export function validTimeZone(zone: string): boolean {
  return validZone(zone)
}
