import { pool } from './db.js'

// Who may open what, decided in one place (DP-34). Everything a caller cannot
// open answers 404; a role refusal inside something they can open answers 403.

export interface ClassRecord {
  id: string
  worldId: string
  ownerId: string
  title: string
  timeZone: string
  code: string
  layout: unknown
}

export interface LessonRecord {
  id: string
  worldId: string
  classId: string
  title: string
  state: 'draft' | 'uploading' | 'ready'
}

export interface SessionRecord {
  id: string
  worldId: string
  classId: string
  lessonId: string
  state: 'scheduled' | 'open' | 'live' | 'breakouts' | 'ended'
  startsAt: Date
  endsAt: Date
  currentSlide: number
  locked: boolean
  handsTaken: number
  breakoutRounds: number
  endedAt: Date | null
}

export interface ClassAccess {
  record: ClassRecord
  role: 'owner' | 'co-teacher' | 'learner-enrolled' | null
}

/** Who may open a class: its owner, its co-teachers and its enrolled learners. */
export async function loadClassIfOpen(callerId: string | null, callerKind: 'teacher' | 'learner' | null, classId: string): Promise<ClassAccess | null> {
  const answer = await pool.query<ClassRecord>(
    `SELECT id, world_id, owner_id, title, time_zone, code, layout FROM classes WHERE id = $1`,
    [classId]
  )
  const record = answer.rows[0]
  if (!record) return null
  if (callerKind === 'teacher' && callerId) {
    if (record.ownerId === callerId) return { record, role: 'owner' }
    const co = await pool.query(
      `SELECT 1 FROM co_teachers WHERE class_id = $1 AND teacher_id = $2`,
      [classId, callerId]
    )
    if (co.rows.length > 0) return { record, role: 'co-teacher' }
    return null
  }
  if (callerKind === 'learner' && callerId) {
    const enrolled = await pool.query(
      `SELECT 1 FROM enrolments WHERE class_id = $1 AND learner_id = $2`,
      [classId, callerId]
    )
    if (enrolled.rows.length > 0) return { record, role: 'learner-enrolled' }
    // A learner of the class who is not enrolled still cannot open the class
    // page itself: the class-level APIs answer 404 for learners.
    return null
  }
  return null
}

export async function classRole(classId: string, teacherId: string): Promise<'owner' | 'co-teacher' | null> {
  const answer = await pool.query<ClassRecord>(
    `SELECT owner_id FROM classes WHERE id = $1`,
    [classId]
  )
  const record = answer.rows[0]
  if (!record) return null
  if (record.ownerId === teacherId) return 'owner'
  const co = await pool.query(
    `SELECT 1 FROM co_teachers WHERE class_id = $1 AND teacher_id = $2`,
    [classId, teacherId]
  )
  return co.rows.length > 0 ? 'co-teacher' : null
}

export async function loadLessonIfOpen(callerId: string | null, callerKind: 'teacher' | 'learner' | null, lessonId: string): Promise<LessonRecord | null> {
  const answer = await pool.query<LessonRecord>(
    `SELECT id, world_id, class_id, title, state FROM lessons WHERE id = $1`,
    [lessonId]
  )
  const record = answer.rows[0]
  if (!record) return null
  const access = await loadClassIfOpen(callerId, callerKind, record.classId)
  if (!access) return null
  if (access.role === 'learner-enrolled') return null
  return record
}

export interface SessionAccess {
  record: SessionRecord
  classRecord: ClassRecord
  lesson: LessonRecord
  role: 'owner' | 'co-teacher' | 'teacher-role'
  learnerId: string | null
  isLearner: boolean
}

/** Who may open a session (DP-33). */
export async function loadSessionIfOpen(
  callerId: string | null,
  callerKind: 'teacher' | 'learner' | null,
  sessionId: string
): Promise<SessionAccess | null> {
  const answer = await pool.query<SessionRecord>(
    `SELECT id, world_id, class_id, lesson_id, state, starts_at, ends_at, current_slide,
            locked, hands_taken, breakout_rounds, ended_at
     FROM sessions WHERE id = $1`,
    [sessionId]
  )
  const record = answer.rows[0]
  if (!record) return null
  const classAnswer = await pool.query<ClassRecord>(
    `SELECT id, world_id, owner_id, title, time_zone, code, layout FROM classes WHERE id = $1`,
    [record.classId]
  )
  const classRecord = classAnswer.rows[0]
  if (!classRecord) return null
  const lessonAnswer = await pool.query<LessonRecord>(
    `SELECT id, world_id, class_id, title, state FROM lessons WHERE id = $1`,
    [record.lessonId]
  )
  const lesson = lessonAnswer.rows[0]
  if (!lesson) return null

  if (callerKind === 'teacher' && callerId) {
    const role = await classRole(record.classId, callerId)
    if (role === 'owner') {
      return { record, classRecord, lesson, role: 'owner', learnerId: null, isLearner: false }
    }
    if (role === 'co-teacher') {
      return { record, classRecord, lesson, role: 'co-teacher', learnerId: null, isLearner: false }
    }
    // A teacher who is neither owner nor co-teacher gets 404 from every
    // session-level API of that class.
    return null
  }
  if (callerKind === 'learner' && callerId) {
    const joined = await pool.query(
      `SELECT 1 FROM session_learners WHERE session_id = $1 AND learner_id = $2`,
      [sessionId, callerId]
    )
    const seeded = await pool.query(
      `SELECT 1 FROM presence_intervals WHERE session_id = $1 AND learner_id = $2 LIMIT 1`,
      [sessionId, callerId]
    )
    if (joined.rows.length > 0 || seeded.rows.length > 0) {
      return { record, classRecord, lesson, role: 'teacher-role', learnerId: callerId, isLearner: true }
    }
    return null
  }
  return null
}

/** The roster of a session: everyone who joined plus everyone seeded. */
export async function sessionRoster(sessionId: string): Promise<string[]> {
  const answer = await pool.query<{ learner_id: string }>(
    `SELECT DISTINCT learner_id FROM (
       SELECT learner_id FROM session_learners WHERE session_id = $1
       UNION
       SELECT learner_id FROM presence_intervals WHERE session_id = $1
     ) roster ORDER BY learner_id`,
    [sessionId]
  )
  return answer.rows.map((row) => row.learner_id)
}

export async function isEnrolled(classId: string, learnerId: string): Promise<boolean> {
  const answer = await pool.query(
    `SELECT 1 FROM enrolments WHERE class_id = $1 AND learner_id = $2`,
    [classId, learnerId]
  )
  return answer.rows.length > 0
}

/** A teacher's role for a poll, or null when the poll is missing. */
export async function pollAccess(pollId: string): Promise<{ sessionId: string; classId: string } | null> {
  const answer = await pool.query<{ session_id: string; class_id: string }>(
    `SELECT p.session_id, s.class_id FROM polls p JOIN sessions s ON s.id = p.session_id WHERE p.id = $1`,
    [pollId]
  )
  const row = answer.rows[0]
  return row ? { sessionId: row.session_id, classId: row.class_id } : null
}
