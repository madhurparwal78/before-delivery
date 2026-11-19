import { pool } from './db.js'
import { arrangedRoom, lessonFiles, sessionTimes } from './records.js'
import { busDown, breakout as busBreakout, flags, hands, pollCounts, seats, slide } from './bus.js'
import { worldNow, breakoutWarningSeconds, graceSeconds } from './clock.js'
import type { ClassRecord, LessonRecord, SessionRecord } from './access.js'
import type { SessionSnapshot, SeatSnapshot, HandSnapshot, PollSnapshot, BreakoutSnapshot } from '../shared/protocol.js'

export interface Viewer {
  role: 'teacher' | 'co-teacher' | 'learner'
  learnerId: string | null
}

export { graceSeconds }

export async function buildSnapshot(
  record: SessionRecord,
  classRecord: ClassRecord,
  lesson: LessonRecord,
  viewer: Viewer
): Promise<SessionSnapshot> {
  const room = arrangedRoom(classRecord.layout as import('../shared/rules.js').Layout)
  const zone = classRecord.timeZone
  const times = sessionTimes(record, zone)

  const [seatMapAnswer, handList, flagState, members, round] = await Promise.all([
    seats.all(record.id).catch(() => ({}) as Record<string, string>),
    hands.all(record.id).catch(() => [] as string[]),
    flags.get(record.id).catch(() => ({ locked: record.locked, spotlight: null as string | null })),
    busBreakout.members(record.id).catch(() => ({}) as Record<string, string>),
    currentRound(record.id)
  ])
  const seatMap = seatMapAnswer as Record<string, string>

  const learnerNames = new Map<string, string>()
  const ids = new Set<string>([...Object.values(seatMap), ...handList, ...(flagState.spotlight ? [flagState.spotlight] : [])])
  for (const learnerId of ids) {
    if (!learnerId) continue
    learnerNames.set(learnerId, await learnerName(learnerId))
  }

  const seatSnapshots: SeatSnapshot[] = room.seats.map((seat) => {
    const learnerId = seatMap[seat.seatId] || null
    const raised = learnerId ? handList.includes(learnerId) : false
    return {
      seatId: seat.seatId,
      table: seat.table,
      row: seat.row,
      column: seat.column,
      learnerId,
      displayName: learnerId ? learnerNames.get(learnerId) ?? null : null,
      hand: raised ? 'up' as const : 'down' as const,
      breakoutTable: learnerId ? members[learnerId] ?? null : null
    }
  })

  const handSnapshots: HandSnapshot[] = []
  for (const learnerId of handList) {
    const displayName = learnerNames.get(learnerId)
    if (displayName) handSnapshots.push({ learnerId, displayName })
  }

  const liveSlide = await slide.get(record.id).catch(() => null)
  const files = await lessonFiles(lesson.id)
  const total = files.slides.length
  const current = liveSlide ?? record.currentSlide
  const currentFile = files.slides.find((file) => file.number === current) ?? null

  const pollSnapshot = await openOrLatestPoll(record.id, viewer)

  let breakoutSnapshot: BreakoutSnapshot | null = null
  if (record.state === 'breakouts' && round) {
    const now = await worldNow(record.worldId)
    const remaining = Math.max(0, Math.round((round.deadline.getTime() - now.getTime()) / 1000))
    const tables = new Map<string, string[]>()
    for (const [learnerId, tableId] of Object.entries(members)) {
      if (!tables.has(tableId)) tables.set(tableId, [])
      tables.get(tableId)!.push(learnerId)
    }
    const tableSort = (a: string, b: string): number => {
      const na = Number(a.slice(1))
      const nb = Number(b.slice(1))
      return na - nb
    }
    const orderedTables = [...tables.entries()]
      .sort((a, b) => tableSort(a[0], b[0]))
      .map(([tableId, learnerIds]) => ({ tableId, learnerIds: learnerIds.sort() }))
    breakoutSnapshot = {
      tables: orderedTables,
      remainingSeconds: remaining,
      warning: round.warned && remaining <= breakoutWarningSeconds()
    }
  }

  const spotlightId = flagState.spotlight
  const spotlight = spotlightId
    ? { learnerId: spotlightId, displayName: learnerNames.get(spotlightId) ?? '' }
    : null

  const displayName = viewer.learnerId
    ? await learnerName(viewer.learnerId)
    : ''

  return {
    id: record.id,
    classId: record.classId,
    lessonId: record.lessonId,
    state: record.state,
    title: classRecord.title,
    timeZone: zone,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    startsAtUtc: times.startsAtUtc,
    endsAtUtc: times.endsAtUtc,
    slide: { current, total, fileId: currentFile?.fileId ?? null },
    modelFileId: files.models[0]?.fileId ?? null,
    locked: flagState.locked,
    spotlight,
    seats: seatSnapshots,
    tables: room.tables,
    hands: handSnapshots,
    poll: pollSnapshot,
    breakout: breakoutSnapshot,
    you: {
      role: viewer.role,
      learnerId: viewer.learnerId,
      displayName
    },
    live: !busDown()
  }
}

async function learnerName(learnerId: string): Promise<string> {
  const answer = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM learners WHERE id = $1`,
    [learnerId]
  )
  return answer.rows[0]?.display_name ?? ''
}

async function openOrLatestPoll(sessionId: string, viewer: Viewer): Promise<PollSnapshot | null> {
  const answer = await pool.query<{
    id: string; question: string; options: string[]; state: string; total: number | null; results: { option: string; count: number; percent: number }[] | null
  }>(
    `SELECT id, question, options, state, total, results FROM polls
     WHERE session_id = $1 ORDER BY opened_at DESC, id DESC LIMIT 1`,
    [sessionId]
  )
  const row = answer.rows[0]
  if (!row) return null
  if (row.state === 'closed') {
    return {
      pollId: row.id,
      question: row.question,
      options: row.options,
      state: 'closed',
      counts: null,
      yourAnswer: await yourAnswer(row.id, viewer.learnerId),
      results: row.results ?? []
    }
  }
  const counts = await pollCounts.get(sessionId, row.id).catch(() => ({}) as Record<string, string>)
  const numeric = row.options.map((_, index) => Number(counts[String(index + 1)] ?? 0))
  return {
    pollId: row.id,
    question: row.question,
    options: row.options,
    state: 'open',
    counts: viewer.role === 'learner' ? null : numeric,
    yourAnswer: await yourAnswer(row.id, viewer.learnerId)
  }
}

async function yourAnswer(pollId: string, learnerId: string | null): Promise<number | null> {
  if (!learnerId) return null
  const answer = await pool.query<{ option_number: number }>(
    `SELECT option_number FROM poll_answers WHERE poll_id = $1 AND learner_id = $2`,
    [pollId, learnerId]
  )
  return answer.rows[0]?.option_number ?? null
}

interface RoundRecord {
  deadline: Date
  warned: boolean
}

async function currentRound(sessionId: string): Promise<RoundRecord | null> {
  const answer = await pool.query<{ deadline: Date; warned: boolean }>(
    `SELECT deadline, warned FROM breakout_rounds WHERE session_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  )
  const row = answer.rows[0]
  if (!row) return null
  return { deadline: row.deadline, warned: row.warned }
}
