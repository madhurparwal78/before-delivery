import { randomBytes, randomUUID } from 'node:crypto'
import { SHARE_EXPIRY_MAX_SECONDS, type InvitationStatus, type MemberJson, type ShareAccess, type ShareJson, type ShareStatus } from '../shared/domain.ts'
import { formatBusinessTime } from '../shared/time.ts'
import { UUID, loadAccess, loadProjectRow, projectJson, requireOwner, type ProjectRow } from './access.ts'
import { requireUser, validEmail } from './auth.ts'
import { config } from './config.ts'
import { exactlyOne, one, query, transaction, type Queryable } from './db.ts'
import { FIELD, invalid, joinFirst, mailUnavailable, noInvitation, notFound, ownerRoleFixed, readOnly, shareNotActive } from './errors.ts'
import { jsonBody, route, type Context, type Reply, type Route } from './http.ts'
import { closeShareChannels, publishMemberAccess } from './live.ts'
import { sendInvitation } from './mail.ts'
import { compareVersions, listVersions, versionDetail } from './versions.ts'

const TOKEN = /^[A-Za-z0-9_-]{32}$/

interface ShareRow {
  id: string
  project_id: string
  access: ShareAccess
  token: string
  email: string | null
  invitation_status: InvitationStatus | null
  invitation_sent_at: Date | null
  state: 'active' | 'rotated' | 'revoked'
  expires_at: Date
  created_at: Date
  replaced_by: string | null
}

const newToken = (): string => randomBytes(24).toString('base64url')

function statusOf(row: ShareRow, now: number): ShareStatus {
  return row.state === 'active' && row.expires_at.getTime() <= now ? 'expired' : row.state
}

function toShareJson(row: ShareRow): ShareJson {
  return {
    id: row.id,
    access: row.access,
    status: statusOf(row, Date.now()),
    url: `/s/${row.token}`,
    token: row.token,
    email: row.email,
    invitation: row.invitation_status ? { status: row.invitation_status, sentAt: row.invitation_sent_at?.toISOString() ?? null } : null,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    replacedBy: row.replaced_by,
  }
}

/** The active, unexpired share behind a token and its project, or the not-found answer. */
export async function resolveShare(token: string): Promise<{ share: ShareRow; project: ProjectRow }> {
  if (!TOKEN.test(token)) throw notFound()
  const share = await one<ShareRow>("SELECT * FROM shares WHERE token = $1 AND state = 'active' AND expires_at > $2", [token, new Date()])
  if (!share) throw notFound()
  return { share, project: await loadProjectRow(share.project_id) }
}

export async function insertShare(
  db: Queryable | undefined,
  projectId: string,
  access: ShareAccess,
  email: string | null,
  expiresInSeconds: number,
  createdAt = new Date(),
): Promise<ShareRow> {
  return exactlyOne<ShareRow>(
    `INSERT INTO shares (id, project_id, access, token, email, invitation_status, state, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8) RETURNING *`,
    [randomUUID(), projectId, access, newToken(), email, email ? 'queued' : null, new Date(createdAt.getTime() + expiresInSeconds * 1000), createdAt],
    db,
  )
}

async function invite(share: ShareRow, project: ProjectRow): Promise<ShareRow> {
  try {
    await sendInvitation({
      email: share.email as string,
      ownerName: project.owner_name,
      projectName: project.name,
      token: share.token,
      access: share.access,
      stopsAt: formatBusinessTime(share.expires_at.toISOString(), config.timeZone),
    })
  } catch {
    return exactlyOne<ShareRow>("UPDATE shares SET invitation_status = 'failed' WHERE id = $1 RETURNING *", [share.id])
  }
  return exactlyOne<ShareRow>("UPDATE shares SET invitation_status = 'sent', invitation_sent_at = $2 WHERE id = $1 RETURNING *", [share.id, new Date()])
}

async function ownedProject(context: Context) {
  const access = await loadAccess(await requireUser(context), context.params.id as string)
  requireOwner(access)
  return access
}

async function shareOf(projectId: string, id: string): Promise<ShareRow> {
  const share = UUID.test(id) ? await one<ShareRow>('SELECT * FROM shares WHERE id = $1 AND project_id = $2', [id, projectId]) : undefined
  if (!share) throw notFound()
  return share
}

/** Moves an active share to its next state in one guarded write, so two racing requests cannot both win. */
async function retire(db: Queryable, id: string, state: 'rotated' | 'revoked'): Promise<ShareRow> {
  const claimed = await one<ShareRow>("UPDATE shares SET state = $2 WHERE id = $1 AND state = 'active' AND expires_at > $3 RETURNING *", [id, state, new Date()], db)
  if (!claimed) throw shareNotActive()
  return claimed
}

async function createShare(context: Context) {
  const access = await ownedProject(context)
  const body = jsonBody(context)
  const fields: Record<string, string> = {}
  if (body.access !== 'view' && body.access !== 'edit') fields.access = FIELD.access
  const email = typeof body.email === 'string' && body.email.trim() === '' ? undefined : body.email
  if (email !== undefined && email !== null && !validEmail(email)) fields.email = FIELD.email
  const expires = body.expiresInSeconds
  if (expires !== undefined && (typeof expires !== 'number' || !Number.isInteger(expires) || expires < 1 || expires > SHARE_EXPIRY_MAX_SECONDS)) {
    fields.expiresInSeconds = FIELD.expiresInSeconds
  }
  if (Object.keys(fields).length) throw invalid(fields)
  const created = await insertShare(
    undefined,
    access.project.id,
    body.access as ShareAccess,
    typeof email === 'string' ? email : null,
    typeof expires === 'number' ? expires : config.shareTtlSeconds,
  )
  const share = created.email ? await invite(created, access.project) : created
  return { status: 201, body: toShareJson(share) }
}

async function listShares(context: Context) {
  const access = await ownedProject(context)
  const rows = await query<ShareRow>('SELECT * FROM shares WHERE project_id = $1 ORDER BY created_at DESC, id', [access.project.id])
  return { status: 200, body: { shares: rows.map(toShareJson) } }
}

function requireActive(share: ShareRow): void {
  if (statusOf(share, Date.now()) !== 'active') throw shareNotActive()
}

async function rotateShare(context: Context) {
  const access = await ownedProject(context)
  const old = await shareOf(access.project.id, context.params.sid as string)
  const fresh = await transaction(async (db) => {
    await retire(db, old.id, 'rotated')
    const created = await insertShare(db, old.project_id, old.access, null, config.shareTtlSeconds)
    await query('UPDATE shares SET replaced_by = $2 WHERE id = $1', [old.id, created.id], db)
    return created
  })
  closeShareChannels(old.id, 'rotated')
  return { status: 201, body: toShareJson(fresh) }
}

async function removeMember(db: Queryable | undefined, projectId: string, userId: string, at: Date): Promise<void> {
  await query('DELETE FROM members WHERE project_id = $1 AND user_id = $2', [projectId, userId], db)
  await query(
    `INSERT INTO removed_members (project_id, user_id, removed_at) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET removed_at = $3`,
    [projectId, userId, at],
    db,
  )
}

async function revokeShare(context: Context) {
  const access = await ownedProject(context)
  const share = await shareOf(access.project.id, context.params.sid as string)
  const removed = await transaction(async (db) => {
    const revoked = await retire(db, share.id, 'revoked')
    const joined = share.access === 'edit' ? await query<{ user_id: string }>('SELECT user_id FROM members WHERE joined_via = $1', [share.id], db) : []
    const at = new Date()
    for (const member of joined) await removeMember(db, share.project_id, member.user_id, at)
    return { revoked, joined }
  })
  closeShareChannels(share.id, 'revoked')
  for (const member of removed.joined) publishMemberAccess(share.project_id, member.user_id, 'none', 'removed')
  return { status: 200, body: toShareJson(removed.revoked) }
}

async function resendInvitation(context: Context) {
  const access = await ownedProject(context)
  const share = await shareOf(access.project.id, context.params.sid as string)
  requireActive(share)
  if (!share.email) throw noInvitation()
  const sent = await invite(share, access.project)
  if (sent.invitation_status === 'failed') throw mailUnavailable()
  return { status: 200, body: toShareJson(sent) }
}

/* ---------------------------------------------------------------- members */

interface MemberRow {
  user_id: string
  display_name: string
  email: string
  role: 'editor' | 'viewer'
  joined_via: string | null
}

const toMember = (row: MemberRow): MemberJson => ({
  userId: row.user_id,
  displayName: row.display_name,
  email: row.email,
  role: row.role,
  joinedVia: row.joined_via,
})

const MEMBER_SELECT = `SELECT m.user_id, u.display_name, u.email, m.role, m.joined_via FROM members m JOIN users u ON u.id = m.user_id`

async function listMembers(context: Context) {
  const access = await ownedProject(context)
  const rows = await query<MemberRow>(`${MEMBER_SELECT} WHERE m.project_id = $1 ORDER BY m.created_at, m.user_id`, [access.project.id])
  return { status: 200, body: { members: rows.map(toMember) } }
}

async function memberOf(projectId: string, userId: string): Promise<MemberRow> {
  const row = UUID.test(userId) ? await one<MemberRow>(`${MEMBER_SELECT} WHERE m.project_id = $1 AND m.user_id = $2`, [projectId, userId]) : undefined
  if (!row) throw notFound()
  return row
}

async function changeRole(context: Context) {
  const access = await ownedProject(context)
  const userId = context.params.uid as string
  if (userId === access.project.owner_id) throw ownerRoleFixed()
  await memberOf(access.project.id, userId)
  const role = jsonBody(context).role
  if (role !== 'editor' && role !== 'viewer') throw invalid({ role: FIELD.role })
  await query('UPDATE members SET role = $3 WHERE project_id = $1 AND user_id = $2', [access.project.id, userId, role])
  publishMemberAccess(access.project.id, userId, role, 'role_changed')
  return { status: 200, body: toMember(await memberOf(access.project.id, userId)) }
}

async function deleteMember(context: Context) {
  const access = await ownedProject(context)
  const userId = context.params.uid as string
  if (userId === access.project.owner_id) throw ownerRoleFixed()
  await memberOf(access.project.id, userId)
  await removeMember(undefined, access.project.id, userId, new Date())
  publishMemberAccess(access.project.id, userId, 'none', 'removed')
  return { status: 204 }
}

/* ------------------------------------------------------------ link routes */

async function viewShare(token: string): Promise<{ share: ShareRow; project: ProjectRow }> {
  const found = await resolveShare(token)
  if (found.share.access === 'edit') throw joinFirst()
  return found
}

async function joinShare(context: Context) {
  const user = await requireUser(context)
  const { share, project } = await resolveShare(context.params.token as string)
  if (share.access === 'view') throw readOnly()
  const existing = await one<{ role: 'editor' | 'viewer' }>('SELECT role FROM members WHERE project_id = $1 AND user_id = $2', [project.id, user.id])
  if (project.owner_id === user.id) return { status: 200, body: { projectId: project.id, role: 'owner' } }
  if (existing) return { status: 200, body: { projectId: project.id, role: existing.role } }
  const removed = await one<{ removed_at: Date }>('SELECT removed_at FROM removed_members WHERE project_id = $1 AND user_id = $2', [project.id, user.id])
  if (removed && share.created_at.getTime() <= removed.removed_at.getTime()) throw notFound()
  await transaction(async (db) => {
    await query('DELETE FROM removed_members WHERE project_id = $1 AND user_id = $2', [project.id, user.id], db)
    await query("INSERT INTO members (project_id, user_id, role, joined_via) VALUES ($1, $2, 'editor', $3) ON CONFLICT DO NOTHING", [project.id, user.id, share.id], db)
  })
  return { status: 200, body: { projectId: project.id, role: 'editor' } }
}

async function describeShare(context: Context): Promise<Reply> {
  const { share, project } = await resolveShare(context.params.token as string)
  if (share.access === 'edit') return { status: 200, body: { access: 'edit', projectName: project.name } }
  return { status: 200, body: projectJson(project, 'viewer', 'link') }
}

export const routes: Route[] = [
  route('POST', '/api/projects/:id/shares', createShare),
  route('GET', '/api/projects/:id/shares', listShares),
  route('POST', '/api/projects/:id/shares/:sid/rotate', rotateShare),
  route('POST', '/api/projects/:id/shares/:sid/revoke', revokeShare),
  route('POST', '/api/projects/:id/shares/:sid/invitation', resendInvitation),
  route('GET', '/api/projects/:id/members', listMembers),
  route('PATCH', '/api/projects/:id/members/:uid', changeRole),
  route('DELETE', '/api/projects/:id/members/:uid', deleteMember),
  route('GET', '/api/shared/:token', describeShare),
  route('POST', '/api/shared/:token/join', joinShare),
  route('POST', '/api/shared/:token/edits', async (context) => {
    const { share } = await resolveShare(context.params.token as string)
    throw share.access === 'view' ? readOnly() : joinFirst()
  }),
  route('GET', '/api/shared/:token/versions', async (context) => listVersions((await viewShare(context.params.token as string)).project.id)),
  route('GET', '/api/shared/:token/versions/compare', async (context) =>
    compareVersions((await viewShare(context.params.token as string)).project.id, context.query.get('from'), context.query.get('to')),
  ),
  route('GET', '/api/shared/:token/versions/:n', async (context) =>
    versionDetail((await viewShare(context.params.token as string)).project.id, context.params.n as string),
  ),
]

