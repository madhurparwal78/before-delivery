import { newId } from '../canonical'
import { one } from '../db'
import {
  addExtraTrain, backToLoop, cancelAuthority, highball, parseExtraTrain, parseHighball, recall, saveNote, setBlockService, throwTurnout, withdraw,
} from '../domain/session/commands'
import { previewRoute } from '../domain/session/routing'
import { buildSnapshot, fastClockSeconds, type StoredTrain } from '../domain/session/state'
import type { SessionCommand } from '../../shared/session-states'
import { requireActive, requireCanAddTrain, transitionOrRefuse } from '../domain/session/transitions'
import { invalidFields, notFound, routeConflict, rule } from '../http/errors'
import { type Ctx, type Route } from '../http/pipeline'
import { EVERYONE, RUNNERS } from '../../shared/roles'
import { insertSession } from '../seed'
import { issuePacket, listPackets, loadPacket, loadPacketBytes, supersedeReady } from '../services/packets'
import { packetContent, packetHash } from '../domain/packets'
import { changeStatus, listSessions, loadSession, saveSession } from '../services/session-store'
import { sessionStream } from '../services/valkey'
import { json, textField, txOf } from './helpers'
import { searchBlocks } from './layouts'
import { serveEvents } from './stream'
import type { Authority, Conflict, LayoutContent } from '../../shared/domain'

const snapshot = (c: Ctx) => buildSnapshot(c.session)
const fastSeconds = (c: Ctx): number => fastClockSeconds(c.session.tick, c.session.ratio)

function findTrain(c: Ctx): void {
  const train = c.session.state.trains.find(candidate => candidate.id === c.params.train)
  if (train === undefined) throw notFound()
  c.found.train = train
}

const trainOf = (c: Ctx): StoredTrain => c.found.train as StoredTrain
const trainRevision = (c: Ctx): number => trainOf(c).revision
const controlRevision = (c: Ctx): number => c.session.control_revision

function control(command: SessionCommand, path: string): Route {
  return {
    method: 'POST', path: `/api/workspaces/:workspace/sessions/:session/${path}`, access: RUNNERS, load: 'session',
    revision: controlRevision,
    live: true,
    async handle(c) {
      const from = c.session.status
      const next = transitionOrRefuse(c.session, command)
      await changeStatus(txOf(c), c.session, next, { cause: command, from, to: next.status })
      return json(200, snapshot(c))
    },
  }
}

export const sessionRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions', access: EVERYONE,
    async handle(c) {
      return json(200, { sessions: await listSessions(c.client, c.workspaceId as string) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions', access: RUNNERS, load: 'workspace',
    async handle(c) {
      const name = textField(c.body, 'name', 'a session name')
      const ratio = c.body.ratio === undefined ? 6 : c.body.ratio
      if (!Number.isInteger(ratio) || (ratio as number) < 1 || (ratio as number) > 12) throw invalidFields({ ratio: 'Enter a whole number from 1 to 12.' })
      const version = typeof c.body.layout_version_id === 'string'
        ? await one<{ id: string; layout_id: string; number: number; state: string; content: LayoutContent }>(txOf(c).client,
          `select v.id, v.layout_id, v.number, v.state, v.content from layout_versions v join layouts l on l.id = v.layout_id where v.id = $1 and l.workspace_id = $2`, [c.body.layout_version_id, c.workspaceId])
        : undefined
      if (version === undefined) throw invalidFields({ layout_version_id: 'Choose a Published version.' })
      if (version.state !== 'Published') throw rule('version_not_published', 'Only a Published version can run a session.')
      const id = newId('ses')
      await insertSession(txOf(c).client, {
        id, workspaceId: c.workspaceId as string, layoutId: version.layout_id, name, status: 'Scheduled', ratio: ratio as number,
        versionId: version.id, versionNumber: version.number, content: version.content,
      })
      c.session = (await loadSession(txOf(c).client, id, false)) as typeof c.session
      return json(201, snapshot(c))
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session', access: EVERYONE, load: 'session',
    handle: async c => json(200, snapshot(c)),
  },
  control('start', 'start'),
  control('hold', 'hold'),
  control('resume', 'resume'),
  control('end', 'end'),
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/trains', access: RUNNERS, load: 'session',
    revision: c => c.session.session_version,
    live: true,
    async handle(c) {
      requireCanAddTrain(c.session.status)
      const train = addExtraTrain(c.session.state, parseExtraTrain(c.body, c.session.state))
      c.session.session_version += 1
      const superseded = await supersedeReady(txOf(c).client, c.session.id)
      await saveSession(txOf(c), c.session, { type: 'session.version', detail: { train_id: train.id, number: train.number, superseded_packet_ids: superseded } })
      return json(201, snapshot(c))
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/trains/:train/route-preview', access: RUNNERS, load: 'session', key: false,
    resolve: findTrain,
    async handle(c) {
      const destination = c.body.destination_block_id
      const via = c.body.via_block_id
      const known = (id: unknown): boolean => typeof id === 'string' && c.session.state.blocks.some(block => block.id === id)
      if (!known(destination)) throw invalidFields({ destination_block_id: 'Choose a destination block.' })
      if (via !== undefined && via !== null && via !== '' && !known(via)) throw invalidFields({ via_block_id: 'Choose a block on this layout.' })
      return json(200, previewRoute(c.session.state, trainOf(c), destination as string, via === undefined || via === null || via === '' ? null : via as string))
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session/blocks', access: EVERYONE, load: 'session',
    handle: async c => json(200, { blocks: searchBlocks(c.session.state.blocks, c.query.get('q')) }),
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/trains/:train/authorities', access: RUNNERS, load: 'session',
    resolve: findTrain,
    revision: trainRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status)
      const train = trainOf(c)
      const outcome = highball(c.session.state, train, parseHighball(c.body, c.session.state), fastSeconds(c))
      if (outcome.granted) {
        await saveSession(txOf(c), c.session, { type: 'authority.granted', detail: { authority: outcome.authority, train_number: train.number } })
        return json(201, { authority: outcome.authority, session: snapshot(c) })
      }
      await saveSession(txOf(c), c.session, { type: 'authority.refused', detail: { authority: outcome.authority, conflict: outcome.conflict, train_number: train.number } })
      const refusal = routeConflict(outcome.message, {
        authority: outcome.authority, conflict: outcome.conflict, reachable_block_ids: outcome.reachable_block_ids,
      })
      return { status: refusal.status, body: refusal.body }
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/authorities/:authority/cancel', access: RUNNERS, load: 'session',
    resolve(c) {
      const authority = c.session.state.authorities.find(candidate => candidate.id === c.params.authority)
      if (authority === undefined) throw notFound()
      c.found.authority = authority
    },
    revision: c => (c.found.authority as Authority).revision,
    live: true,
    async handle(c) {
      requireActive(c.session.status)
      const authority = c.found.authority as Authority
      cancelAuthority(c.session.state, authority)
      await saveSession(txOf(c), c.session, { type: 'authority.released', detail: { authority_id: authority.id, ended_reason: 'cancelled' } })
      return json(200, { authority, session: snapshot(c) })
    },
  },
  ...(['back-to-loop', 'recall'] as const).map((command): Route => ({
    method: 'POST', path: `/api/workspaces/:workspace/sessions/:session/trains/:train/${command}`, access: RUNNERS, load: 'session',
    resolve: findTrain,
    revision: trainRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status)
      const moved = command === 'recall' ? recall(c.session.state, trainOf(c)) : backToLoop(c.session.state, trainOf(c))
      await saveSession(txOf(c), c.session, { type: 'train.moved', detail: { ...moved.detail, block_id: moved.block.id, command } })
      return json(200, snapshot(c))
    },
  })),
  {
    method: 'PATCH', path: '/api/workspaces/:workspace/sessions/:session/conflicts/:conflict', access: RUNNERS, load: 'session',
    resolve(c) {
      const conflict = c.session.state.conflicts.find(candidate => candidate.id === c.params.conflict)
      if (conflict === undefined) throw notFound()
      c.found.conflict = conflict
    },
    revision: c => (c.found.conflict as Conflict).revision,
    live: true,
    async handle(c) {
      const conflict = c.found.conflict as Conflict
      saveNote(conflict, c.body.note)
      await saveSession(txOf(c), c.session, { type: 'conflict.changed', detail: { conflict_id: conflict.id } })
      return json(200, { conflict })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/conflicts/:conflict/withdraw', access: RUNNERS, load: 'session',
    resolve(c) {
      const conflict = c.session.state.conflicts.find(candidate => candidate.id === c.params.conflict)
      if (conflict === undefined) throw notFound()
      c.found.conflict = conflict
    },
    revision: c => (c.found.conflict as Conflict).revision,
    live: true,
    async handle(c) {
      const conflict = c.found.conflict as Conflict
      withdraw(c.session.state, conflict)
      await saveSession(txOf(c), c.session, { type: 'conflict.closed', detail: { conflict_id: conflict.id } })
      return json(200, snapshot(c))
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/blocks/:block/service', access: RUNNERS, load: 'session',
    resolve(c) {
      if (!c.session.state.blocks.some(block => block.id === c.params.block)) throw notFound()
    },
    revision: controlRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status)
      if (typeof c.body.out_of_service !== 'boolean') throw invalidFields({ out_of_service: 'Choose true or false.' })
      const block = c.session.state.blocks.find(candidate => candidate.id === c.params.block) as NonNullable<typeof c.session.state.blocks[number]>
      setBlockService(c.session.state, block, c.body.out_of_service)
      await saveSession(txOf(c), c.session, { type: 'block.changed', control: true, detail: { block_id: block.id, out_of_service: block.out_of_service } })
      return json(200, snapshot(c))
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/turnouts/:turnout/throw', access: RUNNERS, load: 'session',
    resolve(c) {
      if (!c.session.state.turnouts.some(turnout => turnout.id === c.params.turnout)) throw notFound()
    },
    revision: controlRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status)
      if (c.body.position !== 'normal' && c.body.position !== 'reverse') throw invalidFields({ position: 'Choose normal or reverse.' })
      throwTurnout(c.session.state, c.params.turnout, c.body.position)
      await saveSession(txOf(c), c.session, { type: 'turnout.changed', control: true, detail: { turnout_id: c.params.turnout, position: c.body.position } })
      return json(200, snapshot(c))
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session/events', access: EVERYONE, load: 'session',
    live: true,
    handle: c => serveEvents(c, sessionStream(c.session.id), c.session.revision),
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session/packets', access: EVERYONE, load: 'session',
    handle: async c => json(200, { packets: await listPackets(c.client, c.session.id) }),
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session/packets/preview', access: EVERYONE, load: 'session',
    async handle(c) {
      const content = packetContent(c.session.state)
      return json(200, { session_version: c.session.session_version, content, content_hash: packetHash(c.session.session_version, content) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/sessions/:session/packets', access: RUNNERS, load: 'session',
    revision: c => c.session.session_version,
    async handle(c) {
      const packet = await issuePacket(txOf(c), c.session.id, c.workspaceId as string, c.session.session_version, c.user.display_name)
      return json(202, { packet })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session/packets/:packet', access: EVERYONE, load: 'session',
    async handle(c) {
      const packet = await loadPacket(c.client, c.session.id, c.params.packet)
      if (packet === undefined) throw notFound()
      return json(200, packet)
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/sessions/:session/packets/:packet/pdf', access: EVERYONE, load: 'session',
    async handle(c) {
      const bytes = await loadPacketBytes(c.client, c.session.id, c.params.packet)
      if (bytes === undefined) throw notFound()
      if (bytes === null) throw rule('packet_no_pdf', 'This packet has no PDF.')
      return { status: 200, raw: bytes, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="crew-packet-${c.params.packet}.pdf"` } }
    },
  },
]
