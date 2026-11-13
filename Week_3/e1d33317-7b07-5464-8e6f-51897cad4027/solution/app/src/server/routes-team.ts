// Collaborators, invites, holds, presence, parts, banks: the routes that are not about the music itself.

import { randomBytes } from 'node:crypto'
import { INVITE_MESSAGES } from '../shared/invites.js'
import type { Collaborator, Role } from '../shared/protocol.js'
import { canEditStaff, requireRole, scoped, type Seat } from './auth.js'
import { bankContent, addBank, listBanks } from './banks.js'
import { query } from './db.js'
import { parseName } from './routes-score.js'
import { ApiError, forbidden, notFound, validation } from './errors.js'
import { broadcast, evict, dropPresence, presenceList } from './hub.js'
import { BANK_LIMIT, bankTooLarge, json, route } from './http.js'
import { listHolds, releaseAllOf, releaseHolds, requestHold, requireHold } from './holds.js'
import { beginExtract, findPart, loadParts, pageObjectKey, pdfObjectKey, saveLayout } from './parts.js'
import { loadScore, collaboratorView, type ScoreState } from './state.js'
import { getObject } from './storage.js'
import { config } from './config.js'

interface CollaboratorRow {
  id: string
  name: string
  role: Role
  status: Collaborator['status']
  staff_ids: string[]
}

const COLUMNS = 'id, name, role, status, staff_ids'

async function collaborators(state: ScoreState): Promise<Collaborator[]> {
  const rows = await query<CollaboratorRow>(`SELECT ${COLUMNS} FROM collaborators WHERE score_id = $1 ORDER BY created_at, id`, [state.id])
  return rows.map((r) => collaboratorView(r, state))
}

async function announceTeam(state: ScoreState): Promise<void> {
  broadcast(state.id, { type: 'collaborators', collaborators: await collaborators(state) })
}

async function findCollaborator(state: ScoreState, id: string): Promise<CollaboratorRow> {
  const [row] = await query<CollaboratorRow>(`SELECT ${COLUMNS} FROM collaborators WHERE id = $1 AND score_id = $2`, [id, state.id])
  if (!row) throw notFound()
  return row
}

function parseStaffIds(state: ScoreState, value: unknown, errors: Record<string, string>): string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && state.staff(id))) {
    errors.staffIds = 'Unknown staff.'
    return []
  }
  return [...new Set(value as string[])]
}

export function registerTeamRoutes(): void {
  route('GET', '/api/scores/:scoreId/collaborators', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const all = await collaborators(state)
    return json(200, { collaborators: me.role === 'player' ? all.filter((c) => c.status === 'active') : all })
  })

  route('POST', '/api/scores/:scoreId/invites', async (ctx) => {
    const { me, state } = await scoped(ctx)
    requireRole(me, 'composer')
    const body = ctx.json()
    const errors: Record<string, string> = {}
    const name = parseName(body.name, 60, errors) ?? ''
    if (body.role !== 'copyist' && body.role !== 'player') errors.role = 'Choose Copyist or Section player.'
    const staffIds = parseStaffIds(state, body.staffIds ?? [], errors)
    if (Object.keys(errors).length) throw validation(errors)
    const id = `c-${randomBytes(6).toString('hex')}`
    const inviteToken = `inv-${randomBytes(16).toString('hex')}`
    await query(
      "INSERT INTO collaborators (id, score_id, name, role, status, staff_ids, invite_token) VALUES ($1, $2, $3, $4, 'invited', $5, $6)",
      [id, state.id, name, body.role, JSON.stringify(body.role === 'player' ? staffIds : []), inviteToken])
    await announceTeam(state)
    return json(201, { collaborator: collaboratorView(await findCollaborator(state, id), state), inviteToken, inviteUrl: `/i/${inviteToken}` })
  })

  route('GET', '/api/invites/:inviteToken', async (ctx) => {
    const [row] = await query<{ name: string; role: Role; status: string; title: string }>(
      'SELECT c.name, c.role, c.status, s.title FROM collaborators c JOIN scores s ON s.id = c.score_id WHERE c.invite_token = $1', [ctx.params.inviteToken])
    if (!row) throw notFound()
    return json(200, { invite: { name: row.name, role: row.role, status: row.status, scoreTitle: row.title } })
  })

  route('POST', '/api/invites/:inviteToken/accept', async (ctx) => {
    const seatToken = `seat-${randomBytes(16).toString('hex')}`
    const [accepted] = await query<CollaboratorRow & { score_id: string }>(
      `UPDATE collaborators c SET status = 'active', seat_token = $2, ack_lamport = s.lamport FROM scores s
       WHERE c.invite_token = $1 AND c.status = 'invited' AND s.id = c.score_id RETURNING c.id, c.name, c.role, c.status, c.staff_ids, c.score_id`,
      [ctx.params.inviteToken, seatToken])
    if (!accepted) {
      const [existing] = await query<{ status: string }>('SELECT status FROM collaborators WHERE invite_token = $1', [ctx.params.inviteToken])
      if (!existing) throw notFound()
      if (existing.status === 'removed') throw new ApiError(410, 'invite_revoked', INVITE_MESSAGES.withdrawn)
      throw new ApiError(409, 'invite_used', INVITE_MESSAGES.used)
    }
    const state = await loadScore(accepted.score_id)
    await announceTeam(state)
    return json(200, { seatToken, collaborator: collaboratorView(accepted, state) })
  })

  route('PATCH', '/api/scores/:scoreId/collaborators/:collaboratorId', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const target = await findCollaborator(state, ctx.params.collaboratorId as string)
    requireRole(me, 'composer')
    const errors: Record<string, string> = {}
    const staffIds = parseStaffIds(state, ctx.json().staffIds, errors)
    if (target.role !== 'player') errors.staffIds = 'Only section players have assigned staves.'
    if (Object.keys(errors).length) throw validation(errors)
    await query('UPDATE collaborators SET staff_ids = $2 WHERE id = $1', [target.id, JSON.stringify(staffIds)])
    await announceTeam(state)
    return json(200, { collaborator: collaboratorView(await findCollaborator(state, target.id), state) })
  })

  route('DELETE', '/api/scores/:scoreId/collaborators/:collaboratorId', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const target = await findCollaborator(state, ctx.params.collaboratorId as string)
    requireRole(me, 'composer')
    if (target.role === 'composer') throw new ApiError(409, 'cannot_remove_composer', 'The composer cannot be removed.')
    const [removed] = await query<{ id: string }>(
      "UPDATE collaborators SET status = 'removed', seat_token = NULL WHERE id = $1 AND status <> 'removed' RETURNING id", [target.id])
    if (!removed) throw new ApiError(409, 'already_removed', `${target.name} was already removed.`)
    evict(state.id, target.id)
    await releaseAllOf(state.id, target.id)
    await dropPresence(state.id, target.id)
    await announceTeam(state)
    return json(200, { collaborator: collaboratorView(await findCollaborator(state, target.id), state) })
  })

  route('GET', '/api/scores/:scoreId/holds', async (ctx) => {
    const { state } = await scoped(ctx)
    return json(200, { holds: await listHolds(state.id) })
  })

  route('POST', '/api/scores/:scoreId/holds', async (ctx) => {
    const { me, state } = await scoped(ctx)
    return json(201, { holds: await requestHold(me, state, ctx.json()) })
  })

  route('DELETE', '/api/scores/:scoreId/holds', async (ctx) => {
    const { me, state } = await scoped(ctx)
    await releaseHolds(me, state, ctx.url.searchParams.get('staffIds'))
    return { status: 204 }
  })

  route('GET', '/api/scores/:scoreId/presence', async (ctx) => {
    const { state } = await scoped(ctx)
    return json(200, { entries: await presenceList(state.id), ttlSeconds: config.presenceTtlSeconds })
  })

  route('GET', '/api/scores/:scoreId/parts', async (ctx) => json(200, { parts: await loadParts((await scoped(ctx)).state) }))

  route('PUT', '/api/scores/:scoreId/parts/:partId/layout', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const part = await findPart(state, ctx.params.partId as string)
    requireRole(me, 'composer', 'copyist')
    await requireHold(state, me, part.staffIds)
    const body = ctx.json()
    const errors: Record<string, string> = {}
    const message = `Use measures from 1 to ${state.row.measure_count - 1}, each once.`
    const measures = (key: 'systemBreaks' | 'pageBreaks'): number[] => {
      const list = body[key]
      const valid = Array.isArray(list) && list.every((m) => Number.isInteger(m) && m >= 1 && m <= state.row.measure_count - 1) && new Set(list).size === list.length
      if (!valid) errors[key] = message
      return valid ? [...(list as number[])].sort((a, b) => a - b) : []
    }
    const layout = { systemBreaks: measures('systemBreaks'), pageBreaks: measures('pageBreaks') }
    if (Object.keys(errors).length) throw validation(errors)
    return json(200, { part: await saveLayout(state, part.id, layout) })
  })

  const mayUsePart = (me: Seat, staffIds: string[]): void => {
    if (!staffIds.every((id) => canEditStaff(me, id))) throw forbidden()
  }

  route('POST', '/api/scores/:scoreId/parts/:partId/extract', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const part = await findPart(state, ctx.params.partId as string)
    mayUsePart(me, part.staffIds)
    return json(202, { part: await beginExtract(state, part.id) })
  })

  route('GET', '/api/scores/:scoreId/parts/:partId/pages/:file', async (ctx) => {
    const { state } = await scoped(ctx)
    const part = await findPart(state, ctx.params.partId as string)
    const page = /^(\d+)\.svg$/.exec(ctx.params.file as string)
    if (!page || part.pageCount === null || Number(page[1]) < 1 || Number(page[1]) > part.pageCount) throw notFound()
    const data = await getObject(pageObjectKey(state.id, part.id, part.revision, Number(page[1])))
    if (!data) throw notFound()
    return { status: 200, bytes: { contentType: 'image/svg+xml', data } }
  })

  route('GET', '/api/scores/:scoreId/parts/:partId/pdf', async (ctx) => {
    const { me, state } = await scoped(ctx)
    const part = await findPart(state, ctx.params.partId as string)
    mayUsePart(me, part.staffIds)
    if (part.status !== 'ready') throw new ApiError(409, 'pdf_not_ready', `The PDF for ${part.name} is not ready.`, { status: part.status })
    const data = await getObject(pdfObjectKey(state.id, part.id, part.revision))
    if (!data) throw notFound()
    const name = `${state.row.title} - ${part.name}.pdf`
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return { status: 200, bytes: { contentType: 'application/pdf', data }, headers: { 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}` } }
  })

  route('POST', '/api/scores/:scoreId/banks', async (ctx) => {
    const { me, state } = await scoped(ctx)
    requireRole(me, 'composer')
    return json(201, { bank: await addBank(state, ctx.url.searchParams, ctx.raw) })
  }, { limit: BANK_LIMIT, tooLarge: bankTooLarge })

  route('GET', '/api/scores/:scoreId/banks', async (ctx) => json(200, { banks: await listBanks((await scoped(ctx)).state) }))

  route('GET', '/api/scores/:scoreId/banks/:bankId/content', async (ctx) => {
    const { state } = await scoped(ctx)
    const found = await bankContent(state, ctx.params.bankId as string)
    if (!found) throw notFound()
    return { status: 200, bytes: { contentType: found.bank.kind === 'wav' ? 'audio/wav' : 'text/plain; charset=utf-8', data: found.data } }
  })
}
