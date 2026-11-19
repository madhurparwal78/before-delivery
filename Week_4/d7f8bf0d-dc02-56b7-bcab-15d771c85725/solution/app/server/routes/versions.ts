import type { LayoutVersion } from '../../shared/domain'
import { newId } from '../canonical'
import { one, rows } from '../db'
import { checkLayout } from '../domain/rules'
import { notFound, rule, versionRefused } from '../http/errors'
import { type Ctx, type Reply, type Route } from '../http/pipeline'
import { BUILDERS, EVERYONE, MANAGERS } from '../../shared/roles'
import { saveLayout, workingHash } from '../services/layout-store'
import { actorOf, json, textField, txOf } from './helpers'
import { standardsOf } from './layouts'

interface VersionRow {
  id: string
  number: number
  state: LayoutVersion['state']
  label: string
  canonical_hash: string
  saved_by: string
  saved_at: Date
  restored_from: string | null
  revision: number
}

const COLUMNS = 'id, number, state, label, canonical_hash, saved_by, saved_at, restored_from, revision'

const toVersion = (row: VersionRow): LayoutVersion => ({ ...row, saved_at: row.saved_at.toISOString() })


async function findVersion(c: Ctx): Promise<VersionRow> {
  const found = await one<VersionRow>(c.client, `select ${COLUMNS} from layout_versions where layout_id = $1 and id = $2${c.tx === null ? '' : ' for update'}`, [c.layout.id, c.params.version])
  if (found === undefined) throw notFound()
  return found
}

async function bumpLayoutEvent(c: Ctx, detail: object): Promise<void> {
  await saveLayout(txOf(c), c.layout, { type: 'version.changed', actor: actorOf(c), detail })
}

async function transition(c: Ctx, from: LayoutVersion['state'], to: LayoutVersion['state']): Promise<Reply> {
  const version = c.found.version as VersionRow
  if (version.state !== from) throw rule('version_transition', `A ${version.state} version cannot do that.`)
  if (to === 'Validated') {
    const content = (await one<{ content: object }>(c.client, 'select content from layout_versions where id = $1', [version.id]))?.content
    const findings = checkLayout(content as never, await standardsOf(c.client, c.workspaceId as string))
    if (findings.length > 0) throw versionRefused(findings)
  }
  const updated = await one<VersionRow>(txOf(c).client, `update layout_versions set state = $2, revision = revision + 1 where id = $1 returning ${COLUMNS}`, [version.id, to])
  await bumpLayoutEvent(c, { version_id: version.id, change: to })
  return json(200, to === 'Validated' ? { version: toVersion(updated as VersionRow), report: { passed: true, findings: [] } } : { version: toVersion(updated as VersionRow) })
}

export const versionRoutes: Route[] = [
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout/versions', access: EVERYONE, load: 'layout',
    async handle(c) {
      const found = await rows<VersionRow>(c.client, `select ${COLUMNS} from layout_versions where layout_id = $1 order by number`, [c.layout.id])
      return json(200, { versions: found.map(toVersion) })
    },
  },
  {
    method: 'GET', path: '/api/workspaces/:workspace/layouts/:layout/versions/:version', access: EVERYONE, load: 'layout',
    async handle(c) {
      const row = await findVersion(c)
      const content = (await one<{ content: object }>(c.client, 'select content from layout_versions where id = $1', [row.id]))?.content
      return json(200, { ...toVersion(row), content })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/versions', access: BUILDERS, load: 'layout',
    revision: c => c.layout.revision,
    async handle(c) {
      const label = textField(c.body, 'label', 'a label', 60)
      const [{ next }] = await rows<{ next: number }>(c.client, 'select coalesce(max(number), 0) + 1 as next from layout_versions where layout_id = $1', [c.layout.id])
      const saved = await one<VersionRow>(txOf(c).client,
        `insert into layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by) values ($1, $2, $3, 'Draft', $4, $5, $6, $7) returning ${COLUMNS}`,
        [newId('ver'), c.layout.id, next, label, workingHash(c.layout.content), JSON.stringify(c.layout.content), c.user.display_name])
      await bumpLayoutEvent(c, { version_id: (saved as VersionRow).id, change: 'saved' })
      return json(201, { version: toVersion(saved as VersionRow), layout_revision: c.layout.revision })
    },
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/versions/:version/validate', access: BUILDERS, load: 'layout',
    async resolve(c) {
      c.found.version = await findVersion(c)
    },
    revision: c => (c.found.version as VersionRow).revision,
    handle: c => transition(c, 'Draft', 'Validated'),
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/versions/:version/publish', access: MANAGERS, load: 'layout',
    async resolve(c) {
      c.found.version = await findVersion(c)
    },
    revision: c => (c.found.version as VersionRow).revision,
    handle: c => transition(c, 'Validated', 'Published'),
  },
  {
    method: 'POST', path: '/api/workspaces/:workspace/layouts/:layout/versions/:version/restore', access: MANAGERS, load: 'layout',
    async resolve(c) {
      c.found.version = await findVersion(c)
    },
    revision: c => c.layout.revision,
    async handle(c) {
      const source = c.found.version as VersionRow
      const stored = await one<{ content: object }>(c.client, 'select content from layout_versions where id = $1', [source.id])
      const [{ next }] = await rows<{ next: number }>(c.client, 'select coalesce(max(number), 0) + 1 as next from layout_versions where layout_id = $1', [c.layout.id])
      c.layout.content = (stored as { content: never }).content
      const revision = c.layout.revision + 1
      c.layout.module_revisions = Object.fromEntries(c.layout.content.modules.map(module => [module.id, revision]))
      const restored = await one<VersionRow>(txOf(c).client,
        `insert into layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by, restored_from)
         values ($1, $2, $3, 'Draft', $4, $5, $6, $7, $8) returning ${COLUMNS}`,
        [newId('ver'), c.layout.id, next, `Restored from ${source.label}`, source.canonical_hash, JSON.stringify(c.layout.content), c.user.display_name, source.id])
      await saveLayout(txOf(c), c.layout, {
        type: 'version.changed', actor: actorOf(c), detail: { version_id: (restored as VersionRow).id, change: 'restored', restored_from: source.id },
        history: [{ action: 'version.restored', object_id: null, from: source.label, to: String(next) }],
      })
      return json(201, { version: toVersion(restored as VersionRow), layout_revision: c.layout.revision, working_hash: workingHash(c.layout.content) })
    },
  },
]
