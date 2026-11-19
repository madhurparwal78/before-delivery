import type { MemberRow, Role, StandardsWithRevision } from '../../shared/domain'
import { hashPassword } from '../auth'
import { newId } from '../canonical'
import { db, rows } from '../db'
import { parseStandards } from '../domain/standards'
import { invalidFields, notFound, rule } from '../http/errors'
import type { Route } from '../http/pipeline'
import { EVERYONE, MANAGERS } from '../../shared/roles'
import { createFromTemplate } from '../seed'
import { actorOf, json, textField, txOf } from './helpers'

const MEMBER_ROLES: Role[] = ['manager', 'member', 'operator']

const isMemberRole = (role: unknown): role is Role => MEMBER_ROLES.includes(role as Role)

const MEMBER_SQL = `select m.user_id, u.display_name, u.email, m.role, m.revision from members m join users u on u.id = m.user_id
  where m.workspace_id = $1`

export const workspaceRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces', access: 'user',
    async handle(c) {
      const found = await rows<{ id: string; name: string; role: Role }>(db(),
        `select w.id, w.name, m.role from members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.created_at, w.id`, [c.user.id])
      return json(200, { workspaces: found })
    },
  },
  {
    method: 'POST', path: '/api/workspaces', access: 'founder',
    async handle(c) {
      const name = textField(c.body, 'name', 'a workspace name')
      if (c.body.template !== 'reference' && c.body.template !== 'empty') throw invalidFields({ template: 'Choose a template.' })
      const made = await createFromTemplate(txOf(c), name, c.body.template, actorOf(c))
      return json(201, made)
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace', access: EVERYONE,
    async handle(c) {
      const [workspace] = await rows<{ id: string; name: string; standards: object; standards_revision: number }>(c.client,
        'select id, name, standards, standards_revision from workspaces where id = $1', [c.workspaceId])
      const [counts] = await rows<{ members: number; layouts: number; sessions: number }>(c.client,
        `select (select count(*) from members where workspace_id = $1)::int as members, (select count(*) from layouts where workspace_id = $1)::int as layouts,
                (select count(*) from sessions where workspace_id = $1)::int as sessions`, [c.workspaceId])
      return json(200, { id: workspace.id, name: workspace.name, role: c.role, standards: { ...workspace.standards, revision: workspace.standards_revision }, counts })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/members', access: EVERYONE,
    async handle(c) {
      const found = await rows<MemberRow>(c.client, `${MEMBER_SQL} order by (m.role = 'founder') desc, m.created_at, m.user_id`, [c.workspaceId])
      return json(200, { members: found })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/members', access: MANAGERS, load: 'workspace',
    async handle(c) {
      const fields: Record<string, string> = {}
      const displayName = typeof c.body.display_name === 'string' ? c.body.display_name.trim() : ''
      const email = typeof c.body.email === 'string' ? c.body.email.trim().toLowerCase() : ''
      const password = typeof c.body.password === 'string' ? c.body.password : ''
      if (displayName === '' || displayName.length > 80) fields.display_name = 'Enter a display name of up to 80 characters.'
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = 'Enter an email address.'
      if (password.length < 8) fields.password = 'Enter a password of at least 8 characters.'
      if (!isMemberRole(c.body.role)) fields.role = 'Choose Manager, Member or Operator.'
      if (Object.keys(fields).length > 0) throw invalidFields(fields)
      const client = txOf(c).client
      await client.query('insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4) on conflict (email) do nothing',
        [newId('u'), email, displayName, await hashPassword(password)])
      const [{ id: userId }] = await rows<{ id: string }>(client, 'select id from users where email = $1', [email])
      const added = await client.query('insert into members (workspace_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [c.workspaceId, userId, c.body.role])
      if (added.rowCount === 0) throw rule('member_exists', 'That person is already a member.')
      const [member] = await rows<MemberRow>(client, `${MEMBER_SQL} and m.user_id = $2`, [c.workspaceId, userId])
      return json(201, { member })
    },
  },
  {
    method: 'PATCH', path: '/api/workspaces/:workspace/members/:user', access: MANAGERS, load: 'workspace',
    async resolve(c) {
      const [member] = await rows<MemberRow>(c.client, `${MEMBER_SQL} and m.user_id = $2 for update of m`, [c.workspaceId, c.params.user])
      if (member === undefined) throw notFound()
      c.found.member = member
    },
    revision: c => (c.found.member as MemberRow).revision,
    async handle(c) {
      const member = c.found.member as MemberRow
      if (!isMemberRole(c.body.role) || member.role === 'founder') throw invalidFields({ role: 'Choose Manager, Member or Operator for this person.' })
      const client = txOf(c).client
      await client.query('update members set role = $3, revision = revision + 1 where workspace_id = $1 and user_id = $2', [c.workspaceId, c.params.user, c.body.role])
      const [changed] = await rows<MemberRow>(client, `${MEMBER_SQL} and m.user_id = $2`, [c.workspaceId, c.params.user])
      return json(200, { member: changed })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/standards', access: EVERYONE,
    async handle(c) {
      const [row] = await rows<{ standards: object; standards_revision: number }>(c.client, 'select standards, standards_revision from workspaces where id = $1', [c.workspaceId])
      return json(200, { ...row.standards, revision: row.standards_revision })
    },
  },
  {
    method: 'PUT', path: '/api/workspaces/:workspace/standards', access: MANAGERS, load: 'workspace',
    async resolve(c) {
      const [row] = await rows<{ standards_revision: number }>(c.client, 'select standards_revision from workspaces where id = $1', [c.workspaceId])
      c.found.revision = row.standards_revision
    },
    revision: c => c.found.revision as number,
    async handle(c) {
      const profile = parseStandards(c.body)
      const client = txOf(c).client
      const [row] = await rows<{ standards_revision: number }>(client,
        'update workspaces set standards = $2, standards_revision = standards_revision + 1 where id = $1 returning standards_revision', [c.workspaceId, JSON.stringify(profile)])
      const saved: StandardsWithRevision = { ...profile, revision: row.standards_revision }
      return json(200, saved)
    },
  },
]
