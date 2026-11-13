import { randomUUID } from 'node:crypto'
import type { PackSheet, PaperSize } from '../shared/api-types'
import { isSheetCurrent, sheetContent, type SheetContent } from '../shared/sheet'
import { asId, pool, query, type Db } from './db'
import { refuse } from './errors'
import { declare, settle } from './fields'
import { renderPdf } from './gotenberg'
import type { Route } from './http'
import { loadHead, loadList } from './lists'
import { loadProfile } from './profile'
import { getObject, putObject } from './s3'
import { paperFor, renderSheetHtml } from './sheet-html'

interface SheetRow {
  id: string
  list_id: string
  bytes: number
  content: SheetContent
  created_at: Date
}

function sheetJson(row: SheetRow, now: SheetContent): PackSheet {
  return {
    id: row.id,
    listId: row.list_id,
    status: 'ready',
    paperSize: row.content.paperSize,
    createdAt: row.created_at.toISOString(),
    bytes: row.bytes,
    current: isSheetCurrent(row.content, now),
    url: `/api/pack-sheets/${row.id}/pdf`,
  }
}

/** The content the server would render for a list right now. */
async function currentContent(db: Db, listId: string) {
  const head = await loadHead(db, listId)
  if (!head) throw refuse.notFound('list')
  const profile = await loadProfile(db)
  const list = await loadList(db, head, profile)
  return { list, profile, content: sheetContent(list, profile) }
}

const noFields = declare({})

const createSheet: Route = {
  method: 'POST',
  pattern: '/api/lists/:id/pack-sheets',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    if (id === null) throw refuse.notFound('list')
    const { list, profile, content } = await currentContent(pool, id)
    settle(noFields.read(ctx.json()))
    const pdf = await renderPdf(renderSheetHtml(list, profile.displayName), paperFor(profile.paperSize as PaperSize))
    const sheetId = randomUUID()
    await putObject(`pack-sheets/${id}/${sheetId}.pdf`, pdf, 'application/pdf')
    const [row] = await query<SheetRow>(
      'INSERT INTO pack_sheets (id, list_id, bytes, content) VALUES ($1, $2, $3, $4) RETURNING id, list_id, bytes, content, created_at',
      [sheetId, id, pdf.length, JSON.stringify(content)],
    )
    if (!row) throw refuse.internal()
    return { status: 201, body: { sheet: sheetJson(row, content) } }
  },
}

const listSheets: Route = {
  method: 'GET',
  pattern: '/api/lists/:id/pack-sheets',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    if (id === null) throw refuse.notFound('list')
    const { content } = await currentContent(pool, id)
    const rows = await query<SheetRow>('SELECT id, list_id, bytes, content, created_at FROM pack_sheets WHERE list_id = $1 ORDER BY seq DESC', [id])
    return { status: 200, body: { sheets: rows.map((row) => sheetJson(row, content)) } }
  },
}

const downloadSheet: Route = {
  method: 'GET',
  pattern: '/api/pack-sheets/:id/pdf',
  access: 'session',
  async handler(ctx) {
    const id = asId(ctx.params.id)
    const [row] = id ? await query<{ list_id: string }>('SELECT list_id FROM pack_sheets WHERE id = $1', [id]) : []
    if (!row) throw refuse.notFound('sheet')
    const data = await getObject(`pack-sheets/${row.list_id}/${id}.pdf`)
    if (!data) throw refuse.notFound('sheet')
    return { status: 200, bytes: { data, contentType: 'application/pdf' }, headers: { 'Content-Disposition': 'attachment; filename="pack-sheet.pdf"' } }
  },
}

export const sheetRoutes: Route[] = [createSheet, listSheets, downloadSheet]
