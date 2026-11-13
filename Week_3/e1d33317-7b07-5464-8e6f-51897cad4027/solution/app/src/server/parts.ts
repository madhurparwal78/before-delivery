// Parts: the lifecycle (draft → engraving → rendering → ready or pdf_pending) is decided here, once.

import { readFile } from 'node:fs/promises'
import type { Part, PartLayout, PartStatus } from '../shared/protocol.js'
import { query } from './db.js'
import { config } from './config.js'
import { buildRequest, partPages } from './engraving.js'
import { planSystems } from './engrave/index.js'
import { ApiError, notFound, StorageUnavailable } from './errors.js'
import { broadcast } from './hub.js'
import { loadScore, type PartRow, type ScoreState } from './state.js'
import { getObject, putObject } from './storage.js'

export const pageObjectKey = (scoreId: string, partId: string, revision: number, n: number): string => `scores/${scoreId}/parts/${partId}/r${revision}/page-${n}.svg`
export const pdfObjectKey = (scoreId: string, partId: string, revision: number): string => `scores/${scoreId}/parts/${partId}/r${revision}/part.pdf`
const GOTENBERG_TIMEOUT_MS = 60_000
const FONT_FILES = ['Bravura.woff2', 'ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-latin-400-italic.woff2', 'ibm-plex-mono-latin-400-normal.woff2', 'fraunces-latin-wght-normal.woff2']

function toPart(row: PartRow, state: ScoreState): Part {
  const ref = state.parts.find((p) => p.id === row.id)
  return {
    id: row.id, name: row.name, staffIds: ref?.staffIds ?? [], status: row.status, revision: row.revision,
    extractedAtLamport: row.extracted_at_lamport,
    stale: row.status === 'ready' && ((row.extracted_at_lamport ?? 0) < state.row.lamport || row.layout_changed),
    pageCount: row.page_count, layout: row.layout, lastError: row.last_error,
  }
}

export async function loadParts(state: ScoreState): Promise<Part[]> {
  const rows = await query<PartRow>('SELECT id, name, status, revision, extracted_at_lamport, page_count, layout, layout_changed, last_error FROM parts WHERE score_id = $1', [state.id])
  const parts = rows.map((r) => toPart(r, state))
  const order = new Map(state.parts.map((p, i) => [p.id, i]))
  return parts.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
}

export async function findPart(state: ScoreState, partId: string): Promise<Part> {
  const part = (await loadParts(state)).find((p) => p.id === partId)
  if (!part) throw notFound()
  return part
}

async function announce(scoreId: string, partId: string): Promise<void> {
  const state = await loadScore(scoreId)
  broadcast(scoreId, { type: 'part', part: await findPart(state, partId) })
}

interface Change {
  status: PartStatus
  lastError?: Part['lastError']
  pageCount?: number
  extractedAt?: number
}

/** Moves a part along one published transition; false when it was no longer in the `from` state. */
async function move(scoreId: string, partId: string, revision: number, from: PartStatus, change: Change): Promise<boolean> {
  const rows = await query(
    `UPDATE parts SET status = $5, last_error = $6, page_count = coalesce($7, page_count), extracted_at_lamport = coalesce($8, extracted_at_lamport),
       layout_changed = CASE WHEN $8::int IS NULL THEN layout_changed ELSE false END
     WHERE id = $1 AND score_id = $2 AND revision = $3 AND status = $4 RETURNING id`,
    [partId, scoreId, revision, from, change.status, change.lastError ?? null, change.pageCount ?? null, change.extractedAt ?? null])
  if (rows.length) await announce(scoreId, partId)
  return rows.length > 0
}

/** Extract: draft, ready or pdf_pending → engraving with the next revision. Busy parts are refused. */
export async function beginExtract(state: ScoreState, partId: string): Promise<Part> {
  const rows = await query<{ revision: number }>(
    `UPDATE parts SET status = 'engraving', revision = revision + 1, last_error = NULL
     WHERE id = $1 AND score_id = $2 AND status IN ('draft', 'ready', 'pdf_pending') RETURNING revision`, [partId, state.id])
  const [row] = rows
  if (!row) {
    const current = await findPart(state, partId)
    throw new ApiError(409, 'part_busy', `${current.name} is already being extracted.`, { status: current.status })
  }
  const part = await findPart(state, partId)
  broadcast(state.id, { type: 'part', part })
  void runExtraction(state.id, partId, row.revision)
  return part
}

async function runExtraction(scoreId: string, partId: string, revision: number): Promise<void> {
  try {
    const state = await loadScore(scoreId)
    const part = await findPart(state, partId)
    const request = buildRequest(state, 'part', part)
    const pages = partPages(request, planSystems(request))
    for (const [i, svg] of pages.entries()) await putObject(pageObjectKey(scoreId, partId, revision, i + 1), Buffer.from(svg), 'image/svg+xml')
    if (!(await move(scoreId, partId, revision, 'engraving', { status: 'rendering', pageCount: pages.length, extractedAt: state.row.lamport }))) return
    await render(scoreId, partId, revision, pages, 'rendering')
  } catch (error) {
    const lastError = error instanceof StorageUnavailable ? 'storage_unavailable' : null
    if (!(error instanceof StorageUnavailable)) console.error(error)
    await move(scoreId, partId, revision, 'engraving', { status: 'draft', lastError }).catch(() => undefined)
  }
}

class RendererUnavailable extends Error {}

async function renderPdf(pages: string[]): Promise<Uint8Array> {
  if (!config.gotenbergUrl) throw new RendererUnavailable()
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${['Bravura:Bravura.woff2:normal:400', 'IBM Plex Sans:ibm-plex-sans-latin-400-normal.woff2:normal:400', 'IBM Plex Sans:ibm-plex-sans-latin-400-italic.woff2:italic:400',
  'IBM Plex Mono:ibm-plex-mono-latin-400-normal.woff2:normal:400', 'Fraunces:fraunces-latin-wght-normal.woff2:normal:100 900'].map((f) => {
  const [family, file, style, weight] = f.split(':')
  return `@font-face{font-family:"${family}";src:url(${file}) format("woff2");font-style:${style};font-weight:${weight}}`
}).join('\n')}
@page{size:9in 12in;margin:0}html,body{margin:0;padding:0}.page{width:9in;height:12in;overflow:hidden}.page+.page{break-before:page}svg{display:block;width:9in;height:12in}
</style></head><body>${pages.map((svg) => `<div class="page">${svg}</div>`).join('')}</body></html>`
  const form = new FormData()
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html')
  for (const file of FONT_FILES) {
    const data = await readFile(new URL(`./client/fonts/${file}`, import.meta.url))
    form.append('files', new Blob([new Uint8Array(data)], { type: 'font/woff2' }), file)
  }
  for (const [field, value] of Object.entries({ paperWidth: '9', paperHeight: '12', marginTop: '0', marginBottom: '0', marginLeft: '0', marginRight: '0', printBackground: 'true', preferCssPageSize: 'true' })) {
    form.append(field, value)
  }
  try {
    const response = await fetch(`${config.gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, { method: 'POST', body: form, signal: AbortSignal.timeout(GOTENBERG_TIMEOUT_MS) })
    if (!response.ok) throw new RendererUnavailable()
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    throw new RendererUnavailable()
  }
}

/** rendering or pdf_pending → ready once MinIO confirms the PDF; otherwise pdf_pending with the reason. */
async function render(scoreId: string, partId: string, revision: number, pages: string[], from: PartStatus): Promise<void> {
  try {
    const pdf = await renderPdf(pages)
    await putObject(pdfObjectKey(scoreId, partId, revision), pdf, 'application/pdf')
    await move(scoreId, partId, revision, from, { status: 'ready', pageCount: pages.length })
  } catch (error) {
    const lastError = error instanceof StorageUnavailable ? 'storage_unavailable' : 'renderer_unavailable'
    if (from === 'rendering') await move(scoreId, partId, revision, from, { status: 'pdf_pending', lastError })
  }
}

async function retryPending(): Promise<void> {
  const rows = await query<{ id: string; score_id: string; revision: number; page_count: number }>(
    "SELECT id, score_id, revision, page_count FROM parts WHERE status = 'pdf_pending' AND page_count IS NOT NULL")
  for (const row of rows) {
    try {
      const pages: string[] = []
      for (let n = 1; n <= row.page_count; n++) {
        const data = await getObject(pageObjectKey(row.score_id, row.id, row.revision, n))
        if (!data) throw new StorageUnavailable()
        pages.push(Buffer.from(data).toString('utf8'))
      }
      await render(row.score_id, row.id, row.revision, pages, 'pdf_pending')
    } catch {
      // storage or renderer still down: the part stays pdf_pending until the next retry
    }
  }
}

export function startPartRetries(): void {
  let running = false
  setInterval(() => {
    if (running) return
    running = true
    retryPending().catch(() => undefined).finally(() => {
      running = false
    })
  }, config.pdfRetrySeconds * 1000).unref()
}

export async function saveLayout(state: ScoreState, partId: string, layout: PartLayout): Promise<Part> {
  await query('UPDATE parts SET layout = $3, layout_changed = true WHERE id = $1 AND score_id = $2', [partId, state.id, JSON.stringify(layout)])
  const part = await findPart(state, partId)
  broadcast(state.id, { type: 'part', part })
  return part
}
