import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { AccessLossReason, Layout, Person, Role, ServerMessage } from '../shared/domain.ts'
import { config } from './config.ts'

const CLOSE_NO_ACCESS = 4404
const wss = new WebSocketServer({ noServer: true })

interface Channel {
  socket: WebSocket
  projectId: string
  person: Person | null
  shareId: string | null
  shareExpiresAt: number | null
  lastMessage: number
}

const channels = new Set<Channel>()

function send(channel: Channel, message: ServerMessage): void {
  if (channel.socket.readyState === WebSocket.OPEN) channel.socket.send(JSON.stringify(message))
}

function inProject(projectId: string): Channel[] {
  return [...channels].filter((channel) => channel.projectId === projectId)
}

function publishPresence(projectId: string): void {
  const here = inProject(projectId)
  const people: Person[] = []
  for (const channel of here) {
    if (channel.person && !people.some((person) => person.userId === channel.person?.userId)) people.push(channel.person)
  }
  const message: ServerMessage = { type: 'presence', people, linkViewers: here.filter((channel) => !channel.person).length }
  for (const channel of here) send(channel, message)
}

function drop(channel: Channel): void {
  if (!channels.delete(channel)) return
  publishPresence(channel.projectId)
}

interface Opening {
  projectId: string
  person: Person | null
  shareId: string | null
  shareExpiresAt: number | null
  access: Role
  /** Reads the project as it is now; called after the channel is registered so no accepted edit can slip between. */
  load: () => Promise<{ revision: number; text: string; layout: Layout }>
}

export function acceptChannel(request: IncomingMessage, socket: Duplex, head: Buffer, opening: Opening): void {
  wss.handleUpgrade(request, socket, head, (ws) => {
    const channel: Channel = {
      socket: ws,
      projectId: opening.projectId,
      person: opening.person,
      shareId: opening.shareId,
      shareExpiresAt: opening.shareExpiresAt,
      lastMessage: Date.now(),
    }
    channels.add(channel)
    void opening.load().then(
      (state) => send(channel, { type: 'hello', ...state, access: opening.access, presenceTimeoutSeconds: config.presenceTimeoutSeconds }),
      () => ws.close(),
    )
    publishPresence(opening.projectId)
    ws.on('message', () => {
      channel.lastMessage = Date.now()
    })
    // A protocol pong is answered by the browser's network stack, so it proves the tab is still connected
    // even while the page's own timers are held back (a throttled background tab or a paused clock).
    ws.on('pong', () => {
      channel.lastMessage = Date.now()
    })
    ws.on('close', () => drop(channel))
    ws.on('error', () => drop(channel))
  })
}

export function publishRevision(projectId: string, revision: number, text: string, by: Person): void {
  for (const channel of inProject(projectId)) send(channel, { type: 'revision', revision, text, by })
}

export function publishLayout(projectId: string, layout: Layout, by: Person): void {
  for (const channel of inProject(projectId)) send(channel, { type: 'layout', layout, by })
}

function revoke(channel: Channel, reason: AccessLossReason): void {
  send(channel, { type: 'access', access: 'none', reason })
  channel.socket.close(CLOSE_NO_ACCESS)
  drop(channel)
}

/** Tells a person's open channels their role changed, or closes them when they lost access. */
export function publishMemberAccess(projectId: string, userId: string, access: 'editor' | 'viewer' | 'none', reason: AccessLossReason): void {
  for (const channel of inProject(projectId)) {
    if (channel.person?.userId !== userId) continue
    if (access === 'none') revoke(channel, reason)
    else send(channel, { type: 'access', access, reason })
  }
}

/** Closes every channel that was opened through a share. */
export function closeShareChannels(shareId: string, reason: AccessLossReason): void {
  for (const channel of [...channels]) if (channel.shareId === shareId) revoke(channel, reason)
}

/** Drops silent channels, closes link channels whose share has reached its expiry, and pings the rest. */
export function startSweeper(): void {
  setInterval(() => {
    const now = Date.now()
    for (const channel of [...channels]) {
      if (channel.shareExpiresAt !== null && channel.shareExpiresAt <= now) {
        revoke(channel, 'expired')
      } else if (now - channel.lastMessage > config.presenceTimeoutSeconds * 1000) {
        channel.socket.terminate()
        drop(channel)
      } else if (channel.socket.readyState === WebSocket.OPEN) {
        channel.socket.ping()
      }
    }
  }, 1000).unref()
}
