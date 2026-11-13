// Seat tokens and the permission table of Business rules.

import type { IncomingMessage } from 'node:http'
import type { Role } from '../shared/protocol.js'
import type { Ctx } from './http.js'
import { query } from './db.js'
import { forbidden, notFound, ownStavesOnly, unauthorized } from './errors.js'
import { loadScore, type ScoreState } from './state.js'

export interface Seat {
  id: string
  name: string
  role: Role
  status: 'active'
  score_id: string
  staff_ids: string[]
  ack_lamport: number
}

export async function seatFor(token: string | undefined): Promise<Seat> {
  if (!token) throw unauthorized()
  const [row] = await query<Seat>(
    "SELECT id, name, role, status, score_id, staff_ids, ack_lamport FROM collaborators WHERE seat_token = $1 AND status = 'active'", [token])
  if (!row) throw unauthorized()
  return row
}

export function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined
}

interface Scoped {
  me: Seat
  state: ScoreState
}

/** 401 for a bad seat token, then 404 for an unknown score or one that is not the caller's. */
export async function scoped(ctx: Ctx): Promise<Scoped> {
  const me = await seatFor(bearer(ctx.req))
  const state = await loadScore(ctx.params.scoreId as string)
  if (state.id !== me.score_id) throw notFound()
  return { me, state }
}

export function requireRole(me: Seat, ...roles: Role[]): void {
  if (!roles.includes(me.role)) throw forbidden()
}

/** A section player may touch only the staves the composer assigned. */
export function canEditStaff(me: Seat, staffId: string): boolean {
  return me.role !== 'player' || me.staff_ids.includes(staffId)
}

export function requireStaves(me: Seat, staffIds: string[]): void {
  if (!staffIds.every((id) => canEditStaff(me, id))) throw ownStavesOnly()
}
