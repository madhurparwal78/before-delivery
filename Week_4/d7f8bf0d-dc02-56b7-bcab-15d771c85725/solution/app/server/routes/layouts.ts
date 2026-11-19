import type { Endplate, LayoutBlock, LayoutModule, PieceBody, Piece, TrashedModule } from '../../shared/domain'
import { newId } from '../canonical'
import { rows } from '../db'
import { appendPiece, changeRise, consumerOf, findOpenEnd, followersOf, newModule, normalizeContent, removePiece } from '../domain/layout-model'
import { checkLayout, pieceFindings } from '../domain/rules'
import { renameInSessions } from '../services/rename'
import { invalidFields, notFound, openEndTaken, pieceRefused, rule } from '../http/errors'
import { type Ctx, type Route } from '../http/pipeline'
import { BUILDERS, EVERYONE, MANAGERS } from '../../shared/roles'
import {
  layoutCounts, layoutHistory, saveLayout, workingHash, type LayoutChange, type LayoutRow, type TrashEntry,
} from '../services/layout-store'
import { layoutStream } from '../services/valkey'
import { actorOf, json, textField, txOf } from './helpers'
import { serveEvents } from './stream'

export async function standardsOf(client: Parameters<typeof rows>[0], workspaceId: string) {
  const [row] = await rows<{ standards: import('../../shared/domain').StandardsProfile }>(client, 'select standards from workspaces where id = $1', [workspaceId])
  return row.standards
}


async function commit(c: Ctx, change: LayoutChange): Promise<void> {
  c.layout.content = normalizeContent(c.layout.content)
  await saveLayout(txOf(c), c.layout, change)
}

const moduleOf = (layout: LayoutRow, id: string): LayoutModule | undefined => layout.content.modules.find(module => module.id === id)
const moduleRevision = (layout: LayoutRow, id: string): number => layout.module_revisions[id] ?? 0
const bumpModuleRevision = (layout: LayoutRow, id: string): void => {
  layout.module_revisions[id] = moduleRevision(layout, id) + 1
}

function writeReceipt(c: Ctx): { layout_revision: number; working_hash: string } {
  return { layout_revision: c.layout.revision, working_hash: workingHash(c.layout.content) }
}

function parsePiece(raw: unknown): PieceBody {
  const body = (raw ?? {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  const whole = (name: string, min: number, max: number): number => {
    const value = body[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fields[`piece.${name}`] = `Enter a whole number from ${min} to ${max}.`
    return value as number
  }
  const rise = body.rise_mm === undefined ? 0 : whole('rise_mm', -2000, 2000)
  const mainline = body.mainline === undefined ? true : body.mainline
  if (typeof mainline !== 'boolean') fields['piece.mainline'] = 'Choose true or false.'
  const hand = body.hand
  let piece: PieceBody | undefined
  if (body.kind === 'straight') {
    piece = { kind: 'straight', length_mm: whole('length_mm', 1, 5000), rise_mm: rise, mainline: mainline as boolean }
  } else if (body.kind === 'curve') {
    if (hand !== 'left' && hand !== 'right') fields['piece.hand'] = 'Choose left or right.'
    piece = { kind: 'curve', radius_mm: whole('radius_mm', 1, 20000), angle_deg: whole('angle_deg', 1, 90), hand: hand as 'left', rise_mm: rise, mainline: mainline as boolean }
  } else if (body.kind === 'turnout') {
    if (hand !== 'left' && hand !== 'right') fields['piece.hand'] = 'Choose left or right.'
    piece = { kind: 'turnout', frog_number: whole('frog_number', 1, 30), hand: hand as 'left', length_mm: whole('length_mm', 1, 5000), rise_mm: rise, mainline: mainline as boolean }
  } else {
    fields['piece.kind'] = 'Choose straight, curve or turnout.'
  }
  if (Object.keys(fields).length > 0 || piece === undefined) throw invalidFields(fields)
  return piece
}

function parseEndplates(raw: unknown): Endplate[] {
  const plates = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
  const valid = plates.length === 2 && plates.every((plate, index) =>
    plate.end === (index === 0 ? 'A' : 'B') && Number.isInteger(plate.width_mm)
    && Array.isArray(plate.track_offsets_mm) && plate.track_offsets_mm.length >= 1 && plate.track_offsets_mm.every(Number.isInteger))
  if (!valid) throw invalidFields({ endplates: 'Give endplates A and B with a width and track offsets in whole millimetres.' })
  return plates.map(plate => ({ end: plate.end as 'A' | 'B', width_mm: plate.width_mm as number, track_offsets_mm: plate.track_offsets_mm as number[] }))
}

export function searchBlocks(blocks: Array<Pick<LayoutBlock, 'id' | 'number' | 'name' | 'kind'>>, query: string | null) {
  const needle = (query ?? '').trim().toLowerCase()
  return [...blocks].sort((a, b) => a.number - b.number)
    .filter(block => needle === '' || block.name.toLowerCase().includes(needle) || String(block.number) === needle)
    .map(block => ({ id: block.id, number: block.number, name: block.name, kind: block.kind }))
}

function placeOrigin(layout: LayoutRow): { x_mm: number; y_mm: number; heading_deg: number } {
  const placed = layout.content.modules.length + layout.trash.length
  return { x_mm: -4500 + (placed % 4) * 2400, y_mm: -3500 - Math.floor(placed / 4) * 1500, heading_deg: 0 }
}

export const layoutRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts', access: EVERYONE,
    async handle(c) {
      const found = await rows<LayoutRow>(c.client, 'select id, workspace_id, name, revision, content, trash, module_revisions from layouts where workspace_id = $1 order by created_at, id', [c.workspaceId])
      return json(200, { layouts: found.map(layout => ({ id: layout.id, name: layout.name, revision: layout.revision, counts: layoutCounts(layout) })) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts', access: MANAGERS, load: 'workspace',
    async handle(c) {
      const name = textField(c.body, 'name', 'a layout name')
      const content = normalizeContent({ modules: [], blocks: [], stations: [], turnouts: [], trains: [], timetable: { version: 0, entries: [] } })
      const id = newId('lay')
      await txOf(c).client.query('insert into layouts (id, workspace_id, name, revision, content) values ($1, $2, $3, 1, $4)', [id, c.workspaceId, name, JSON.stringify(content)])
      return json(201, { layout: { id, name, revision: 1, counts: { modules: 0, pieces: 0, blocks: 0, trash: 0 } } })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout', access: EVERYONE, load: 'layout',
    async handle(c) {
      return json(200, {
        id: c.layout.id,
        name: c.layout.name,
        revision: c.layout.revision,
        working_hash: workingHash(c.layout.content),
        content: c.layout.content,
        module_revisions: c.layout.module_revisions,
        counts: layoutCounts(c.layout),
      })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout/blocks', access: EVERYONE, load: 'layout',
    async handle(c) {
      return json(200, { blocks: searchBlocks(c.layout.content.blocks, c.query.get('q')) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/check', access: BUILDERS, load: 'layout', key: false,
    async handle(c) {
      const findings = checkLayout(c.layout.content, await standardsOf(c.client, c.workspaceId as string))
      return json(200, { passed: findings.length === 0, findings })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/modules', access: BUILDERS, load: 'layout',
    revision: c => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, 'name', 'a module name')
      const module = newModule(newId('mod'), name, parseEndplates(c.body.endplates), placeOrigin(c.layout), newId)
      c.layout.content.modules.push(module)
      c.layout.module_revisions[module.id] = 1
      await commit(c, { type: 'module.changed', actor: actorOf(c), detail: { module_id: module.id, change: 'added' }, history: [{ action: 'module.added', object_id: module.id, module_id: module.id }] })
      return json(201, { module: moduleOf(c.layout, module.id), layout_revision: c.layout.revision })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/modules/:module/trash', access: BUILDERS, load: 'layout',
    resolve(c) {
      if (moduleOf(c.layout, c.params.module) === undefined) throw notFound()
    },
    revision: c => c.layout.revision,
    async handle(c) {
      const module = moduleOf(c.layout, c.params.module) as LayoutModule
      const { content } = c.layout
      const blocks = content.blocks.filter(block => block.module_id === module.id)
      const owned = new Set(blocks.map(block => block.id))
      const turnouts = content.turnouts.filter(turnout => owned.has(turnout.stem_block_id))
      const entry: TrashEntry = { module, blocks, turnouts, revision: moduleRevision(c.layout, module.id), trashed_by: c.user.display_name, trashed_at: new Date().toISOString() }
      content.modules = content.modules.filter(candidate => candidate.id !== module.id)
      content.blocks = content.blocks.filter(block => !owned.has(block.id))
      content.turnouts = content.turnouts.filter(turnout => !owned.has(turnout.stem_block_id))
      delete c.layout.module_revisions[module.id]
      c.layout.trash.push(entry)
      await commit(c, { type: 'module.changed', actor: actorOf(c), detail: { module_id: module.id, change: 'trashed' }, history: [{ action: 'module.trashed', object_id: module.id, module_id: module.id, from: module.name }] })
      return json(200, writeReceipt(c))
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout/trash', access: EVERYONE, load: 'layout',
    async handle(c) {
      const modules: TrashedModule[] = c.layout.trash.map(entry => ({ id: entry.module.id, name: entry.module.name, trashed_by: entry.trashed_by, trashed_at: entry.trashed_at }))
      return json(200, { modules })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/trash/:module/undo', access: MANAGERS, load: 'layout',
    resolve(c) {
      const entry = c.layout.trash.find(candidate => candidate.module.id === c.params.module)
      if (entry === undefined) throw notFound()
      c.found.entry = entry
    },
    revision: c => c.layout.revision,
    async handle(c) {
      const entry = c.found.entry as TrashEntry
      const { content } = c.layout
      content.modules.push(entry.module)
      content.blocks.push(...entry.blocks)
      content.turnouts.push(...entry.turnouts)
      c.layout.module_revisions[entry.module.id] = entry.revision + 1
      c.layout.trash = c.layout.trash.filter(candidate => candidate !== entry)
      await commit(c, { type: 'module.changed', actor: actorOf(c), detail: { module_id: entry.module.id, change: 'restored' }, history: [{ action: 'module.restored', object_id: entry.module.id, module_id: entry.module.id, to: entry.module.name }] })
      return json(200, { module: moduleOf(c.layout, entry.module.id), ...writeReceipt(c) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/trash/:module/purge', access: MANAGERS, load: 'layout',
    resolve(c) {
      if (!c.layout.trash.some(candidate => candidate.module.id === c.params.module)) throw notFound()
    },
    revision: c => c.layout.revision,
    async handle(c) {
      c.layout.trash = c.layout.trash.filter(candidate => candidate.module.id !== c.params.module)
      await txOf(c).client.query(
        `update layout_history set action = 'purged', object_id = null, module_id = null, from_value = null, to_value = null where layout_id = $1 and module_id = $2`,
        [c.layout.id, c.params.module])
      await commit(c, { type: 'module.changed', actor: actorOf(c), detail: { change: 'purged' }, history: [{ action: 'purged', object_id: null }] })
      return json(200, { layout_revision: c.layout.revision })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/modules/:module/pieces', access: BUILDERS, load: 'layout',
    async resolve(c) {
      const module = moduleOf(c.layout, c.params.module)
      if (module === undefined) throw notFound()
      c.found.module = module
      const taker = typeof c.body.open_end_id === 'string' ? consumerOf(module, c.body.open_end_id) : undefined
      if (taker?.added_by != null) {
        const [row] = await rows<{ display_name: string }>(c.client, 'select display_name from users where id = $1', [taker.added_by])
        c.found.takerName = row?.display_name
      }
    },
    // A consumed open end answers open_end_taken in place of stale_revision; a stale revision with the end open stays stale.
    revision(c) {
      const module = c.found.module as LayoutModule
      const openEndId = c.body.open_end_id
      if (typeof openEndId !== 'string') throw invalidFields({ open_end_id: 'Select an open end.' })
      if (findOpenEnd(module, openEndId) === undefined) {
        const taker = consumerOf(module, openEndId)
        if (taker === undefined) throw invalidFields({ open_end_id: 'That open end is not on this module.' })
        throw openEndTaken(taker.open_end_label, String(c.found.takerName ?? 'another member'), moduleRevision(c.layout, module.id), taker.id)
      }
      return moduleRevision(c.layout, module.id)
    },
    async handle(c) {
      const module = c.found.module as LayoutModule
      const openEnd = findOpenEnd(module, c.body.open_end_id as string) as NonNullable<ReturnType<typeof findOpenEnd>>
      const body = parsePiece(c.body.piece)
      const findings = pieceFindings(module, openEnd.piece_id, body, null, await standardsOf(c.client, c.workspaceId as string))
      if (findings.length > 0) throw pieceRefused(findings)
      const piece = appendPiece(module, openEnd.id, body, c.user.id, newId)
      bumpModuleRevision(c.layout, module.id)
      await commit(c, { type: 'piece.added', actor: actorOf(c), detail: { module_id: module.id, piece_id: piece.id }, history: [{ action: 'piece.added', object_id: piece.id, module_id: module.id }] })
      const saved = moduleOf(c.layout, module.id) as LayoutModule
      return json(201, { piece: saved.pieces.find(candidate => candidate.id === piece.id), open_ends: saved.open_ends, module_revision: moduleRevision(c.layout, module.id), ...writeReceipt(c) })
    },
  },
  {
    method: 'PATCH', path: '/api/workspaces/:workspace/layouts/:layout/modules/:module/pieces/:piece', access: BUILDERS, load: 'layout',
    resolve(c) {
      const module = moduleOf(c.layout, c.params.module)
      const piece = module?.pieces.find(candidate => candidate.id === c.params.piece)
      if (module === undefined || piece === undefined) throw notFound()
      c.found.module = module
      c.found.piece = piece
    },
    revision: c => moduleRevision(c.layout, c.params.module),
    async handle(c) {
      const module = c.found.module as LayoutModule
      const piece = c.found.piece as Piece
      const fields: Record<string, string> = {}
      const rise = c.body.rise_mm
      if (rise !== undefined && (typeof rise !== 'number' || !Number.isInteger(rise) || Math.abs(rise) > 2000)) fields.rise_mm = 'Enter a whole number of millimetres.'
      const blockId = c.body.block_id
      if (blockId !== undefined && blockId !== null && blockId !== '' && !c.layout.content.blocks.some(block => block.id === blockId)) fields.block_id = 'Choose a block on this layout.'
      const note = c.body.note
      if (note !== undefined && (typeof note !== 'string' || note.length > 500)) fields.note = 'Write a note of up to 500 characters.'
      if (Object.keys(fields).length > 0) throw invalidFields(fields)
      if (typeof rise === 'number') {
        const findings = pieceFindings(module, piece.after_piece_id, { ...piece, rise_mm: rise }, piece.id, await standardsOf(c.client, c.workspaceId as string))
        if (findings.length > 0) throw pieceRefused(findings)
        changeRise(module, piece.id, rise)
      }
      if (blockId !== undefined) piece.block_id = blockId === null || blockId === '' ? null : blockId as string
      if (typeof note === 'string') piece.note = note
      bumpModuleRevision(c.layout, module.id)
      await commit(c, { type: 'piece.changed', actor: actorOf(c), detail: { module_id: module.id, piece_id: piece.id }, history: [{ action: 'piece.changed', object_id: piece.id, module_id: module.id }] })
      const saved = moduleOf(c.layout, module.id) as LayoutModule
      return json(200, { piece: saved.pieces.find(candidate => candidate.id === piece.id), module_revision: moduleRevision(c.layout, module.id), ...writeReceipt(c) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/modules/:module/pieces/:piece/remove', access: BUILDERS, load: 'layout',
    resolve(c) {
      const module = moduleOf(c.layout, c.params.module)
      if (module === undefined || !module.pieces.some(candidate => candidate.id === c.params.piece)) throw notFound()
      c.found.module = module
    },
    revision: c => moduleRevision(c.layout, c.params.module),
    async handle(c) {
      const module = c.found.module as LayoutModule
      if (followersOf(module, c.params.piece).length > 0) throw rule('piece_has_followers', 'Remove the pieces after this one first.')
      removePiece(module, c.params.piece)
      bumpModuleRevision(c.layout, module.id)
      await commit(c, { type: 'piece.removed', actor: actorOf(c), detail: { module_id: module.id, piece_id: c.params.piece }, history: [{ action: 'piece.removed', object_id: c.params.piece, module_id: module.id }] })
      const saved = moduleOf(c.layout, module.id) as LayoutModule
      return json(200, { open_ends: saved.open_ends, module_revision: moduleRevision(c.layout, module.id), ...writeReceipt(c) })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/blocks', access: BUILDERS, load: 'layout',
    revision: c => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, 'name', 'a block name', 60)
      const kind = c.body.kind
      if (kind !== 'plain' && kind !== 'loop' && kind !== 'approach') throw invalidFields({ kind: 'Choose plain, loop or approach.' })
      const numbers = [...c.layout.content.blocks, ...c.layout.trash.flatMap(entry => entry.blocks)].map(block => block.number)
      const number = Math.max(0, ...numbers) + 1
      const block: LayoutBlock = { id: `blk-${String(number).padStart(2, '0')}`, number, name, kind, module_id: null, neighbour_ids: [] }
      c.layout.content.blocks.push(block)
      await commit(c, { type: 'module.changed', actor: actorOf(c), detail: { block_id: block.id, change: 'block added' }, history: [{ action: 'block.added', object_id: block.id, to: name }] })
      return json(201, { block, layout_revision: c.layout.revision })
    },
  },
  {
    method: 'PATCH', path: '/api/workspaces/:workspace/layouts/:layout/blocks/:block', access: MANAGERS, load: 'layout',
    resolve(c) {
      if (!c.layout.content.blocks.some(block => block.id === c.params.block)) throw notFound()
    },
    revision: c => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, 'name', 'a name', 60)
      const block = c.layout.content.blocks.find(candidate => candidate.id === c.params.block) as LayoutBlock
      const from = block.name
      block.name = name
      await renameInSessions(txOf(c), c.layout, 'block', block.id, name)
      await commit(c, { type: 'name.changed', actor: actorOf(c), detail: { kind: 'block', id: block.id, from, to: name }, history: [{ action: 'block.renamed', object_id: block.id, from, to: name }] })
      return json(200, { block, layout_revision: c.layout.revision })
    },
  },
  {
    method: 'PATCH', path: '/api/workspaces/:workspace/layouts/:layout/stations/:station', access: MANAGERS, load: 'layout',
    resolve(c) {
      if (!c.layout.content.stations.some(station => station.id === c.params.station)) throw notFound()
    },
    revision: c => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, 'name', 'a name', 60)
      const station = c.layout.content.stations.find(candidate => candidate.id === c.params.station) as NonNullable<LayoutRow['content']['stations'][number]>
      const from = station.name
      station.name = name
      await renameInSessions(txOf(c), c.layout, 'station', station.id, name)
      await commit(c, { type: 'name.changed', actor: actorOf(c), detail: { kind: 'station', id: station.id, from, to: name }, history: [{ action: 'station.renamed', object_id: station.id, from, to: name }] })
      return json(200, { station, layout_revision: c.layout.revision })
    },
  },
  {
    method: 'PUT', path: '/api/workspaces/:workspace/layouts/:layout/timetable', access: MANAGERS, load: 'layout',
    revision: c => c.layout.revision,
    async handle(c) {
      const { content } = c.layout
      const entries = Array.isArray(c.body.entries) ? c.body.entries as Array<Record<string, unknown>> : null
      if (entries === null) throw invalidFields({ entries: 'Send the timetable entries.' })
      const fields: Record<string, string> = {}
      const seen = new Set<string>()
      entries.forEach((entry, index) => {
        if (typeof entry.id !== 'string' || entry.id === '' || seen.has(entry.id)) fields[`entries.${index}.id`] = 'Each entry needs its own id.'
        seen.add(String(entry.id))
        if (!content.trains.some(train => train.id === entry.train_id)) fields[`entries.${index}.train_id`] = 'Choose a train on this layout.'
        if (!content.stations.some(station => station.id === entry.station_id)) fields[`entries.${index}.station_id`] = 'Choose a station on this layout.'
        const depart = entry.depart_fast_seconds
        if (typeof depart !== 'number' || !Number.isInteger(depart) || depart < 0 || depart > 86_399) fields[`entries.${index}.depart_fast_seconds`] = 'Enter whole seconds from 0 to 86399.'
      })
      if (Object.keys(fields).length > 0) throw invalidFields(fields)
      const [{ newest }] = await rows<{ newest: number }>(c.client, `select coalesce(max((content->'timetable'->>'version')::int), 0) as newest from layout_versions where layout_id = $1`, [c.layout.id])
      const version = Math.max(newest, content.timetable.version) + 1
      content.timetable = {
        version,
        entries: entries.map(entry => ({ id: entry.id as string, train_id: entry.train_id as string, station_id: entry.station_id as string, depart_fast_seconds: entry.depart_fast_seconds as number })),
      }
      await commit(c, { type: 'timetable.changed', actor: actorOf(c), detail: { version }, history: [{ action: 'timetable.saved', object_id: null, to: String(version) }] })
      return json(200, { timetable: c.layout.content.timetable, layout_revision: c.layout.revision })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout/history', access: EVERYONE, load: 'layout',
    async handle(c) {
      return json(200, { history: await layoutHistory(c.client, c.layout.id, c.query.get('object_id')) })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout/events', access: EVERYONE, load: 'layout',
    live: true,
    handle: c => serveEvents(c, layoutStream(c.layout.id), c.layout.revision),
  },
]
