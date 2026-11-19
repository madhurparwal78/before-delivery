// Session routes: join, lifecycle, seats, slides, hands, polls, spotlight,
// lock, breakouts, chat, attendance, summary and review.

import { type Router, type Request, type Response } from 'express'
import { pool } from './db.js'
import { NOT_FOUND, ROLE_REFUSAL } from './apiError.js'
import { caller, fail, body, setSessionCookie } from './web.js'
import {
  loadSessionIfOpen, sessionRoster, pollAccess, type SessionAccess
} from './access.js'
import { buildSnapshot, type Viewer } from './snapshot.js'
import { arrangedRoom, lessonFiles, loadSession } from './records.js'
import { compareSeatIds } from '../shared/rules.js'
import { utcToWallString } from './walltime.js'
import { worldNow, graceSeconds } from './clock.js'
import * as bus from './bus.js'
import { config } from './config.js'
import {
  endSession, setSlide, lock as lockSession, startBreakouts, extendBreakouts,
  closePoll, STATE_409
} from './sessions.js'
import { attendanceRows } from './presence.js'
import { publishSession } from './live.js'
import { createSessionCookie, createLearnerSession } from './auth.js'
import { id as makeId } from './ids.js'
import type { SummaryBody } from '../shared/protocol.js'

export function registerSessionRoutes(router: Router): void {
  router.get('/sessions/:sessionId', sessionRoute(async (_req, res, access, viewer) => {
    const snapshot = await buildSnapshot(access.record, access.classRecord, access.lesson, viewer)
    res.status(200).json(snapshot)
  }))

  router.post('/sessions/:sessionId/open', sessionRoute(async (_req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (access.record.state !== 'scheduled') {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const running = await pool.query(
      `SELECT 1 FROM sessions WHERE class_id = $1 AND id <> $2 AND state IN ('open', 'live', 'breakouts')`,
      [access.record.classId, access.record.id]
    )
    if (running.rows.length > 0) return fail(res, 409, 'This class already has a session running.')
    await pool.query(`UPDATE sessions SET state = 'open' WHERE id = $1`, [access.record.id])
    await bus.publish({ sessionId: access.record.id, kind: 'state' })
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
  }))

  router.post('/sessions/:sessionId/start', sessionRoute(async (_req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (access.record.state !== 'open') {
      return fail(res, 409, STATE_409(access.record.state))
    }
    if (access.lesson.state !== 'ready') {
      return fail(res, 409, "The lesson isn't ready to teach.")
    }
    await pool.query(`UPDATE sessions SET state = 'live' WHERE id = $1`, [access.record.id])
    await bus.slide.set(access.record.id, access.record.currentSlide)
    await bus.publish({ sessionId: access.record.id, kind: 'state' })
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
  }))

  router.post('/sessions/:sessionId/end', sessionRoute(async (_req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (!['open', 'live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    await endSession(access.record.id)
    await bus.publish({ sessionId: access.record.id, kind: 'state' })
    const record = await loadSession(access.record.id)
    if (!record) return fail(res, 404, NOT_FOUND.message)
    res.status(200).json(await buildSnapshot(record, access.classRecord, access.lesson, viewer))
  }))

  router.post('/join', async (req, res) => {
    const { code, displayName } = body<{ code?: string; displayName?: string }>(req)
    const trimmedCode = (code ?? '').replace(/\s+/g, '')
    const name = (displayName ?? '').trim()
    const who = await caller(req)

    const match = await pool.query(
      `SELECT id, world_id, owner_id FROM classes WHERE upper(replace(code, ' ', '')) = upper($1)`,
      [trimmedCode]
    )
    const classRow = match.rows[0]
    if (!classRow) return fail(res, 404, NOT_FOUND.message)

    const running = await pool.query(
      `SELECT id, lesson_id, state, locked FROM sessions
       WHERE class_id = $1 AND state IN ('open', 'live', 'breakouts') ORDER BY starts_at LIMIT 1`,
      [classRow.id]
    )
    const session = running.rows[0]
    if (!session) return fail(res, 409, "This class isn't open right now.")

    if (name.length < 1 || name.length > 40) {
      return fail(res, 422, 'Enter a name of 1 to 40 characters.')
    }

    const alreadyIn = who.kind === 'learner'
      ? await pool.query(
          `SELECT 1 FROM session_learners WHERE session_id = $1 AND learner_id = $2`,
          [session.id, who.learner.id]
        )
      : null
    if (alreadyIn && alreadyIn.rows.length > 0) {
      res.status(200).json({ sessionId: session.id, learnerId: who.kind === 'learner' ? who.learner.id : null })
      return
    }

    const flags = await bus.flags.get(session.id).catch(() => ({ locked: session.locked, spotlight: null as string | null }))
    if (flags.locked && !alreadyIn) {
      return fail(res, 409, 'This class is locked. Ask your teacher to let you in.')
    }

    // The join is judged at the moment the server receives it.
    const learnerId = who.kind === 'learner' ? who.learner.id : makeId('lrn')
    const worldId = who.kind === 'learner' ? who.learner.worldId : classRow.world_id
    if (who.kind !== 'learner') {
      await pool.query(
        `INSERT INTO learners (id, world_id, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [learnerId, worldId, name]
      )
    }
    await pool.query(
      `INSERT INTO enrolments (class_id, learner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [classRow.id, learnerId]
    )
    await pool.query(
      `INSERT INTO session_learners (session_id, learner_id, seat_id) VALUES ($1, $2, NULL)
       ON CONFLICT DO NOTHING`,
      [session.id, learnerId]
    )
    if (who.kind !== 'learner') {
      const token = await createSessionCookie()
      await createLearnerSession(token, learnerId)
      setSessionCookie(res, token)
    }
    res.status(201).json({ sessionId: session.id, learnerId })
  })

  router.post('/sessions/:sessionId/seat', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role === 'learner') {
      const { seatId } = body<{ seatId?: string }>(req)
      const room = arrangedRoom(access.classRecord.layout as import('../shared/rules.js').Layout)
      if (typeof seatId !== 'string' || !room.seats.some((seat) => seat.seatId === seatId)) {
        return fail(res, 422, 'No such seat.')
      }
      if (access.record.state === 'breakouts') return fail(res, 409, 'Seats are fixed during breakouts.')
      if (!['open', 'live'].includes(access.record.state)) {
        return fail(res, 409, STATE_409(access.record.state))
      }
      const learnerId = viewer.learnerId
      if (!learnerId) return fail(res, 403, ROLE_REFUSAL.message)
      const winner = await bus.seats.claim(access.record.id, seatId, learnerId)
      if (!winner) {
        return fail(res, 409, `Seat ${seatId} was just taken. Pick another seat.`)
      }
      await pool.query(
        `UPDATE session_learners SET seat_id = $2 WHERE session_id = $1 AND learner_id = $3`,
        [access.record.id, seatId, learnerId]
      )
      await bus.publish({ sessionId: access.record.id, kind: 'seat' })
      res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
      return
    }
    return fail(res, 403, ROLE_REFUSAL.message)
  }))

  router.delete('/sessions/:sessionId/seat', sessionRoute(async (_req, res, access, viewer) => {
    if (viewer.role !== 'learner' || !viewer.learnerId) return fail(res, 403, ROLE_REFUSAL.message)
    if (access.record.state === 'breakouts') return fail(res, 409, 'Seats are fixed during breakouts.')
    if (!['open', 'live'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const seat = await bus.seats.seatOf(access.record.id, viewer.learnerId)
    if (seat) await bus.seats.clearSeat(access.record.id, seat)
    await bus.seatOf.clear(access.record.id, viewer.learnerId)
    await bus.hands.lower(access.record.id, viewer.learnerId)
    await pool.query(
      `UPDATE session_learners SET seat_id = NULL WHERE session_id = $1 AND learner_id = $2`,
      [access.record.id, viewer.learnerId]
    )
    await bus.publish({ sessionId: access.record.id, kind: 'seat' })
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
  }))

  router.post('/sessions/:sessionId/slide', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (!['live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const { slide } = body<{ slide?: number }>(req)
    const files = await lessonFiles(access.lesson.id)
    if (typeof slide !== 'number' || !Number.isInteger(slide) || slide < 1 || slide > files.slides.length) {
      return fail(res, 422, 'No such slide.')
    }
    await setSlide(access.record.id, slide)
    await bus.publish({ sessionId: access.record.id, kind: 'slide' })
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
  }))

  router.post('/sessions/:sessionId/hand', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role !== 'learner' || !viewer.learnerId) return fail(res, 403, ROLE_REFUSAL.message)
    if (!['live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const { raised } = body<{ raised?: boolean }>(req)
    const seat = await bus.seats.seatOf(access.record.id, viewer.learnerId)
    if (!seat) return fail(res, 409, 'Take a seat to raise your hand.')
    const queue = await bus.hands.all(access.record.id)
    const inQueue = queue.includes(viewer.learnerId)
    if (raised && !inQueue) {
      await bus.hands.raise(access.record.id, viewer.learnerId)
      const name = await learnerNameOf(viewer.learnerId)
      await bus.publish({ sessionId: access.record.id, kind: 'hand' })
      const snapshot = await buildSnapshot(access.record, access.classRecord, access.lesson, viewer)
      res.status(200).json(snapshot)
      await publishSession(access.record.id, 'notice', `${name} raised a hand.`)
      return
    }
    if (!raised && inQueue) {
      await bus.hands.lower(access.record.id, viewer.learnerId)
      await bus.publish({ sessionId: access.record.id, kind: 'hand' })
      res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
      return
    }
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
  }))

  router.post('/sessions/:sessionId/hands/next', sessionRoute(async (_req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (!['live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const queue = await bus.hands.all(access.record.id)
    const next = queue[0]
    if (!next) return fail(res, 409, 'No hands are raised.')
    await bus.hands.take(access.record.id)
    await pool.query(`UPDATE sessions SET hands_taken = hands_taken + 1 WHERE id = $1`, [access.record.id])
    await bus.publish({ sessionId: access.record.id, kind: 'hand' })
    const took = await learnerNameOf(next)
    const record = await loadSession(access.record.id)
    if (!record) return fail(res, 404, NOT_FOUND.message)
    const snapshot = await buildSnapshot(record, access.classRecord, access.lesson, viewer)
    res.status(200).json({ took: { learnerId: next, displayName: took }, snapshot })
    await publishSession(access.record.id, 'notice', `${took} has the floor.`)
  }))

  router.post('/sessions/:sessionId/polls', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (!['live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const { question, options } = body<{ question?: string; options?: string[] }>(req)
    const trimmed = (question ?? '').trim()
    if (trimmed.length < 1 || trimmed.length > 200) {
      return fail(res, 422, 'Write a question of 1 to 200 characters.')
    }
    const list = options ?? []
    if (!Array.isArray(list) || list.length < 2 || list.length > 6) {
      return fail(res, 422, 'Give 2 to 6 options.')
    }
    if (list.some((option) => option.trim().length < 1 || option.trim().length > 80)) {
      return fail(res, 422, 'Each option needs 1 to 80 characters.')
    }
    const lowered = list.map((option) => option.trim().toLowerCase())
    if (new Set(lowered).size !== lowered.length) {
      return fail(res, 422, 'Options must be different.')
    }
    const openPoll = await pool.query(
      `SELECT 1 FROM polls WHERE session_id = $1 AND state = 'open'`,
      [access.record.id]
    )
    if (openPoll.rows.length > 0) return fail(res, 409, 'Close the open poll first.')
    const pollId = makeId('pol')
    const now = await worldNow(access.record.worldId)
    await pool.query(
      `INSERT INTO polls (id, session_id, question, options, state, opened_at)
       VALUES ($1, $2, $3, $4, 'open', $5)`,
      [pollId, access.record.id, trimmed, JSON.stringify(list.map((o) => o.trim())), now]
    )
    await bus.pollCounts.init(access.record.id, pollId, list.length)
    await bus.publish({ sessionId: access.record.id, kind: 'poll' })
    res.status(201).json({ pollId, question: trimmed, options: list.map((o) => o.trim()), state: 'open' })
  }))

  router.post('/polls/:pollId/answer', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await pollAccess(req.params.pollId)
    if (!access) return fail(res, 404, NOT_FOUND.message)
    const session = await loadSessionIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      access.sessionId
    )
    if (!session) return fail(res, 404, NOT_FOUND.message)
    if (who.kind === 'teacher') return fail(res, 403, ROLE_REFUSAL.message)
    const poll = await pool.query<{ id: string; state: string; options: string[] }>(
      `SELECT id, state, options FROM polls WHERE id = $1`,
      [req.params.pollId]
    )
    if (poll.rows.length === 0) return fail(res, 404, NOT_FOUND.message)
    const record = poll.rows[0]
    if (record.state !== 'open') return fail(res, 409, 'This poll is closed.')
    if (!['live', 'breakouts'].includes(session.record.state)) {
      return fail(res, 409, STATE_409(session.record.state))
    }
    const { option } = body<{ option?: number }>(req)
    if (typeof option !== 'number' || !Number.isInteger(option) || option < 1 || option > record.options.length) {
      return fail(res, 422, 'No such option.')
    }
    const previous = await pool.query<{ option_number: number }>(
      `SELECT option_number FROM poll_answers WHERE poll_id = $1 AND learner_id = $2`,
      [req.params.pollId, who.learner.id]
    )
    const before = previous.rows[0]?.option_number
    await pool.query(
      `INSERT INTO poll_answers (poll_id, learner_id, option_number) VALUES ($1, $2, $3)
       ON CONFLICT (poll_id, learner_id) DO UPDATE SET option_number = $3`,
      [req.params.pollId, who.learner.id, option]
    )
    const counts = await bus.pollCounts.get(access.sessionId, req.params.pollId)
    const numeric = record.options.map((_, index) => Number(counts[String(index + 1)] ?? 0))
    if (before !== undefined) {
      if (before === option) {
        res.status(200).json({ pollId: req.params.pollId, yourAnswer: option })
        return
      }
      numeric[before - 1] = Math.max(0, numeric[before - 1] - 1)
    }
    numeric[option - 1] += 1
    const fields: Record<string, string> = {}
    numeric.forEach((count, index) => {
      fields[String(index + 1)] = String(count)
    })
    await bus.pollCounts.set(access.sessionId, req.params.pollId, fields)
    await bus.publish({ sessionId: access.sessionId, kind: 'poll' })
    res.status(200).json({ pollId: req.params.pollId, yourAnswer: option })
  })

  router.post('/polls/:pollId/close', async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') return fail(res, 401, 'Sign in first.')
    const access = await pollAccess(req.params.pollId)
    if (!access) return fail(res, 404, NOT_FOUND.message)
    const session = await loadSessionIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      access.sessionId
    )
    if (!session) return fail(res, 404, NOT_FOUND.message)
    if (who.kind === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    const poll = await pool.query<{ state: string }>(
      `SELECT state FROM polls WHERE id = $1`,
      [req.params.pollId]
    )
    if (poll.rows.length === 0) return fail(res, 404, NOT_FOUND.message)
    if (poll.rows[0].state !== 'open') return fail(res, 409, 'This poll is closed.')
    const tally = await closePoll(access.sessionId, req.params.pollId)
    await bus.publish({ sessionId: access.sessionId, kind: 'poll' })
    const announcement = `Poll results: ${tally.results.map((entry) => `${entry.option} ${entry.percent}%`).join(', ')}.`
    await publishSession(access.sessionId, 'notice', announcement)
    res.status(200).json({
      pollId: req.params.pollId,
      total: tally.total,
      results: tally.results
    })
  })

  router.post('/sessions/:sessionId/spotlight', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (!['live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const { learnerId } = body<{ learnerId?: string | null }>(req)
    if (learnerId === null || learnerId === undefined) {
      await bus.flags.set(access.record.id, 'spotlight', '')
      await bus.publish({ sessionId: access.record.id, kind: 'spotlight' })
      res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
      return
    }
    const roster = await sessionRoster(access.record.id)
    if (typeof learnerId !== 'string' || !roster.includes(learnerId)) {
      return fail(res, 404, NOT_FOUND.message)
    }
    const present = await isPresent(access.record.id, learnerId)
    if (!present) return fail(res, 409, "That learner isn't in the room.")
    const name = await learnerNameOf(learnerId)
    await bus.flags.set(access.record.id, 'spotlight', learnerId)
    await bus.publish({ sessionId: access.record.id, kind: 'spotlight' })
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
    await publishSession(access.record.id, 'notice', `${name} is in the spotlight.`)
  }))

  router.post('/sessions/:sessionId/lock', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (viewer.role === 'co-teacher') return fail(res, 403, ROLE_REFUSAL.message)
    if (!['live', 'breakouts'].includes(access.record.state)) {
      return fail(res, 409, STATE_409(access.record.state))
    }
    const { locked } = body<{ locked?: boolean }>(req)
    await lockSession(access.record.id, Boolean(locked))
    await bus.publish({ sessionId: access.record.id, kind: 'lock' })
    res.status(200).json(await buildSnapshot(access.record, access.classRecord, access.lesson, viewer))
    await publishSession(access.record.id, 'notice', locked ? 'The class is locked.' : 'The class is unlocked.')
  }))

  router.post('/sessions/:sessionId/breakouts', sessionRoute(async (req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (viewer.role === 'co-teacher') return fail(res, 403, ROLE_REFUSAL.message)
    if (access.record.state !== 'live') return fail(res, 409, STATE_409(access.record.state))
    const room = arrangedRoom(access.classRecord.layout as import('../shared/rules.js').Layout)
    const { tables } = body<{ tables?: number }>(req)
    if (typeof tables !== 'number' || !Number.isInteger(tables) || tables < 2 || tables > room.tables.length) {
      return fail(res, 422, `Choose 2 to ${room.tables.length} tables.`)
    }
    const seatMap = await bus.seats.all(access.record.id)
    const seated: { learnerId: string; seatId: string }[] = []
    for (const seat of room.seats) {
      const learnerId = seatMap[seat.seatId]
      if (learnerId) seated.push({ learnerId, seatId: seat.seatId })
    }
    seated.sort((a, b) => compareSeatIds(a.seatId, b.seatId))
    await startBreakouts(access.record.id, tables, seated)
    await bus.publish({ sessionId: access.record.id, kind: 'breakout' })
    const record = await loadSession(access.record.id)
    if (!record) return fail(res, 404, NOT_FOUND.message)
    res.status(201).json(await buildSnapshot(record, access.classRecord, access.lesson, viewer))
    await announceBreakouts(access.record.id, tables)
  }))

  router.post('/sessions/:sessionId/breakouts/extend', sessionRoute(async (_req, res, access, viewer) => {
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    if (viewer.role === 'co-teacher') return fail(res, 403, ROLE_REFUSAL.message)
    if (access.record.state !== 'breakouts') return fail(res, 409, 'Breakouts are over.')
    const extended = await extendBreakouts(access.record.id)
    if (!extended) return fail(res, 409, 'Breakouts are over.')
    await pool.query(`UPDATE breakout_rounds SET warned = false WHERE session_id = $1 AND ended_at IS NULL`, [access.record.id])
    await bus.publish({ sessionId: access.record.id, kind: 'breakout' })
    const record = await loadSession(access.record.id)
    if (!record) return fail(res, 404, NOT_FOUND.message)
    res.status(200).json(await buildSnapshot(record, access.classRecord, access.lesson, viewer))
  }))

  router.get('/sessions/:sessionId/tables/:tableId/chat', sessionRoute(async (req, res, access, viewer) => {
    const tableId = req.params.tableId
    const room = arrangedRoom(access.classRecord.layout as import('../shared/rules.js').Layout)
    if (!room.tables.some((table) => table.tableId === tableId)) {
      return fail(res, 404, NOT_FOUND.message)
    }
    if (viewer.role === 'learner') {
      const members = await busBreakoutMembers(access.record.id)
      if (members[viewer.learnerId ?? ''] !== tableId) return fail(res, 404, NOT_FOUND.message)
    }
    const answer = await pool.query(
      `SELECT id, author_id, author_name, text, sent_at FROM chat_messages
       WHERE session_id = $1 AND table_id = $2 ORDER BY sent_at, id`,
      [access.record.id, tableId]
    )
    res.status(200).json({
      messages: answer.rows.map((row: { id: string; author_id: string | null; author_name: string; text: string; sent_at: Date }) => ({
        messageId: row.id,
        author: row.author_name,
        text: row.text,
        sentAt: utcToWallString(access.classRecord.timeZone, row.sent_at)
      }))
    })
  }))

  router.post('/sessions/:sessionId/tables/:tableId/chat', sessionRoute(async (req, res, access, viewer) => {
    const tableId = req.params.tableId
    if (access.record.state !== 'breakouts') return fail(res, 409, 'Breakouts are over.')
    const room = arrangedRoom(access.classRecord.layout as import('../shared/rules.js').Layout)
    if (!room.tables.some((table) => table.tableId === tableId)) {
      return fail(res, 404, NOT_FOUND.message)
    }
    let authorName: string
    if (viewer.role === 'learner') {
      const members = await busBreakoutMembers(access.record.id)
      if (members[viewer.learnerId ?? ''] !== tableId) return fail(res, 404, NOT_FOUND.message)
      authorName = await learnerNameOf(viewer.learnerId ?? '')
    } else if (viewer.role === 'teacher') {
      authorName = 'Teacher'
    } else {
      return fail(res, 403, ROLE_REFUSAL.message)
    }
    const { text } = body<{ text?: string }>(req)
    const trimmed = (text ?? '').trim()
    if (trimmed.length < 1 || trimmed.length > config.chatMaxChars) {
      return fail(res, 422, `Write 1 to ${config.chatMaxChars} characters.`)
    }
    const now = await worldNow(access.record.worldId)
    const messageId = makeId('msg')
    await pool.query(
      `INSERT INTO chat_messages (id, session_id, table_id, author_id, author_name, text, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [messageId, access.record.id, tableId, viewer.learnerId, authorName, trimmed, now]
    )
    await bus.publish({ sessionId: access.record.id, kind: 'chat' })
    res.status(201).json({
      messageId,
      author: authorName,
      text: trimmed,
      sentAt: utcToWallString(access.classRecord.timeZone, now)
    })
  }))

  router.get('/sessions/:sessionId/attendance', sessionRoute(async (_req, res, access, viewer) => {
    if (access.record.state !== 'ended') {
      return fail(res, 409, 'Attendance is ready when the session ends.')
    }
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    const rows = await attendanceRows(access.record.id, access.classRecord.timeZone)
    res.status(200).json({ rows })
  }))

  router.get('/sessions/:sessionId/summary', sessionRoute(async (_req, res, access, viewer) => {
    if (access.record.state !== 'ended') {
      return fail(res, 409, 'Attendance is ready when the session ends.')
    }
    if (viewer.role === 'learner') return fail(res, 403, ROLE_REFUSAL.message)
    const counts = await pool.query(
      `SELECT status, count(*)::int AS n FROM attendance_rows WHERE session_id = $1 GROUP BY status`,
      [access.record.id]
    )
    const tally: SummaryBody['attendance'] = { present: 0, late: 0, leftEarly: 0, lateLeftEarly: 0, absent: 0 }
    for (const row of counts.rows as { status: string; n: number }[]) {
      if (row.status === 'present') tally.present = row.n
      if (row.status === 'late') tally.late = row.n
      if (row.status === 'left_early') tally.leftEarly = row.n
      if (row.status === 'late_left_early') tally.lateLeftEarly = row.n
      if (row.status === 'absent') tally.absent = row.n
    }
    const polls = await pool.query<{ id: string; question: string; total: number; results: { option: string; count: number; percent: number }[] }>(
      `SELECT id, question, total, results FROM polls WHERE session_id = $1 ORDER BY opened_at, id`,
      [access.record.id]
    )
    const record = await loadSession(access.record.id)
    res.status(200).json({
      attendance: tally,
      polls: polls.rows.map((row) => ({
        pollId: row.id, question: row.question, total: row.total, results: row.results ?? []
      })),
      handsTaken: record?.handsTaken ?? 0,
      breakoutRounds: record?.breakoutRounds ?? 0
    })
  }))

  router.get('/sessions/:sessionId/review', sessionRoute(async (_req, res, access, viewer) => {
    if (access.record.state !== 'ended') {
      return fail(res, 409, 'Review opens when the class ends.')
    }
    if (viewer.role === 'learner') {
      const attended = await pool.query(
        `SELECT 1 FROM presence_intervals WHERE session_id = $1 AND learner_id = $2`,
        [access.record.id, viewer.learnerId]
      )
      if (attended.rows.length === 0) return fail(res, 404, NOT_FOUND.message)
    }
    const files = await lessonFiles(access.lesson.id)
    res.status(200).json({
      lessonTitle: access.lesson.title,
      slides: files.slides.map((file) => ({ fileId: file.fileId, number: file.number, url: `/api/files/${file.fileId}` })),
      models: files.models.map((file) => ({ fileId: file.fileId, number: file.number, url: `/api/files/${file.fileId}` }))
    })
  }))
}

interface RouteWork {
  (req: Request, res: Response, access: SessionAccess, viewer: Viewer): Promise<void>
}

function sessionRoute(work: RouteWork): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const who = await caller(req)
    if (who.kind === 'none') {
      fail(res, 401, 'Sign in first.')
      return
    }
    const access = await loadSessionIfOpen(
      who.kind === 'teacher' ? who.teacher.id : who.learner.id,
      who.kind === 'teacher' ? 'teacher' : 'learner',
      req.params.sessionId
    )
    if (!access) {
      fail(res, 404, NOT_FOUND.message)
      return
    }
    const viewer: Viewer = access.isLearner
      ? { role: 'learner', learnerId: access.learnerId }
      : { role: access.role === 'owner' ? 'teacher' : 'co-teacher', learnerId: null }
    await work(req, res, access, viewer)
  }
}

async function learnerNameOf(learnerId: string): Promise<string> {
  const answer = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM learners WHERE id = $1`,
    [learnerId]
  )
  return answer.rows[0]?.display_name ?? ''
}

async function isPresent(sessionId: string, learnerId: string): Promise<boolean> {
  const online = await bus.online.all(sessionId).catch(() => [] as string[])
  if (online.includes(learnerId)) return true
  const open = await pool.query(
    `SELECT 1 FROM presence_intervals WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL`,
    [sessionId, learnerId]
  )
  if (open.rows.length > 0) return true
  const lastLeft = await pool.query<{ left_at: Date }>(
    `SELECT left_at FROM presence_intervals WHERE session_id = $1 AND learner_id = $2 AND left_at IS NOT NULL
     ORDER BY left_at DESC LIMIT 1`,
    [sessionId, learnerId]
  )
  const left = lastLeft.rows[0]?.left_at
  if (!left) return false
  const now = await worldNowOf(sessionId)
  return now.getTime() - left.getTime() < graceSeconds() * 1000
}

async function worldNowOf(sessionId: string): Promise<Date> {
  const answer = await pool.query<{ world_id: string }>(
    `SELECT world_id FROM sessions WHERE id = $1`,
    [sessionId]
  )
  return worldNow(answer.rows[0]?.world_id ?? 'default')
}

async function busBreakoutMembers(sessionId: string): Promise<Record<string, string>> {
  return bus.breakout.members(sessionId).catch(() => ({}))
}

/** Tells each dealt learner their table, and everyone else the table count. */
async function announceBreakouts(sessionId: string, tableCount: number): Promise<void> {
  const members = await busBreakoutMembers(sessionId)
  const byTable = new Map<string, string[]>()
  for (const [learnerId, tableId] of Object.entries(members)) {
    if (!byTable.has(tableId)) byTable.set(tableId, [])
    byTable.get(tableId)!.push(learnerId)
  }
  const tables = [...byTable.entries()].sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
  for (const [tableId, learnerIds] of tables) {
    for (const learnerId of learnerIds) {
      await publishSession(sessionId, 'learner-notice', `Breakouts started. You are at table ${tableId}.`, learnerId)
    }
  }
  await publishSession(sessionId, 'notice', `Breakouts started at ${tableCount} tables.`)
}
