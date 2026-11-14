import { createSession, upsertUser, validDisplayName, validEmail } from './auth.ts'
import { config } from './config.ts'
import { query } from './db.ts'
import { FIELD, invalid, notFound } from './errors.ts'
import { jsonBody, route, type Route } from './http.ts'
import { initialLayout, insertProject, validProjectName } from './projects.ts'
import { insertShare } from './shares.ts'
import type { Layout, ShareAccess } from '../shared/domain.ts'

type Entry = Record<string, unknown>

const entries = (value: unknown): Entry[] => (Array.isArray(value) ? value.filter((item): item is Entry => typeof item === 'object' && item !== null) : [])
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

function layoutOf(value: unknown): Layout {
  const given = typeof value === 'object' && value !== null ? (value as Partial<Layout>) : {}
  return { entities: given.entities ?? {}, groups: given.groups ?? {} }
}

/** Creates users with sessions, and projects with text, layout, versions, members and shares, for the grading key holder. */
export const routes: Route[] = [
  route('POST', '/api/grading/setup', async (context) => {
    const key = context.req.headers['x-grading-key']
    if (config.gradingKey === '' || key !== config.gradingKey) throw notFound()
    const body = jsonBody(context)
    const users = entries(body.users)
    const projects = entries(body.projects)
    const refs = new Set(users.map((user) => text(user.ref)))
    const fields: Record<string, string> = {}
    users.forEach((user, i) => {
      if (text(user.ref) === undefined) fields[`users.${i}.ref`] = FIELD.ref
      if (!validEmail(user.email)) fields[`users.${i}.email`] = FIELD.email
      if (!validDisplayName(user.displayName)) fields[`users.${i}.displayName`] = FIELD.displayName
    })
    projects.forEach((project, i) => {
      if (!validProjectName(project.name)) fields[`projects.${i}.name`] = FIELD.projectName
      if (text(project.ref) === undefined) fields[`projects.${i}.ref`] = FIELD.ref
      if (!refs.has(text(project.owner))) fields[`projects.${i}.owner`] = FIELD.knownRef
      if (project.text !== undefined && typeof project.text !== 'string') fields[`projects.${i}.text`] = FIELD.text
      entries(project.versions).forEach((version, v) => {
        if (typeof version.name !== 'string' || version.name.trim() === '') fields[`projects.${i}.versions.${v}.name`] = FIELD.versionName
      })
      entries(project.members).forEach((member, m) => {
        if (!refs.has(text(member.user))) fields[`projects.${i}.members.${m}.user`] = FIELD.knownRef
        if (member.role !== 'editor' && member.role !== 'viewer') fields[`projects.${i}.members.${m}.role`] = FIELD.role
      })
      entries(project.shares).forEach((share, s) => {
        if (text(share.ref) === undefined) fields[`projects.${i}.shares.${s}.ref`] = FIELD.ref
        if (share.access !== 'view' && share.access !== 'edit') fields[`projects.${i}.shares.${s}.access`] = FIELD.access
      })
    })
    if (Object.keys(fields).length) throw invalid(fields)

    const created: Record<string, { id: string; session: string }> = {}
    for (const user of users) {
      const row = await upsertUser(user.email as string, user.displayName as string)
      created[user.ref as string] = { id: row.id, session: await createSession(row.id) }
    }
    const projectOut: Record<string, { id: string; revision: number; versions: number[] }> = {}
    const shareOut: Record<string, { id: string; token: string; url: string }> = {}
    for (const project of projects) {
      const owner = (created[project.owner as string] as { id: string }).id
      const body = text(project.text) ?? ''
      const layout = initialLayout(body, layoutOf(project.layout))
      const id = await insertProject(owner, project.name as string, body, layout)
      const numbers: number[] = []
      for (const [index, version] of entries(project.versions).entries()) {
        const number = index + 1
        await query(
          `INSERT INTO versions (project_id, number, name, revision, text, layout, created_by)
           VALUES ($1, $2, $3, 1, $4, $5, $6)`,
          [id, number, (version.name as string).trim(), text(version.text) ?? body, JSON.stringify(version.layout === undefined ? layout : layoutOf(version.layout)), owner],
        )
        numbers.push(number)
      }
      for (const member of entries(project.members)) {
        await query('INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3)', [id, (created[member.user as string] as { id: string }).id, member.role])
      }
      for (const share of entries(project.shares)) {
        const expires = typeof share.expiresInSeconds === 'number' ? share.expiresInSeconds : config.shareTtlSeconds
        const row = await insertShare(undefined, id, share.access as ShareAccess, null, expires)
        shareOut[share.ref as string] = { id: row.id, token: row.token, url: `/s/${row.token}` }
      }
      projectOut[project.ref as string] = { id, revision: 1, versions: numbers }
    }
    return { status: 201, body: { users: created, projects: projectOut, shares: shareOut } }
  }),
]
