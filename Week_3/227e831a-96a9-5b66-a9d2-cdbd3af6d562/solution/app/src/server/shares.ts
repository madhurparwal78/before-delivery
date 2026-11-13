import { randomBytes, randomUUID } from 'node:crypto'
import type { Share, SharedList } from '../shared/api-types'
import { toShareLine } from '../shared/lists'
import { isCalendarDate, isShareExpired, todayIn } from '../shared/share'
import { asId, pool, query, transaction, type Db } from './db'
import { HttpError, refuse } from './errors'
import { declare, optional, rules, settle } from './fields'
import type { Route } from './http'
import { loadHead, loadList } from './lists'
import { loadProfile } from './profile'

interface ShareRow {
  id: string
  list_id: string
  token: string
  expires_on: string | null
  created_at: Date
}

const SHARE_SELECT = "SELECT id, list_id, token, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, created_at FROM shares"

function shareJson(row: ShareRow, timeZone: string): Share {
  return {
    id: row.id,
    token: row.token,
    url: `/s/${row.token}`,
    expiresOn: row.expires_on,
    expired: isShareExpired(row.expires_on, timeZone, new Date()),
    createdAt: row.created_at.toISOString(),
  }
}

const shareFields = declare({ expiresOn: optional(rules.string, 'Choose today or a later date.') })

async function requireList(db: Db, id: string | undefined, lock = false) {
  const head = await loadHead(db, asId(id), lock)
  if (!head) throw refuse.notFound('list')
  return head
}

const getShare: Route = {
  method: 'GET',
  pattern: '/api/lists/:id/share',
  access: 'session',
  async handler(ctx) {
    const head = await requireList(pool, ctx.params.id)
    const [row] = await query<ShareRow>(`${SHARE_SELECT} WHERE list_id = $1 AND revoked_at IS NULL`, [head.id])
    const profile = await loadProfile()
    return { status: 200, body: { share: row ? shareJson(row, profile.timeZone) : null } }
  },
}

const createShare: Route = {
  method: 'POST',
  pattern: '/api/lists/:id/share',
  access: 'session',
  async handler(ctx) {
    return transaction(async (db) => {
      const head = await requireList(db, ctx.params.id, true)
      const { expiresOn } = settle(shareFields.read(ctx.json()))
      const profile = await loadProfile(db)
      if (expiresOn !== undefined && (!isCalendarDate(expiresOn) || expiresOn < todayIn(profile.timeZone, new Date()))) {
        throw refuse.validation({ expiresOn: 'Choose today or a later date.' })
      }
      await query('UPDATE shares SET revoked_at = now() WHERE list_id = $1 AND revoked_at IS NULL', [head.id], db)
      const [row] = await query<ShareRow>(
        `INSERT INTO shares (id, list_id, token, expires_on) VALUES ($1, $2, $3, $4)
         RETURNING id, list_id, token, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, created_at`,
        [randomUUID(), head.id, randomBytes(32).toString('base64url'), expiresOn ?? null],
        db,
      )
      if (!row) throw refuse.internal()
      return { status: 201, body: { share: shareJson(row, profile.timeZone) } }
    })
  },
}

const revokeShare: Route = {
  method: 'DELETE',
  pattern: '/api/lists/:id/share',
  access: 'session',
  async handler(ctx) {
    const head = await requireList(pool, ctx.params.id)
    await query('UPDATE shares SET revoked_at = now() WHERE list_id = $1 AND revoked_at IS NULL', [head.id])
    return { status: 204 }
  },
}

/** Tokens are 32 random bytes in base64url; anything else names no share and never reaches the database. */
const TOKEN_FORM = /^[A-Za-z0-9_-]{43}$/

/** The shared list for a live, unexpired token, with only the published share fields. */
export async function loadSharedList(token: string): Promise<SharedList | null> {
  if (!TOKEN_FORM.test(token)) return null
  const [row] = await query<ShareRow>(`${SHARE_SELECT} WHERE token = $1 AND revoked_at IS NULL`, [token])
  if (!row) return null
  const profile = await loadProfile()
  if (isShareExpired(row.expires_on, profile.timeZone, new Date())) return null
  const head = await loadHead(pool, row.list_id)
  if (!head) return null
  const list = await loadList(pool, head, profile)
  return {
    listName: list.name,
    state: list.state,
    hikerName: profile.displayName,
    lines: list.lines.filter((line) => line.inCloset).map(toShareLine),
    categories: list.categories,
    totals: list.totals,
  }
}

const readShare: Route = {
  method: 'GET',
  pattern: '/api/share/:token',
  access: 'public',
  async handler(ctx) {
    const shared = await loadSharedList(ctx.params.token ?? '')
    if (!shared) throw refuse.notFound('share')
    return { status: 200, body: { share: shared }, headers: { 'Cache-Control': 'no-store' } }
  },
}

const NEVER_WRITTEN: Route[] = ['POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({
  method,
  pattern: '/api/share/:token',
  access: 'public',
  async handler(ctx) {
    const shared = await loadSharedList(ctx.params.token ?? '')
    if (!shared) throw refuse.notFound('share')
    throw new HttpError(405, 'read_only', 'A shared list is read-only.', undefined, { Allow: 'GET' })
  },
}))

export const shareRoutes: Route[] = [getShare, createShare, revokeShare, readShare, ...NEVER_WRITTEN]
