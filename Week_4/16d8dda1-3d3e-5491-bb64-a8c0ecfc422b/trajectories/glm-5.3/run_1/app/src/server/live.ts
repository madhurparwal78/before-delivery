import type { Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { SessionSnapshot } from '../shared/protocol.js'
import * as bus from './bus.js'
import { pool } from './db.js'
import { buildSnapshot, type Viewer } from './snapshot.js'
import { loadClass, loadLesson, loadSession } from './records.js'
import { setWorldClock, worldNow } from './clock.js'
import { runDue, settleDepartures } from './sessions.js'

// The live module keeps every connected page in step (DP-45). Each message
// carries the event name and that recipient's own snapshot.

interface Connection {
  sessionId: string
  viewer: Viewer
  worldId: string
  learnerId: string | null
  socket: WebSocket
}

const connections = new Set<Connection>()

export interface PushMessage {
  event: string
  snapshot: SessionSnapshot
  message?: string
}

async function snapshotFor(connection: Connection): Promise<SessionSnapshot | null> {
  const record = await loadSession(connection.sessionId)
  const classRecord = await loadClass(record?.classId ?? '')
  const lesson = await loadLesson(record?.lessonId ?? '')
  if (!record || !classRecord || !lesson) return null
  return buildSnapshot(record, classRecord, lesson, connection.viewer)
}

async function pushTo(connection: Connection, event: string, message?: string): Promise<void> {
  const snapshot = await snapshotFor(connection).catch(() => null)
  if (!snapshot) return
  const payload: PushMessage = message ? { event, snapshot, message } : { event, snapshot }
  if (connection.socket.readyState === WebSocket.OPEN) {
    connection.socket.send(JSON.stringify(payload))
  }
}

/** Pushes the current snapshot to every connected page of a session. */
export async function publishSession(sessionId: string, event: string, message?: string, learnerId?: string): Promise<void> {
  const targets = [...connections].filter(
    (connection) =>
      connection.sessionId === sessionId &&
      (learnerId === undefined || connection.learnerId === learnerId)
  )
  await Promise.all(targets.map((connection) => pushTo(connection, event, message)))
}

export async function publishAll(): Promise<void> {
  const sessionIds = new Set([...connections].map((connection) => connection.sessionId))
  await Promise.all([...sessionIds].map((sessionId) => publishSession(sessionId, 'tick')))
}

let pausedSince: number | null = null

export function livePaused(): boolean {
  return pausedSince !== null
}

async function checkBusState(): Promise<void> {
  if (bus.busDown()) {
    if (pausedSince === null) pausedSince = Date.now()
  } else if (pausedSince !== null) {
    pausedSince = null
    await publishAll()
    await publishAnnouncement('Live updates are back.')
  }
}

async function publishAnnouncement(text: string): Promise<void> {
  const sessionIds = new Set([...connections].map((connection) => connection.sessionId))
  await Promise.all([...sessionIds].map((sessionId) => publishSession(sessionId, 'notice', text)))
}

export function attachWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', async (request, socket, head) => {
    const url = request.url ?? ''
    const origin = request.headers.origin
    const host = request.headers.host
    if (origin && host && origin !== `http://${host}` && origin !== `https://${host}`) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    const match = /^\/ws\/sessions\/([^/]+)$/.exec(url)
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    const sessionId = decodeURIComponent(match[1])
    const viewer = await viewerForSocket(request, sessionId)
    if (!viewer) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void openConnection(ws, sessionId, viewer.viewer)
    })
  })

  bus.onBusMessage(async (_channel, message) => {
    try {
      const event = JSON.parse(message) as { sessionId: string; kind: string }
      await runDue(event.sessionId)
      await publishSession(event.sessionId, event.kind)
    } catch {
      // A malformed message on the bus never breaks the live pages.
    }
  })

  void liveLoop()
}

async function liveLoop(): Promise<void> {
  for (;;) {
    await checkBusState()
    const sessionIds = new Set([...connections].map((connection) => connection.sessionId))
    for (const sessionId of sessionIds) {
      try {
        const record = await loadSession(sessionId)
        if (!record) continue
        const announcements = await runDue(sessionId)
        if (announcements.length > 0) {
          for (const text of announcements) await publishSession(sessionId, 'notice', text)
        }
        await sweepDepartures(sessionId, record.worldId)
        if (record.state !== 'ended' && record.worldId === 'default') {
          await publishSession(sessionId, 'tick')
        }
      } catch {
        // The next loop retries.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function sweepDepartures(sessionId: string, worldId: string): Promise<void> {
  const gone = await settleDepartures(sessionId, worldId).catch(() => [] as string[])
  for (const learnerId of gone) {
    await bus.seats.clearSeat(sessionId, learnerId).catch(() => undefined)
    await bus.hands.lower(sessionId, learnerId).catch(() => undefined)
    const flags = await bus.flags.get(sessionId).catch(() => null)
    if (flags?.spotlight === learnerId) {
      await bus.flags.set(sessionId, 'spotlight', '')
      await publishSession(sessionId, 'notice', 'The spotlight has cleared.')
    }
  }
}

async function viewerForSocket(request: { headers: { cookie?: string } }, sessionId: string): Promise<{ viewer: Viewer; worldId: string } | null> {
  const cookie = parseCookies(request.headers.cookie ?? '')
  const token = cookie['slatehall_session']
  if (!token) return null
  const caller = await (await import('./auth.js')).callerFromCookie(token)
  if (caller.kind === 'teacher') {
    const teacher = caller.teacher
    const access = await (await import('./access.js')).loadSessionIfOpen(teacher.id, 'teacher', sessionId)
    if (!access) return null
    return {
      viewer: { role: access.role === 'owner' ? 'teacher' : 'co-teacher', learnerId: null },
      worldId: access.record.worldId
    }
  }
  if (caller.kind === 'learner') {
    const learner = caller.learner
    const access = await (await import('./access.js')).loadSessionIfOpen(learner.id, 'learner', sessionId)
    if (!access) return null
    return { viewer: { role: 'learner', learnerId: learner.id }, worldId: access.record.worldId }
  }
  return null
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

async function openConnection(socket: WebSocket, sessionId: string, viewer: Viewer): Promise<void> {
  const record = await loadSession(sessionId)
  if (!record) {
    socket.close()
    return
  }
  const connection: Connection = {
    sessionId,
    viewer,
    worldId: record.worldId,
    learnerId: viewer.learnerId,
    socket
  }
  connections.add(connection)

  if (viewer.learnerId) {
    const open = await pool.query(
      `SELECT 1 FROM presence_intervals
       WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL`,
      [sessionId, viewer.learnerId]
    )
    if (open.rows.length === 0) {
      // A seeded-open interval that has never seen a real connection stays
      // open with no grace running; a returning learner joins from now.
      const now = await worldNow(record.worldId)
      await pool.query(
        `INSERT INTO presence_intervals (session_id, learner_id, joined_at, left_at)
         VALUES ($1, $2, $3, NULL)`,
        [sessionId, viewer.learnerId, now]
      )
    }
    await bus.online.add(sessionId, viewer.learnerId).catch(() => undefined)
  }

  await pushTo(connection, 'snapshot')
  socket.on('close', () => {
    void handleClose(connection)
  })
  socket.on('error', () => {
    connections.delete(connection)
  })
}

async function handleClose(connection: Connection): Promise<void> {
  connections.delete(connection)
  if (!connection.learnerId) return
  const stillConnected = [...connections].some(
    (other) => other.sessionId === connection.sessionId && other.learnerId === connection.learnerId
  )
  if (stillConnected) return
  const record = await loadSession(connection.sessionId)
  if (!record) return
  const now = await worldNow(record.worldId)
  await pool.query(
    `UPDATE presence_intervals SET left_at = $3
     WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL`,
    [connection.sessionId, connection.learnerId, now]
  )
  await bus.online.remove(connection.sessionId, connection.learnerId).catch(() => undefined)
}

/** Runs everything that has become due in a world, then pushes messages. */
export async function runWorldDue(worldId: string): Promise<void> {
  const answer = await pool.query<{ id: string }>(
    `SELECT id FROM sessions WHERE world_id = $1 AND state IN ('open', 'live', 'breakouts')`,
    [worldId]
  )
  for (const row of answer.rows) {
    const announcements = await runDue(row.id)
    for (const text of announcements) {
      await publishSession(row.id, 'notice', text)
    }
  }
  await publishAll()
}

export { setWorldClock }
