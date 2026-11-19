// Account, class and lesson routes (DP-01, DP-02, DP-03, DP-15, DP-16, DP-17).

import { type Router } from 'express'
import { pool } from './db.js'
import { NOT_FOUND, ROLE_REFUSAL } from './apiError.js'
import {
  checkPassword, hashPassword, validEmail, createSessionCookie,
  createTeacherSession, deleteSessionCookie
} from './auth.js'
import { id as makeId, classCode } from './ids.js'
import { arrangeRoom, STARTING_LAYOUT, type Layout } from '../shared/rules.js'
import { arrangedRoom, loadClass, loadLesson, loadSession, lessonFiles, validTimeZone, parseWallTime } from './records.js'
import { loadClassIfOpen, loadLessonIfOpen } from './access.js'
import { buildSnapshot } from './snapshot.js'
import { zoneOptions, utcToWallString } from './walltime.js'
import { caller, teacherOnly, setSessionCookie, clearSessionCookie, fail, cookieToken, body } from './web.js'

export function registerAccountRoutes(router: Router): void {
  router.post('/teachers', async (req, res) => {
    const { email, password, displayName } = body<{ email?: string; password?: string; displayName?: string }>(req)
    const trimmedEmail = (email ?? '').trim()
    if (!validEmail(trimmedEmail)) return fail(res, 422, 'Enter a valid email address.')
    if (typeof password !== 'string' || password.length < 10) return fail(res, 422, 'Use at least 10 characters for your password.')
    const name = (displayName ?? '').trim()
    if (name.length < 1 || name.length > 60) return fail(res, 422, 'Enter a name of 1 to 60 characters.')
    const existing = await pool.query(
      `SELECT 1 FROM teachers WHERE lower(email) = lower($1) AND world_id = 'default'`,
      [trimmedEmail]
    )
    if (existing.rows.length > 0) return fail(res, 409, 'An account with that email already exists.')
    const teacherId = makeId('tch')
    const hash = await hashPassword(password)
    await pool.query(
      `INSERT INTO teachers (id, world_id, email, password_hash, display_name)
       VALUES ($1, 'default', $2, $3, $4)`,
      [teacherId, trimmedEmail, hash, name]
    )
    const token = await createSessionCookie()
    await createTeacherSession(token, teacherId)
    setSessionCookie(res, token)
    res.status(201).json({ id: teacherId, email: trimmedEmail, displayName: name })
  })

  router.post('/sign-in', async (req, res) => {
    const { email, password } = body<{ email?: string; password?: string }>(req)
    const answer = await pool.query<{ id: string; email: string; password_hash: string; display_name: string }>(
      `SELECT id, email, password_hash, display_name FROM teachers
       WHERE lower(email) = lower($1) AND world_id = 'default'`,
      [(email ?? '').trim()]
    )
    const row = answer.rows[0]
    if (!row || typeof password !== 'string' || !(await checkPassword(password, row.password_hash))) {
      return fail(res, 401, 'Email or password is wrong.')
    }
    const token = await createSessionCookie()
    await createTeacherSession(token, row.id)
    setSessionCookie(res, token)
    res.status(200).json({ id: row.id, email: row.email, displayName: row.display_name })
  })

  router.post('/sign-out', async (req, res) => {
    const token = cookieToken(req)
    if (token) await deleteSessionCookie(token)
    clearSessionCookie(res)
    res.status(204).end()
  })

  router.get('/me', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'teacher') {
      res.status(200).json({
        role: 'teacher', id: who.teacher.id, email: who.teacher.email, displayName: who.teacher.displayName
      })
      return
    }
    if (who.kind === 'learner') {
      res.status(200).json({ role: 'learner', id: who.learner.id, displayName: who.learner.displayName })
      return
    }
    fail(res, 401, 'Sign in first.')
  })

  router.get('/time-zones', async (_req, res) => {
    res.status(200).json({ zones: zoneOptions() })
  })
}

export function registerClassRoutes(router: Router): void {
  router.get('/classes', async (req, res) => {
    const teacher = await teacherOnly(req, res)
    if (!teacher) return
    const answer = await pool.query(
      `SELECT c.id, c.title, c.time_zone, c.code,
              CASE WHEN c.owner_id = $1 THEN 'owner' ELSE 'co-teacher' END AS role
       FROM classes c
       LEFT JOIN co_teachers ct ON ct.class_id = c.id AND ct.teacher_id = $1
       WHERE c.owner_id = $1 OR ct.teacher_id = $1
       ORDER BY c.title`,
      [teacher.teacherId]
    )
    res.status(200).json({ classes: answer.rows })
  })

  router.post('/classes', async (req, res) => {
    const teacher = await teacherOnly(req, res)
    if (!teacher) return
    const { title, timeZone } = body<{ title?: string; timeZone?: string }>(req)
    const trimmed = (title ?? '').trim()
    if (trimmed.length < 1 || trimmed.length > 80) return fail(res, 422, 'Give the class a title of 1 to 80 characters.')
    if (!validTimeZone(timeZone ?? '')) return fail(res, 422, 'Choose a time zone from the list.')
    const classId = makeId('cls')
    let code = classCode()
    for (let attempt = 0; attempt < 10; attempt++) {
      const taken = await pool.query(`SELECT 1 FROM classes WHERE code = $1`, [code])
      if (taken.rows.length === 0) break
      code = classCode()
    }
    await pool.query(
      `INSERT INTO classes (id, world_id, owner_id, title, time_zone, code, layout)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [classId, teacher.worldId, teacher.teacherId, trimmed, timeZone, code, JSON.stringify(STARTING_LAYOUT)]
    )
    const record = await loadClass(classId)
    res.status(201).json({
      id: classId, title: trimmed, timeZone, code,
      layout: record?.layout ?? STARTING_LAYOUT
    })
  })

  router.get('/classes/:classId', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await loadClassIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      req.params.classId
    )
    if (!access || access.role === 'learner-enrolled') return fail(res, 404, NOT_FOUND.message)
    const classId = access.record.id
    const [coTeachers, lessons, sessions] = await Promise.all([
      pool.query(
        `SELECT t.id, t.display_name, t.email FROM co_teachers ct JOIN teachers t ON t.id = ct.teacher_id
         WHERE ct.class_id = $1 ORDER BY t.display_name`,
        [classId]
      ),
      pool.query(
        `SELECT id, title, state FROM lessons WHERE class_id = $1 ORDER BY title`,
        [classId]
      ),
      pool.query(
        `SELECT id, lesson_id, state, starts_at, ends_at FROM sessions WHERE class_id = $1 ORDER BY starts_at`,
        [classId]
      ),
    ])
    const zone = access.record.timeZone
    const room = arrangedRoom(access.record.layout as Layout)
    const wallSessions = sessions.rows.map((row: { id: string; lesson_id: string; state: string; starts_at: Date; ends_at: Date }) => ({
      id: row.id,
      lessonId: row.lesson_id,
      state: row.state,
      startsAt: utcToWallString(zone, row.starts_at),
      endsAt: utcToWallString(zone, row.ends_at)
    }))
    res.status(200).json({
      id: classId,
      title: access.record.title,
      timeZone: zone,
      code: access.record.code,
      layout: access.record.layout,
      seats: room.seats,
      tables: room.tables,
      coTeachers: coTeachers.rows,
      lessons: lessons.rows.map((row: { id: string; title: string; state: string }) => ({
        id: row.id, title: row.title, state: row.state
      })),
      sessions: wallSessions
    })
  })

  router.put('/classes/:classId/layout', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await loadClassIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      req.params.classId
    )
    if (!access || access.role === 'learner-enrolled') return fail(res, 404, NOT_FOUND.message)
    if (access.role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const running = await pool.query(
      `SELECT 1 FROM sessions WHERE class_id = $1 AND state IN ('open', 'live', 'breakouts')`,
      [access.record.id]
    )
    if (running.rows.length > 0) return fail(res, 409, "The room can't change during a live session.")
    const layout = body<Layout>(req)
    const checked = arrangeRoom(layout)
    if ('error' in checked) return fail(res, 422, checked.error)
    await pool.query(
      `UPDATE classes SET layout = $2 WHERE id = $1`,
      [access.record.id, JSON.stringify(layout)]
    )
    res.status(200).json({
      layout,
      seats: checked.room.seats,
      tables: checked.room.tables
    })
  })

  router.post('/classes/:classId/co-teachers', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await loadClassIfOpen(who.kind === 'teacher' ? who.teacher.id : null, 'teacher', req.params.classId)
    if (!access) return fail(res, 404, NOT_FOUND.message)
    if (access.role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const { email } = body<{ email?: string }>(req)
    const trimmed = (email ?? '').trim()
    const found = await pool.query<{ id: string; display_name: string; email: string }>(
      `SELECT id, display_name, email FROM teachers WHERE lower(email) = lower($1) AND world_id = $2`,
      [trimmed, access.record.worldId]
    )
    const teacher = found.rows[0]
    if (!teacher) return fail(res, 422, 'No teacher has that email.')
    if (teacher.id === access.record.ownerId) return fail(res, 422, 'You already own this class.')
    const existing = await pool.query(
      `SELECT 1 FROM co_teachers WHERE class_id = $1 AND teacher_id = $2`,
      [access.record.id, teacher.id]
    )
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO co_teachers (class_id, teacher_id) VALUES ($1, $2)`,
        [access.record.id, teacher.id]
      )
      res.status(201).json({ id: teacher.id, displayName: teacher.display_name, email: teacher.email })
      return
    }
    res.status(200).json({ id: teacher.id, displayName: teacher.display_name, email: teacher.email })
  })

  router.post('/classes/:classId/lessons', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await loadClassIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      req.params.classId
    )
    if (!access || access.role === 'learner-enrolled') return fail(res, 404, NOT_FOUND.message)
    if (access.role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const { title } = body<{ title?: string }>(req)
    const trimmed = (title ?? '').trim()
    if (trimmed.length < 1 || trimmed.length > 120) return fail(res, 422, 'Give the lesson a title of 1 to 120 characters.')
    const lessonId = makeId('les')
    await pool.query(
      `INSERT INTO lessons (id, world_id, class_id, title, state) VALUES ($1, $2, $3, $4, 'draft')`,
      [lessonId, access.record.worldId, access.record.id, trimmed]
    )
    const lesson = await lessonBody(lessonId)
    res.status(201).json(lesson)
  })

  router.post('/classes/:classId/sessions', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await loadClassIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      req.params.classId
    )
    if (!access || access.role === 'learner-enrolled') return fail(res, 404, NOT_FOUND.message)
    if (access.role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const { lessonId, startsAt, endsAt } = body<{ lessonId?: string; startsAt?: string; endsAt?: string }>(req)
    const lessonAccess = await loadLessonIfOpen(who.kind === 'teacher' ? who.teacher.id : null, 'teacher', lessonId ?? '')
    if (!lessonAccess || lessonAccess.classId !== access.record.id) return fail(res, 404, NOT_FOUND.message)
    const zone = access.record.timeZone
    const start = parseWallTime(zone, startsAt ?? '')
    if (start.error) return fail(res, 422, start.error)
    const end = parseWallTime(zone, endsAt ?? '')
    if (end.error) return fail(res, 422, end.error)
    if (!start.at || !end.at || end.at.getTime() <= start.at.getTime()) {
      return fail(res, 422, 'End the session after it starts.')
    }
    const running = await pool.query(
      `SELECT 1 FROM sessions WHERE class_id = $1 AND state IN ('open', 'live', 'breakouts')`,
      [access.record.id]
    )
    if (running.rows.length > 0) return fail(res, 409, 'This class already has a session running.')
    const sessionId = makeId('ses')
    await pool.query(
      `INSERT INTO sessions (id, world_id, class_id, lesson_id, state, starts_at, ends_at, current_slide)
       VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, 1)`,
      [sessionId, access.record.worldId, access.record.id, lessonId, start.at, end.at]
    )
    const record = await loadSession(sessionId)
    const classRecord = await loadClass(access.record.id)
    const lesson = await loadLesson(lessonId ?? '')
    if (!record || !classRecord || !lesson) return fail(res, 404, NOT_FOUND.message)
    const snapshot = await buildSnapshot(record, classRecord, lesson, { role: 'teacher', learnerId: null })
    res.status(201).json(snapshot)
  })
}

export async function lessonBody(lessonId: string): Promise<{
  id: string; classId: string; title: string; state: string
  slides: { fileId: string; name: string; number: number; bytes: number; status: string }[]
  models: { fileId: string; name: string; number: number; bytes: number; status: string }[]
}> {
  const lesson = await loadLesson(lessonId)
  const files = await lessonFiles(lessonId)
  return {
    id: lessonId,
    classId: lesson?.classId ?? '',
    title: lesson?.title ?? '',
    state: lesson?.state ?? 'draft',
    slides: files.slides,
    models: files.models
  }
}
