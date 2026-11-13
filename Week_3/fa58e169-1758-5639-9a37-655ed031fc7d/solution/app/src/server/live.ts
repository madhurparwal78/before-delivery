import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { LiveMessage, PersonRef } from '../shared/api.ts'
import { type User, userOf } from './auth.ts'
import { config } from './config.ts'
import { pool } from './db.ts'
import { accessOf } from './store.ts'
import { isLive, onLiveChange, presenceAnnounce, presenceLeave, presenceList, publish } from './valkey.ts'

type Audience = 'designers' | 'testers' | `user:${string}`

interface Socket { ws: WebSocket; user: User; patternId: string | null; designer: boolean }

const sockets = new Set<Socket>()
const open = new Map<string, number>()
const holds = new Map<string, string[] | null>()

const keyOf = (patternId: string, userId: string) => `${patternId}:${userId}`

export function emit(patternId: string, audience: Audience[], message: LiveMessage): Promise<void> {
  return publish(patternId, { audience, message })
}

function wants(socket: Socket, audience: Audience[]): boolean {
  if (audience.includes(`user:${socket.user.id}`)) return true
  return socket.designer ? audience.includes('designers') : audience.includes('testers')
}

function deliver(socket: Socket, text: string): void {
  const held = holds.get(keyOf(socket.patternId!, socket.user.email))
  if (held) held.push(text)
  else if (socket.ws.readyState === WebSocket.OPEN) socket.ws.send(text)
}

export function receive(patternId: string, payload: string): void {
  const { audience, message } = JSON.parse(payload) as { audience: Audience[]; message: LiveMessage }
  const text = JSON.stringify(message)
  for (const socket of sockets) {
    if (socket.patternId === patternId && wants(socket, audience)) deliver(socket, text)
  }
}

export function holdUpdates(patternId: string, email: string, hold: boolean): void {
  const key = keyOf(patternId, email)
  if (hold) {
    if (!holds.get(key)) holds.set(key, [])
    return
  }
  const queued = holds.get(key) ?? []
  holds.delete(key)
  for (const socket of sockets) {
    if (socket.patternId === patternId && socket.user.email === email) queued.forEach((text) => deliver(socket, text))
  }
}

async function people(patternId: string): Promise<PersonRef[]> {
  return (await presenceList(patternId)) ?? []
}

async function joined(socket: Socket): Promise<void> {
  const key = keyOf(socket.patternId!, socket.user.id)
  const count = (open.get(key) ?? 0) + 1
  open.set(key, count)
  if (count === 1) {
    await presenceAnnounce(socket.patternId!, socket.user.id, socket.user.name)
    void emit(socket.patternId!, ['designers'], { type: 'presence', users: await people(socket.patternId!) })
  }
}

async function left(socket: Socket): Promise<void> {
  const key = keyOf(socket.patternId!, socket.user.id)
  const remaining = open.get(key)! - 1
  if (remaining > 0) return void open.set(key, remaining)
  open.delete(key)
  await presenceLeave(socket.patternId!, socket.user.id)
  void emit(socket.patternId!, ['designers'], { type: 'presence', users: await people(socket.patternId!) })
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })

async function connect(ws: WebSocket, user: User, patternId: string | null): Promise<void> {
  const access = patternId ? await accessOf(pool, user.id, patternId) : null
  const socket: Socket = { ws, user, patternId: access ? patternId : null, designer: !!access && access.role !== 'tester' }
  sockets.add(socket)
  ws.on('close', () => {
    sockets.delete(socket)
    if (socket.designer) void left(socket)
  })
  ws.on('message', (data) => {
    if (!socket.designer) return
    try {
      const message = JSON.parse(data.toString()) as { type?: string; row?: unknown; col?: unknown }
      if (message.type === 'cursor' && Number.isInteger(message.row) && Number.isInteger(message.col)) {
        void emit(socket.patternId!, ['designers'], { type: 'cursor', user: { id: user.id, name: user.name },
          row: message.row as number, col: message.col as number })
      }
    } catch {
      // ignore frames that are not JSON
    }
  })
  const users = socket.designer ? await people(socket.patternId!) : []
  ws.send(JSON.stringify({ type: 'hello', live: isLive(), users } satisfies LiveMessage))
  if (socket.designer) await joined(socket)
}

export function acceptSocket(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? '/', 'http://local')
  if (url.pathname !== '/api/live') return void socket.destroy()
  userOf(req).then((user) => {
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return void socket.destroy()
    }
    wss.handleUpgrade(req, socket, head, (ws) => { connect(ws, user, url.searchParams.get('pattern')).catch(() => ws.close()) })
  }).catch(() => socket.destroy())
}

export function startLive(): void {
  onLiveChange((live) => {
    const text = JSON.stringify({ type: 'live', live } satisfies LiveMessage)
    for (const socket of sockets) if (socket.ws.readyState === WebSocket.OPEN) socket.ws.send(text)
    if (live) void refreshPresence()
  })
  setInterval(() => void refreshPresence(), (config.limits.presenceTtlSeconds * 1000) / 3).unref()
}

async function refreshPresence(): Promise<void> {
  const seen = new Set<string>()
  for (const socket of sockets) {
    if (!socket.designer || seen.has(keyOf(socket.patternId!, socket.user.id))) continue
    seen.add(keyOf(socket.patternId!, socket.user.id))
    await presenceAnnounce(socket.patternId!, socket.user.id, socket.user.name)
  }
}
