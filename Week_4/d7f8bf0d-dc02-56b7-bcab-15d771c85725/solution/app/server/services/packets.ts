import type { CrewPacket, PacketFailure } from '../../shared/domain'
import { newId } from '../canonical'
import { db, one, rows, transaction, type Db, type Tx } from '../db'
import { packetContent, packetFooterHtml, packetHash, packetHtml } from '../domain/packets'
import { loadSession, saveSession } from './session-store'
import type { Gotenberg } from './gotenberg'
import type { Valkey } from './valkey'

interface PacketRow {
  id: string
  session_id: string
  state: CrewPacket['state']
  content_hash: string
  session_version: number
  failure: PacketFailure
  issued_by: string
  issued_at: Date
  ready_at: Date | null
  byte_length: number | null
}

const COLUMNS = `id, session_id, state, content_hash, session_version, failure, issued_by, issued_at, ready_at,
  case when pdf_bytes is null then null else length(pdf_bytes) end as byte_length`

function toPacket(row: PacketRow): CrewPacket {
  return {
    id: row.id,
    state: row.state,
    session_version: row.session_version,
    content_hash: row.content_hash,
    failure: row.failure,
    issued_by: row.issued_by,
    issued_at: row.issued_at.toISOString(),
    ready_at: row.ready_at === null ? null : row.ready_at.toISOString(),
    byte_length: row.byte_length,
  }
}

export async function listPackets(client: Db, sessionId: string): Promise<CrewPacket[]> {
  return (await rows<PacketRow>(client, `select ${COLUMNS} from crew_packets where session_id = $1 order by issued_at, id`, [sessionId])).map(toPacket)
}

export async function loadPacket(client: Db, sessionId: string, packetId: string): Promise<CrewPacket | undefined> {
  const row = await one<PacketRow>(client, `select ${COLUMNS} from crew_packets where session_id = $1 and id = $2`, [sessionId, packetId])
  return row === undefined ? undefined : toPacket(row)
}

export async function loadPacketBytes(client: Db, sessionId: string, packetId: string): Promise<Buffer | null | undefined> {
  const row = await one<{ pdf_bytes: Buffer | null }>(client, 'select pdf_bytes from crew_packets where session_id = $1 and id = $2', [sessionId, packetId])
  return row === undefined ? undefined : row.pdf_bytes
}

async function packetNow(client: Db, packetId: string): Promise<CrewPacket> {
  return toPacket(await one<PacketRow>(client, `select ${COLUMNS} from crew_packets where id = $1`, [packetId]) as PacketRow)
}

// Called with the session row locked: a Queued packet and its event land together.
export async function issuePacket(tx: Tx, sessionId: string, workspaceId: string, sessionVersion: number, issuedBy: string): Promise<CrewPacket> {
  const session = await loadSession(tx.client, sessionId, true)
  if (session === undefined) throw new Error('session vanished')
  const id = newId('pk')
  await tx.client.query(
    `insert into crew_packets (id, session_id, workspace_id, state, session_version, issued_by) values ($1, $2, $3, 'Queued', $4, $5)`,
    [id, sessionId, workspaceId, sessionVersion, issuedBy],
  )
  const packet = await packetNow(tx.client, id)
  await saveSession(tx, session, { type: 'packet.changed', detail: { packet } })
  return packet
}

// A rename reaching the session or an extra train leaves the stored PDF unchanged and marks the packet Superseded.
export async function supersedeReady(client: Db, sessionId: string): Promise<string[]> {
  const found = await rows<{ id: string }>(client, `update crew_packets set state = 'Superseded', updated_at = now() where session_id = $1 and state = 'Ready' returning id`, [sessionId])
  return found.map(row => row.id)
}

const RENDERING_STALE_MS = 30_000

export class PacketWorker {
  private readonly active = new Set<string>()

  constructor(private readonly gotenberg: Gotenberg, private readonly valkey: Valkey) {}

  start(): void {
    setInterval(() => void this.poll(), 500)
  }

  private async poll(): Promise<void> {
    const queued = await rows<{ id: string; session_id: string }>(db(), `select id, session_id from crew_packets where state = 'Queued' order by issued_at limit 5`).catch(() => [])
    for (const packet of queued) {
      if (this.active.has(packet.id)) continue
      this.active.add(packet.id)
      void this.render(packet.id, packet.session_id).catch(() => undefined).finally(() => this.active.delete(packet.id))
    }
    const stale = await rows<{ id: string; session_id: string }>(db(),
      `select id, session_id from crew_packets where state = 'Rendering' and updated_at < now() - interval '${RENDERING_STALE_MS / 1000} seconds' limit 5`).catch(() => [])
    for (const packet of stale) {
      if (!this.active.has(packet.id)) await this.fail(packet.id, packet.session_id, 'gotenberg_unreachable').catch(() => undefined)
    }
  }

  private async move(packetId: string, sessionId: string, from: CrewPacket['state'], to: CrewPacket['state'], values: { failure?: PacketFailure; pdf?: Buffer; hash?: string; version?: number }): Promise<boolean> {
    return transaction(async tx => {
      const session = await loadSession(tx.client, sessionId, true)
      const current = await one<{ state: string }>(tx.client, 'select state from crew_packets where id = $1 for update', [packetId])
      if (session === undefined || current?.state !== from) return false
      await tx.client.query(
        `update crew_packets set state = $2, failure = $3, pdf_bytes = coalesce($4, pdf_bytes), content_hash = coalesce($5, content_hash),
           session_version = coalesce($6, session_version), ready_at = case when $2 = 'Ready' then now() else ready_at end, updated_at = now() where id = $1`,
        [packetId, to, values.failure ?? null, values.pdf ?? null, values.hash ?? null, values.version ?? null],
      )
      await saveSession(tx, session, { type: 'packet.changed', detail: { packet: await packetNow(tx.client, packetId) } })
      return true
    })
  }

  private async fail(packetId: string, sessionId: string, failure: PacketFailure): Promise<void> {
    const from = (await one<{ state: CrewPacket['state'] }>(db(), 'select state from crew_packets where id = $1', [packetId]))?.state
    if (from === 'Queued' || from === 'Rendering') await this.move(packetId, sessionId, from, 'Failed', { failure })
  }

  private async render(packetId: string, sessionId: string): Promise<void> {
    if (!(await this.move(packetId, sessionId, 'Queued', 'Rendering', {}))) return
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await loadSession(db(), sessionId, false)
      if (session === undefined) return
      const content = packetContent(session.state)
      const hash = packetHash(session.session_version, content)
      let pdf: Buffer
      try {
        pdf = await this.gotenberg.render(packetHtml(session.name, session.session_version, content, session.state.blocks), packetFooterHtml(session.session_version, hash))
      } catch {
        await this.fail(packetId, sessionId, 'gotenberg_unreachable')
        return
      }
      if (!(await this.valkey.ping())) {
        await this.fail(packetId, sessionId, 'valkey_unreachable')
        return
      }
      const current = await loadSession(db(), sessionId, false)
      const unchanged = current !== undefined && packetHash(current.session_version, packetContent(current.state)) === hash
      if (unchanged || attempt === 2) {
        await this.move(packetId, sessionId, 'Rendering', 'Ready', { pdf, hash, version: session.session_version })
        return
      }
    }
  }
}
