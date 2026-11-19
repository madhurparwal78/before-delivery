// Lesson file routes (DP-15, DP-16, DP-17, DP-18).

import { type Router } from 'express'
import { pool } from './db.js'
import { NOT_FOUND, ROLE_REFUSAL } from './apiError.js'
import { caller, fail, body, rawBody } from './web.js'
import { loadLessonIfOpen } from './access.js'
import { lessonFiles } from './records.js'
import { id as makeId } from './ids.js'
import { detectKind, contentTypeFor } from './filekind.js'
import * as store from './store.js'
import { config } from './config.js'
import { lessonBody } from './routesClasses.js'

interface ParsedUpload {
  name: string
  bytes: Buffer
}

/** Pulls the `files` parts out of a multipart body without buffering twice. */
export function readUploadedFiles(raw: Buffer, contentType: string): ParsedUpload[] {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!boundaryMatch) return []
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]}`
  const files: ParsedUpload[] = []
  const boundaryBuffer = Buffer.from(boundary)
  let cursor = raw.indexOf(boundaryBuffer)
  while (cursor !== -1) {
    const next = raw.indexOf(boundaryBuffer, cursor + boundaryBuffer.length)
    if (next === -1) break
    const part = raw.subarray(cursor + boundaryBuffer.length, next)
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8')
      const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers)
      if (disposition) {
        const nameMatch = /name="([^"]*)"/i.exec(disposition[1])
        const fileMatch = /filename="([^"]*)"/i.exec(disposition[1])
        if (nameMatch && nameMatch[1] === 'files' && fileMatch) {
          let content = part.subarray(headerEnd + 4)
          if (content.length >= 2 && content.subarray(content.length - 2).toString('binary') === '\r\n') {
          content = content.subarray(0, content.length - 2)
        }
          files.push({ name: fileMatch[1], bytes: content })
        }
      }
    }
    cursor = next
  }
  return files
}

export function registerLessonRoutes(router: Router): void {
  router.get('/lessons/:lessonId', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    if (who.kind === 'learner') return fail(res, 404, NOT_FOUND.message)
    const lesson = await loadLessonIfOpen(who.teacher.id, 'teacher', req.params.lessonId)
    if (!lesson) return fail(res, 404, NOT_FOUND.message)
    res.status(200).json(await lessonBody(lesson.id))
  })

  router.post('/lessons/:lessonId/files', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    if (who.kind === 'learner') return fail(res, 404, NOT_FOUND.message)
    const lesson = await loadLessonIfOpen(who.teacher.id, 'teacher', req.params.lessonId)
    if (!lesson) return fail(res, 404, NOT_FOUND.message)
    const role = await classRoleForLesson(lesson.id, who.teacher.id)
    if (role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)

    const teaching = await pool.query(
      `SELECT 1 FROM sessions WHERE lesson_id = $1 AND state IN ('live', 'breakouts')`,
      [lesson.id]
    )
    if (teaching.rows.length > 0) return fail(res, 409, 'This lesson is being taught right now.')

    const raw = rawBody(req)
    if (!raw) return fail(res, 422, 'Choose at least one file.')
    const contentType = req.headers['content-type'] ?? ''
    const files = readUploadedFiles(raw, contentType)
    if (files.length === 0) return fail(res, 422, 'Choose at least one file.')

    const existing = await lessonFiles(lesson.id)
    const existingSlideCount = existing.slides.length
    const perFile: { fileRowId: string; kind: 'slide' | 'model'; name: string; bytes: Buffer }[] = []

    // Files are checked one at a time in request order; the first refused
    // file decides the answer, and nothing from that upload is kept.
    for (const file of files) {
      const kind = detectKind(file.bytes)
      if (kind === null) return fail(res, 422, `${file.name} isn't a PNG, JPEG or glTF binary.`)
      const limit = kind === 'slide' ? config.slideMaxBytes : config.modelMaxBytes
      if (file.bytes.length > limit) return fail(res, 413, `${file.name} is larger than the limit.`)
      if (kind === 'slide' && existingSlideCount + perFile.filter((entry) => entry.kind === 'slide').length + 1 > config.slidesMaxPerLesson) {
        return fail(res, 422, `A lesson holds at most ${config.slidesMaxPerLesson} slides.`)
      }
      const fileRowId = makeId('fil')
      perFile.push({ fileRowId, kind, name: file.name, bytes: file.bytes })
    }

    // Store each file, confirm it, and only then let it count.
    const slideNumbers = { next: existing.slides.length + 1 }
    const modelNumbers = { next: existing.models.length + 1 }
    const saved: { fileRowId: string; kind: 'slide' | 'model' }[] = []
    try {
      await pool.query(`UPDATE lessons SET state = 'uploading' WHERE id = $1`, [lesson.id])
      for (const file of perFile) {
        await pool.query(
          `INSERT INTO lesson_files (id, world_id, lesson_id, kind, name, bytes, number, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [file.fileRowId, lesson.worldId, lesson.id, file.kind, file.name, file.bytes.length,
            file.kind === 'slide' ? slideNumbers.next++ : modelNumbers.next++]
        )
        await store.putFile(lesson.id, file.fileRowId, file.bytes, contentTypeFor(file.kind, file.bytes))
        await pool.query(`UPDATE lesson_files SET status = 'confirmed' WHERE id = $1`, [file.fileRowId])
        saved.push({ fileRowId: file.fileRowId, kind: file.kind })
      }
    } catch (error) {
      // Nothing half-saved: remove every pending record and stored object.
      for (const entry of saved) {
        await store.deleteFile(lesson.id, entry.fileRowId).catch(() => undefined)
        await pool.query(`DELETE FROM lesson_files WHERE id = $1`, [entry.fileRowId])
      }
      await pool.query(`UPDATE lessons SET state = 'draft' WHERE id = $1`, [lesson.id])
      const text = error instanceof store.StoreError ? error.message : "Files can't be saved right now. Try again in a minute."
      return fail(res, 503, text)
    }
    await pool.query(
      `UPDATE lessons SET state = CASE WHEN EXISTS (
         SELECT 1 FROM lesson_files WHERE lesson_id = $1 AND status = 'pending'
       ) THEN 'uploading' ELSE 'draft' END WHERE id = $1`,
      [lesson.id]
    )
    res.status(201).json(await lessonBody(lesson.id))
  })

  router.delete('/lessons/:lessonId/files/:fileId', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    if (who.kind === 'learner') return fail(res, 404, NOT_FOUND.message)
    const lesson = await loadLessonIfOpen(who.teacher.id, 'teacher', req.params.lessonId)
    if (!lesson) return fail(res, 404, NOT_FOUND.message)
    const role = await classRoleForLesson(lesson.id, who.teacher.id)
    if (role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const teaching = await pool.query(
      `SELECT 1 FROM sessions WHERE lesson_id = $1 AND state IN ('live', 'breakouts')`,
      [lesson.id]
    )
    if (teaching.rows.length > 0) return fail(res, 409, 'This lesson is being taught right now.')
    const file = await pool.query<{ id: string; kind: string; number: number }>(
      `SELECT id, kind, number FROM lesson_files WHERE id = $1 AND lesson_id = $2`,
      [req.params.fileId, lesson.id]
    )
    if (file.rows.length === 0) return fail(res, 404, NOT_FOUND.message)
    await store.deleteFile(lesson.id, req.params.fileId)
    await pool.query(`DELETE FROM lesson_files WHERE id = $1`, [req.params.fileId])
    await renumber(lesson.id)
    await pool.query(
      `UPDATE lessons SET state = CASE WHEN EXISTS (
         SELECT 1 FROM lesson_files WHERE lesson_id = $1 AND status = 'pending'
       ) THEN 'uploading'
       WHEN NOT EXISTS (SELECT 1 FROM lesson_files WHERE lesson_id = $1 AND kind = 'slide') THEN 'draft'
       ELSE state END WHERE id = $1`,
      [lesson.id]
    )
    res.status(200).json(await lessonBody(lesson.id))
  })

  router.put('/lessons/:lessonId/order', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    if (who.kind === 'learner') return fail(res, 404, NOT_FOUND.message)
    const lesson = await loadLessonIfOpen(who.teacher.id, 'teacher', req.params.lessonId)
    if (!lesson) return fail(res, 404, NOT_FOUND.message)
    const role = await classRoleForLesson(lesson.id, who.teacher.id)
    if (role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const teaching = await pool.query(
      `SELECT 1 FROM sessions WHERE lesson_id = $1 AND state IN ('live', 'breakouts')`,
      [lesson.id]
    )
    if (teaching.rows.length > 0) return fail(res, 409, 'This lesson is being taught right now.')
    const { slideIds } = body<{ slideIds?: string[] }>(req)
    const files = await lessonFiles(lesson.id)
    const slideIdsOfLesson = files.slides.map((file) => file.fileId)
    const listed = slideIds ?? []
    const sorted = [...listed].sort()
    const expected = [...slideIdsOfLesson].sort()
    if (sorted.length !== expected.length || sorted.some((entry, index) => entry !== expected[index])) {
      return fail(res, 422, 'List every slide once.')
    }
    await pool.query('BEGIN')
    for (let index = 0; index < listed.length; index++) {
      await pool.query(`UPDATE lesson_files SET number = $2 WHERE id = $1`, [listed[index], index + 1])
    }
    await pool.query('COMMIT')
    res.status(200).json(await lessonBody(lesson.id))
  })

  router.post('/lessons/:lessonId/ready', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    if (who.kind === 'learner') return fail(res, 404, NOT_FOUND.message)
    const lesson = await loadLessonIfOpen(who.teacher.id, 'teacher', req.params.lessonId)
    if (!lesson) return fail(res, 404, NOT_FOUND.message)
    const role = await classRoleForLesson(lesson.id, who.teacher.id)
    if (role !== 'owner') return fail(res, 403, ROLE_REFUSAL.message)
    const files = await lessonFiles(lesson.id)
    if (files.slides.length === 0) return fail(res, 409, 'Add at least one slide first.')
    const pending = [...files.slides, ...files.models].find((file) => file.status === 'pending')
    if (pending) return fail(res, 409, "Some files aren't confirmed yet.")
    await pool.query(`UPDATE lessons SET state = 'ready' WHERE id = $1`, [lesson.id])
    res.status(200).json(await lessonBody(lesson.id))
  })

  router.get('/files/:fileId', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const file = await pool.query<{ id: string; lesson_id: string; kind: string; world_id: string }>(
      `SELECT id, lesson_id, kind, world_id FROM lesson_files WHERE id = $1`,
      [req.params.fileId]
    )
    const record = file.rows[0]
    if (!record) return fail(res, 404, NOT_FOUND.message)

    if (who.kind === 'teacher') {
      const lesson = await loadLessonIfOpen(who.teacher.id, 'teacher', record.lesson_id)
      if (!lesson) return fail(res, 404, NOT_FOUND.message)
    } else {
      // A learner may read a file only of a session they may review (DP-36).
      const reviewable = await pool.query(
        `SELECT 1 FROM sessions s
         JOIN presence_intervals pi ON pi.session_id = s.id AND pi.learner_id = $1
         WHERE s.lesson_id = $2 AND s.state = 'ended'`,
        [who.learner.id, record.lesson_id]
      )
      if (reviewable.rows.length === 0) return fail(res, 404, NOT_FOUND.message)
    }

    try {
      const stored = await store.getFile(record.lesson_id, record.id)
      res.status(200)
      res.setHeader('Content-Type', contentTypeFor(record.kind === 'slide' ? 'slide' : 'model', stored.bytes))
      res.setHeader('Cache-Control', 'private, max-age=60')
      res.end(stored.bytes)
    } catch {
      fail(res, 503, "Files can't be loaded right now. Try again in a minute.")
    }
  })
}

async function classRoleForLesson(lessonId: string, teacherId: string): Promise<'owner' | 'co-teacher' | null> {
  const answer = await pool.query<{ class_id: string }>(
    `SELECT class_id FROM lessons WHERE id = $1`,
    [lessonId]
  )
  const classId = answer.rows[0]?.class_id
  if (!classId) return null
  const owner = await pool.query<{ owner_id: string }>(
    `SELECT owner_id FROM classes WHERE id = $1`,
    [classId]
  )
  if (owner.rows[0]?.owner_id === teacherId) return 'owner'
  const co = await pool.query(
    `SELECT 1 FROM co_teachers WHERE class_id = $1 AND teacher_id = $2`,
    [classId, teacherId]
  )
  return co.rows.length > 0 ? 'co-teacher' : null
}

async function renumber(lessonId: string): Promise<void> {
  const files = await pool.query<{ id: string; kind: string }>(
    `SELECT id, kind FROM lesson_files WHERE lesson_id = $1 ORDER BY number, id`,
    [lessonId]
  )
  const slides = files.rows.filter((row) => row.kind === 'slide')
  const models = files.rows.filter((row) => row.kind === 'model')
  for (let index = 0; index < slides.length; index++) {
    await pool.query(`UPDATE lesson_files SET number = $2 WHERE id = $1`, [slides[index].id, index + 1])
  }
  for (let index = 0; index < models.length; index++) {
    await pool.query(`UPDATE lesson_files SET number = $2 WHERE id = $1`, [models[index].id, index + 1])
  }
}
