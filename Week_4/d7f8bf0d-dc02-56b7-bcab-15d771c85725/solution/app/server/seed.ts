import type { PoolClient } from 'pg'
import type { LayoutContent, SessionStatus } from '../shared/domain'
import { hashPassword } from './auth'
import { canonicalHash, newId } from './canonical'
import type { Tx } from './db'
import { normalizeContent } from './domain/layout-model'
import { referenceContent } from './domain/reference-layout'
import { pinContent } from './domain/session/pin'
import { DEFAULT_STANDARDS } from './domain/standards'

const PASSWORD = 'gandyboard-demo-1'

const PEOPLE: Array<{ name: string; email: string; role: 'founder' | 'manager' | 'member' | 'operator'; workspace: string | null; walked: boolean }> = [
  { name: 'Founder Fishplate', email: 'founder@fishplate.example', role: 'founder', workspace: null, walked: true },
  { name: 'Morgan Tarn', email: 'manager@tarnvalley.example', role: 'manager', workspace: 'tarn-valley', walked: true },
  { name: 'Robin Tarn', email: 'member@tarnvalley.example', role: 'member', workspace: 'tarn-valley', walked: true },
  { name: 'Sam Tarn', email: 'member2@tarnvalley.example', role: 'member', workspace: 'tarn-valley', walked: true },
  { name: 'Alex Tarn', email: 'operator@tarnvalley.example', role: 'operator', workspace: 'tarn-valley', walked: true },
  { name: 'Jo Tarn', email: 'operator2@tarnvalley.example', role: 'operator', workspace: 'tarn-valley', walked: true },
  { name: 'Riley Tarn', email: 'newmember@tarnvalley.example', role: 'member', workspace: 'tarn-valley', walked: false },
  { name: 'Casey Marsh', email: 'manager@saltmarsh.example', role: 'manager', workspace: 'saltmarsh', walked: true },
  { name: 'Dale Marsh', email: 'operator@saltmarsh.example', role: 'operator', workspace: 'saltmarsh', walked: true },
]

let counter = 0
const sequentialIds = (prefix: string): string => `${prefix}-${(++counter).toString(36)}`

function versionContent(number: number): LayoutContent {
  counter = 0
  return referenceContent(sequentialIds, number, number * 60)
}

async function insertVersion(client: PoolClient, layoutId: string, number: number, content: LayoutContent, savedBy: string): Promise<string> {
  const id = newId('ver')
  await client.query(
    `insert into layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by) values ($1, $2, $3, 'Published', $4, $5, $6, $7)`,
    [id, layoutId, number, `Issue ${number}`, canonicalHash(content), JSON.stringify(content), savedBy],
  )
  return id
}

export async function insertSession(client: PoolClient, input: {
  id: string; workspaceId: string; layoutId: string; name: string; status: SessionStatus; ratio: number
  versionId: string; versionNumber: number; content: LayoutContent
}): Promise<void> {
  await client.query(
    `insert into sessions (id, workspace_id, layout_id, name, status, ratio, last_tick_at, layout_version_id, layout_version_number, timetable_version, state)
     values ($1, $2, $3, $4, $5, $6, case when $5 = 'Running' then now() else null end, $7, $8, $9, $10)`,
    [input.id, input.workspaceId, input.layoutId, input.name, input.status, input.ratio, input.versionId, input.versionNumber, input.content.timetable.version, JSON.stringify(pinContent(input.content))],
  )
}

async function addFounders(client: PoolClient, workspaceId: string): Promise<void> {
  await client.query(`insert into members (workspace_id, user_id, role) select $1, id, 'founder' from users where is_founder on conflict do nothing`, [workspaceId])
}

async function createWorkspaceRow(client: PoolClient, id: string, name: string): Promise<void> {
  await client.query('insert into workspaces (id, name, standards) values ($1, $2, $3)', [id, name, JSON.stringify(DEFAULT_STANDARDS)])
  await addFounders(client, id)
}

async function createLayoutRow(client: PoolClient, workspaceId: string, layoutId: string, name: string, content: LayoutContent): Promise<void> {
  const revisions = Object.fromEntries(content.modules.map(module => [module.id, 1]))
  await client.query('insert into layouts (id, workspace_id, name, revision, content, module_revisions) values ($1, $2, $3, 1, $4, $5)', [layoutId, workspaceId, name, JSON.stringify(content), JSON.stringify(revisions)])
}

export async function createFromTemplate(tx: Tx, name: string, template: 'reference' | 'empty', actor: { id: string; display_name: string }) {
  const client = tx.client
  const workspaceId = newId('ws')
  const layoutId = newId('lay')
  await createWorkspaceRow(client, workspaceId, name)
  if (template === 'empty') {
    const empty = normalizeContent({ modules: [], blocks: [], stations: [], turnouts: [], trains: [], timetable: { version: 0, entries: [] } })
    await createLayoutRow(client, workspaceId, layoutId, 'First layout', empty)
    return { workspace: { id: workspaceId, name }, layout: { id: layoutId }, version: null }
  }
  const content = referenceContent(newId, 1, 720)
  await createLayoutRow(client, workspaceId, layoutId, 'Reference layout', content)
  const versionId = await insertVersion(client, layoutId, 1, content, actor.display_name)
  return { workspace: { id: workspaceId, name }, layout: { id: layoutId }, version: { id: versionId } }
}

export async function seedDatabase(client: PoolClient): Promise<void> {
  const seeded = await client.query(`select 1 from users where email = 'founder@fishplate.example'`)
  if (seeded.rowCount !== 0) return
  const hash = await hashPassword(PASSWORD)
  for (const person of PEOPLE) {
    await client.query(
      'insert into users (id, email, display_name, password_hash, is_founder, walkthrough_done) values ($1, $2, $3, $4, $5, $6)',
      [newId('u'), person.email, person.name, hash, person.role === 'founder', person.walked],
    )
  }
  const clubs: Array<{ id: string; name: string; layoutId: string; layoutName: string; versions: number; sessions: Array<{ id: string; name: string; status: SessionStatus }> }> = [
    { id: 'tarn-valley', name: 'Tarn Valley Model Railway Club', layoutId: 'tarn-main', layoutName: 'Tarn Valley Main Line', versions: 12,
      sessions: [{ id: 'thursday-running', name: 'Thursday running', status: 'Scheduled' }, { id: 'tarn-shakedown', name: 'Tarn shakedown', status: 'Running' }] },
    { id: 'saltmarsh', name: 'Saltmarsh Modular Group', layoutId: 'saltmarsh-branch', layoutName: 'Saltmarsh Branch', versions: 1,
      sessions: [{ id: 'saltmarsh-rehearsal', name: 'Saltmarsh rehearsal', status: 'Running' }] },
  ]
  for (const club of clubs) {
    await createWorkspaceRow(client, club.id, club.name)
    for (const person of PEOPLE.filter(candidate => candidate.workspace === club.id)) {
      await client.query(`insert into members (workspace_id, user_id, role) select $1, id, $3 from users where email = $2`, [club.id, person.email, person.role])
    }
    const newest = versionContent(club.versions)
    await createLayoutRow(client, club.id, club.layoutId, club.layoutName, newest)
    let newestId = ''
    for (let number = 1; number <= club.versions; number += 1) {
      newestId = await insertVersion(client, club.layoutId, number, versionContent(number), 'Founder Fishplate')
    }
    for (const session of club.sessions) {
      await insertSession(client, { id: session.id, workspaceId: club.id, layoutId: club.layoutId, name: session.name, status: session.status, ratio: 6, versionId: newestId, versionNumber: club.versions, content: newest })
    }
  }
}
