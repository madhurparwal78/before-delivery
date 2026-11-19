// Grading routes (DP-39): setup, sign-in, clock and outage, behind the key.

import { type Router, type Request, type Response } from 'express'
import { pool } from './db.js'
import { config } from './config.js'
import { id as makeId, classCode, randomToken } from './ids.js'
import { fail, body, setSessionCookie } from './web.js'
import { NOT_FOUND } from './apiError.js'
import { arrangeRoom, type Layout } from '../shared/rules.js'
import { validTimeZone, parseWallTime } from './records.js'
import { startBreakouts, closePoll, endSession } from './sessions.js'
import { setWorldClock, worldNow } from './clock.js'
import * as store from './store.js'
import { setStoreOutage, putFile } from './store.js'
import { setBusOutage } from './bus.js'
import * as bus from './bus.js'
import { runWorldDue } from './live.js'
import { createTeacherSession, createLearnerSession, hashPassword } from './auth.js'

interface WorldRequest {
  now?: string
  teachers?: { key: string; email: string; password: string; displayName: string }[]
  classes?: { key: string; teacher: string; coTeachers?: string[]; title: string; timeZone: string; code?: string; layout?: Layout }[]
  lessons?: { key: string; class: string; title: string; slideCount?: number; modelCount?: number }[]
  sessions?: {
    key: string; class: string; lesson: string; startsAt: string; endsAt: string
    state: string; currentSlide?: number; locked?: boolean
  }[]
  learners?: { key: string; displayName: string; session: string; seat: string | null; presence: { joinedAt: string; leftAt: string | null }[] }[]
  hands?: { session: string; learners: string[] }[]
  polls?: { key: string; session: string; question: string; options: string[]; answers: Record<string, number>; state: string }[]
  breakouts?: { session: string; tables: number }[]
}

export function registerGradingRoutes(router: Router): void {
  const guarded = (work: (req: Request, res: Response) => Promise<void>): ((req: Request, res: Response) => Promise<void>) => {
    return async (req, res) => {
      if (!config.gradingKey || req.headers['x-grading-key'] !== config.gradingKey) {
        fail(res, 404, NOT_FOUND.message)
        return
      }
      await work(req, res)
    }
  }

  router.post('/grading/setup', guarded(async (req, res) => {
    const world = body<WorldRequest>(req)
    const problems = checkWorld(world)
    if (problems) return fail(res, 422, problems)

    // A class code is unique across all worlds.
    for (const entry of world.classes ?? []) {
      if (entry.code) {
        const taken = await pool.query(`SELECT 1 FROM classes WHERE code = $1`, [entry.code])
        if (taken.rows.length > 0) {
          return fail(res, 409, `Class code ${entry.code} is already in use.`)
        }
      }
    }

    const worldId = makeId('wld')
    try {
      await pool.query(`INSERT INTO worlds (id) VALUES ($1)`, [worldId])
    } catch {
      return fail(res, 409, 'Class code is already in use.')
    }

    if (world.now !== undefined && world.now !== null) {
      const when = new Date(world.now)
      if (Number.isNaN(when.getTime())) return fail(res, 422, 'now must be an ISO instant.')
      await setWorldClock(worldId, when)
    }

    const teachers: Record<string, string> = {}
    const classes: Record<string, { id: string; code: string }> = {}
    const lessons: Record<string, { id: string; slides: string[]; models: string[] }> = {}
    const sessions: Record<string, string> = {}
    const learners: Record<string, string> = {}
    const polls: Record<string, string> = {}
    const signInTokens: Record<string, string> = {}

    try {
      for (const entry of world.teachers ?? []) {
        const teacherId = makeId('tch')
        teachers[entry.key] = teacherId
        await pool.query(
          `INSERT INTO teachers (id, world_id, email, password_hash, display_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacherId, worldId, entry.email, await hashPassword(entry.password), entry.displayName]
        )
      }

      for (const entry of world.classes ?? []) {
        const classId = makeId('cls')
        let code = entry.code ?? classCode()
        for (let attempt = 0; attempt < 20; attempt++) {
          const taken = await pool.query(`SELECT 1 FROM classes WHERE code = $1`, [code])
          if (taken.rows.length === 0) break
          code = classCode()
        }
        const layout = entry.layout ?? {
          columns: 8, rows: 6,
          pieces: [{ kind: 'board', column: 2, row: 0 }]
        }
        classes[entry.key] = { id: classId, code }
        await pool.query(
          `INSERT INTO classes (id, world_id, owner_id, title, time_zone, code, layout)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [classId, worldId, teachers[entry.teacher], entry.title, entry.timeZone, code, JSON.stringify(layout)]
        )
        for (const coKey of entry.coTeachers ?? []) {
          await pool.query(
            `INSERT INTO co_teachers (class_id, teacher_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [classId, teachers[coKey]]
          )
        }
      }

      // Lesson files are stored in MinIO, so a store outage refuses setup.
      for (const entry of world.lessons ?? []) {
        const lessonId = makeId('les')
        const classEntry = classes[entry.class]
        await pool.query(
          `INSERT INTO lessons (id, world_id, class_id, title, state) VALUES ($1, $2, $3, $4, $5)`,
          [lessonId, worldId, classEntry.id, entry.title, 'draft']
        )
        const slideIds: string[] = []
        const modelIds: string[] = []
        for (let number = 1; number <= (entry.slideCount ?? 0); number++) {
          const fileId = makeId('fil')
          const bytes = makeSlidePng(number)
          await pool.query(
            `INSERT INTO lesson_files (id, world_id, lesson_id, kind, name, bytes, number, status)
             VALUES ($1, $2, $3, 'slide', $4, $5, $6, 'pending')`,
            [fileId, worldId, lessonId, `slide-${number}.png`, bytes.length, number]
          )
          await putFile(lessonId, fileId, bytes, 'image/png')
          await pool.query(`UPDATE lesson_files SET status = 'confirmed' WHERE id = $1`, [fileId])
          slideIds.push(fileId)
        }
        for (let number = 1; number <= (entry.modelCount ?? 0); number++) {
          const fileId = makeId('fil')
          const bytes = makeModelGlb()
          await pool.query(
            `INSERT INTO lesson_files (id, world_id, lesson_id, kind, name, bytes, number, status)
             VALUES ($1, $2, $3, 'model', $4, $5, $6, 'pending')`,
            [fileId, worldId, lessonId, `model-${number}.glb`, bytes.length, number]
          )
          await putFile(lessonId, fileId, bytes, 'model/gltf-binary')
          await pool.query(`UPDATE lesson_files SET status = 'confirmed' WHERE id = $1`, [fileId])
          modelIds.push(fileId)
        }
        lessons[entry.key] = { id: lessonId, slides: slideIds, models: modelIds }
        await pool.query(`UPDATE lessons SET state = 'ready' WHERE id = $1`, [lessonId])
      }

      const learnerBySeat = new Map<string, string>()

      for (const entry of world.sessions ?? []) {
        const sessionId = makeId('ses')
        sessions[entry.key] = sessionId
        const classEntry = classes[entry.class]
        const zoneRow = await pool.query<{ time_zone: string }>(
          `SELECT time_zone FROM classes WHERE id = $1`,
          [classEntry.id]
        )
        const zone = zoneRow.rows[0].time_zone
        const start = parseWallTime(zone, entry.startsAt)
        if (start.error) return fail(res, 422, start.error)
        const end = parseWallTime(zone, entry.endsAt)
        if (end.error) return fail(res, 422, end.error)
        if (!start.at || !end.at) return fail(res, 422, 'Use a date and time like 2027-03-09T19:00.')
        const state = ['scheduled', 'open', 'live', 'ended'].includes(entry.state) ? entry.state : 'live'
        await pool.query(
          `INSERT INTO sessions (id, world_id, class_id, lesson_id, state, starts_at, ends_at, current_slide, locked)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [sessionId, worldId, classEntry.id, lessons[entry.lesson].id, state, start.at, end.at,
            entry.currentSlide ?? 1, entry.locked ?? false]
        )
        if (state === 'live') {
          const slideTotal = (lessons[entry.lesson]?.slides.length ?? 0)
          const current = Math.min(Math.max(1, entry.currentSlide ?? 1), Math.max(1, slideTotal))
          await bus.slide.set(sessionId, current)
        }
        if (state === 'ended') {
          await endSession(sessionId)
        }
      }

      for (const entry of world.learners ?? []) {
        const learnerId = makeId('lrn')
        learners[entry.key] = learnerId
        const sessionId = sessions[entry.session]
        const classIdRow = await pool.query<{ class_id: string }>(
          `SELECT class_id FROM sessions WHERE id = $1`,
          [sessionId]
        )
        await pool.query(
          `INSERT INTO learners (id, world_id, display_name) VALUES ($1, $2, $3)`,
          [learnerId, worldId, entry.displayName]
        )
        await pool.query(
          `INSERT INTO enrolments (class_id, learner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [classIdRow.rows[0].class_id, learnerId]
        )
        await pool.query(
          `INSERT INTO session_learners (session_id, learner_id, seat_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [sessionId, learnerId, entry.seat]
        )
        for (const visit of entry.presence ?? []) {
          const joined = new Date(visit.joinedAt)
          const left = visit.leftAt ? new Date(visit.leftAt) : null
          await pool.query(
            `INSERT INTO presence_intervals (session_id, learner_id, joined_at, left_at)
             VALUES ($1, $2, $3, $4)`,
            [sessionId, learnerId, joined, left]
          )
        }
        if (entry.seat) {
          learnerBySeat.set(`${sessionId}:${entry.seat}`, learnerId)
        }
      }

      // Seeded seats are applied to the live bus so every instance agrees.
      for (const [key, learnerId] of learnerBySeat) {
        const [sessionId, seatId] = key.split(':')
        await bus.seats.claim(sessionId, seatId, learnerId)
      }

      for (const entry of world.hands ?? []) {
        const sessionId = sessions[entry.session]
        for (const learnerKey of entry.learners) {
          await bus.hands.raise(sessionId, learners[learnerKey])
        }
      }

      for (const entry of world.polls ?? []) {
        const pollId = makeId('pol')
        polls[entry.key] = pollId
        const sessionId = sessions[entry.session]
        const now = await worldNow(worldId)
        await pool.query(
          `INSERT INTO polls (id, session_id, question, options, state, opened_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [pollId, sessionId, entry.question, JSON.stringify(entry.options), entry.state, now]
        )
        await bus.pollCounts.init(sessionId, pollId, entry.options.length)
        for (const [learnerKey, option] of Object.entries(entry.answers ?? {})) {
          await pool.query(
            `INSERT INTO poll_answers (poll_id, learner_id, option_number) VALUES ($1, $2, $3)
             ON CONFLICT (poll_id, learner_id) DO UPDATE SET option_number = $3`,
            [pollId, learners[learnerKey], option]
          )
        }
        if (entry.state === 'open') {
          // Live counts sit in Valkey.
          const counts = new Map<number, number>()
          for (const option of Object.values(entry.answers ?? {})) {
            counts.set(option, (counts.get(option) ?? 0) + 1)
          }
          const fields: Record<string, string> = {}
          entry.options.forEach((_option, index) => {
            fields[String(index + 1)] = String(counts.get(index + 1) ?? 0)
          })
          await bus.pollCounts.set(sessionId, pollId, fields)
        } else {
          await closePoll(sessionId, pollId)
        }
      }

      for (const entry of world.breakouts ?? []) {
        const sessionId = sessions[entry.session]
        const seatMap = await bus.seats.all(sessionId)
        const seated = Object.entries(seatMap).map(([seatId, learnerId]) => ({ seatId, learnerId }))
        await startBreakouts(sessionId, entry.tables, seated)
      }

      // One sign-in token per person, working once.
      for (const [key, teacherId] of Object.entries(teachers)) {
        const token = randomToken()
        signInTokens[key] = token
        await pool.query(
          `INSERT INTO sign_in_tokens (token, person_type, person_id, world_id) VALUES ($1, 'teacher', $2, $3)`,
          [token, teacherId, worldId]
        )
      }
      for (const [key, learnerId] of Object.entries(learners)) {
        const token = randomToken()
        signInTokens[key] = token
        await pool.query(
          `INSERT INTO sign_in_tokens (token, person_type, person_id, world_id) VALUES ($1, 'learner', $2, $3)`,
          [token, learnerId, worldId]
        )
      }

      await runWorldDue(worldId).catch(() => undefined)

      res.status(201).json({
        worldId,
        teachers,
        classes,
        lessons,
        sessions,
        learners,
        polls,
        signInTokens
      })
    } catch (error) {
      if (error instanceof store.StoreError) {
        return fail(res, 503, "Files can't be loaded right now. Try again in a minute.")
      }
      throw error
    }
  }))

  router.post('/grading/sign-in', guarded(async (req, res) => {
    const { token } = body<{ token?: string }>(req)
    const answer = await pool.query<{ person_type: string; person_id: string; used: boolean }>(
      `SELECT person_type, person_id, used FROM sign_in_tokens WHERE token = $1`,
      [token ?? '']
    )
    const row = answer.rows[0]
    if (!row || row.used) return fail(res, 404, NOT_FOUND.message)
    await pool.query(`UPDATE sign_in_tokens SET used = true WHERE token = $1`, [token])
    const cookieTokenValue = randomToken() + randomToken()
    if (row.person_type === 'teacher') {
      await createTeacherSession(cookieTokenValue, row.person_id)
    } else {
      await createLearnerSession(cookieTokenValue, row.person_id)
    }
    setSessionCookie(res, cookieTokenValue)
    res.status(200).json({ role: row.person_type, id: row.person_id })
  }))

  router.post('/grading/clock', guarded(async (req, res) => {
    const { worldId, now } = body<{ worldId?: string; now?: string | null }>(req)
    const world = await pool.query(`SELECT id FROM worlds WHERE id = $1`, [worldId ?? ''])
    if (world.rows.length === 0) return fail(res, 404, NOT_FOUND.message)
    const when = now === null || now === undefined ? null : new Date(now)
    if (when !== null && Number.isNaN(when.getTime())) {
      return fail(res, 422, 'now must be an ISO instant.')
    }
    const held = await setWorldClock(worldId ?? '', when)
    // Run everything that has become due, so its results are visible now.
    await runWorldDue(worldId ?? '')
    res.status(200).json({ worldId, now: held.toISOString().replace(/\.\d{3}Z$/, 'Z') })
  }))

  router.post('/grading/outage', guarded(async (req, res) => {
    const { service, down } = body<{ service?: string; down?: boolean }>(req)
    if (service !== 'valkey' && service !== 'minio') {
      return fail(res, 422, 'Choose valkey or minio.')
    }
    const isDown = Boolean(down)
    if (service === 'valkey') setBusOutage(isDown)
    if (service === 'minio') setStoreOutage(isDown)
    res.status(200).json({ service, down: isDown })
  }))
}

function checkWorld(world: WorldRequest): string | null {
  const keys = new Set<string>()
  for (const list of [world.teachers ?? [], world.classes ?? [], world.lessons ?? [], []]) {
    for (const entry of list as { key?: string }[]) {
      if (entry.key) {
        if (keys.has(entry.key)) return `key ${entry.key} is used twice.`
        keys.add(entry.key)
      }
    }
  }
  const teacherKeys = new Set((world.teachers ?? []).map((entry) => entry.key))
  for (const entry of world.teachers ?? []) {
    if (!entry.email) return 'email is required.'
    if (!entry.password || entry.password.length < 10) return 'password must be at least 10 characters.'
    if (!entry.displayName) return 'displayName is required.'
  }
  for (const entry of world.classes ?? []) {
    if (!teacherKeys.has(entry.teacher)) return `class ${entry.key} names unknown teacher ${entry.teacher}.`
    if (!entry.title || entry.title.length < 1 || entry.title.length > 80) return 'title must be 1 to 80 characters.'
    if (!validTimeZone(entry.timeZone)) return 'timeZone must be an IANA zone name.'
    if (entry.layout) {
      const checked = arrangeRoom(entry.layout)
      if ('error' in checked) return `layout: ${checked.error}`
    }
  }
  const classKeys = new Set((world.classes ?? []).map((entry) => entry.key))
  for (const entry of world.lessons ?? []) {
    if (!classKeys.has(entry.class)) return `lesson ${entry.key} names unknown class ${entry.class}.`
    if (!entry.title || entry.title.length < 1 || entry.title.length > 120) return 'title must be 1 to 120 characters.'
  }
  const lessonKeys = new Set((world.lessons ?? []).map((entry) => entry.key))
  const sessionKeys = new Set<string>()
  for (const entry of world.sessions ?? []) {
    sessionKeys.add(entry.key)
    if (!classKeys.has(entry.class)) return `session ${entry.key} names unknown class ${entry.class}.`
    if (!lessonKeys.has(entry.lesson)) return `session ${entry.key} names unknown lesson ${entry.lesson}.`
    if (!['scheduled', 'open', 'live', 'ended'].includes(entry.state)) {
      return `session ${entry.key} has state ${entry.state}.`
    }
  }
  for (const entry of world.learners ?? []) {
    if (!sessionKeys.has(entry.session)) return `learner ${entry.key} names unknown session ${entry.session}.`
    if (!entry.displayName || entry.displayName.length < 1 || entry.displayName.length > 40) {
      return 'displayName must be 1 to 40 characters.'
    }
  }
  for (const entry of world.polls ?? []) {
    if (!sessionKeys.has(entry.session)) return `poll ${entry.key} names unknown session ${entry.session}.`
    if (!entry.question || entry.question.length < 1 || entry.question.length > 200) {
      return 'question must be 1 to 200 characters.'
    }
    if (!Array.isArray(entry.options) || entry.options.length < 2 || entry.options.length > 6) {
      return 'options must be 2 to 6 entries.'
    }
    const learnerKeys = new Set((world.learners ?? []).map((learner) => learner.key))
    for (const learnerKey of Object.keys(entry.answers ?? {})) {
      if (!learnerKeys.has(learnerKey)) return `poll ${entry.key} names unknown learner ${learnerKey}.`
    }
  }
  for (const entry of world.breakouts ?? []) {
    if (!sessionKeys.has(entry.session)) return `breakouts names unknown session ${entry.session}.`
  }
  return null
}

/** A valid PNG showing its number, made in one place. */
function makeSlidePng(number: number): Buffer {
  const text = String(number)
  const width = 200
  const height = 120
  // Minimal PNG: single IHDR, IDAT with zlib stream of raw scanlines, IEND.
  const raw: number[] = []
  const pixel = (x: number, y: number, on: boolean): void => {
    const index = y * (1 + width * 3) + 1 + x * 3
    raw[index] = on ? 0x20 : 0xfa
    raw[index + 1] = on ? 0x30 : 0xf5
    raw[index + 2] = on ? 0x30 : 0xed
  }
  for (let y = 0; y < height; y++) {
    raw.push(0) // filter: none
    for (let x = 0; x < width; x++) raw.push(0xfa, 0xf5, 0xed)
  }
  // Draw the number as a simple blocky glyph from a 5x7 pattern.
  const glyphs: Record<string, string[]> = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
  }
  const scale = 8
  const startX = Math.floor((width - text.length * (5 * scale + scale)) / 2)
  const startY = Math.floor((height - 7 * scale) / 2)
  for (let i = 0; i < text.length; i++) {
    const glyph = glyphs[text[i]]
    if (!glyph) continue
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            pixel(startX + i * (5 * scale + scale) + gx * scale + dx, startY + gy * scale + dy, true)
          }
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  const compressed = zlibDeflate(Buffer.from(raw))
  const chunks: Buffer[] = []
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  chunks.push(signature)
  chunks.push(pngChunk('IHDR', ihdr))
  chunks.push(pngChunk('IDAT', compressed))
  chunks.push(pngChunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]))
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc, 0)
  return Buffer.concat([head, data, tail])
}

function zlibDeflate(data: Buffer): Buffer {
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib')
  return deflateSync(data, { level: 9 })
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A valid small glTF binary model. */
function makeModelGlb(): Buffer {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scenes: [{ nodes: [] }],
    scene: 0
  })
  const jsonPadded = Buffer.from(json + ' '.repeat((4 - (json.length % 4)) % 4))
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.write('JSON'.slice(0, 4), 4, 'ascii')
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(0, 0)
  binHeader.write('BIN\0', 4, 'ascii')
  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader])
}
