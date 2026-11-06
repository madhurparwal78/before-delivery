import { api } from '../api.js'
import { el, clear } from '../ui.js'
import { displayChecked } from '../format.js'

export type MovedReading = {
  sensor_id: string
  interval_start: string
  old: { fc: string; fch4: string; qc: number } | null
  new: { fc: string; fch4: string; qc: number }
  revised_at: string
  batch_id: string
}

export function auditTable(moved: MovedReading[]): { wrap: HTMLElement; empty: boolean } {
  const wrap = el('div', { class: 'table-scroll card-table' })
  if (moved.length === 0) {
    wrap.append(el('p', { text: 'No readings have moved since this figure was sealed.' }))
    return { wrap, empty: true }
  }
  const table = el('table', { 'aria-label': 'Moved readings' })
  const thead = el('thead')
  const hr = el('tr')
  for (const c of ['Sensor', 'Interval start', 'Old FC', 'New FC', 'Old FCH4', 'New FCH4', 'Old QC', 'New QC', 'Revised at']) {
    hr.append(el('th', { text: c }))
  }
  thead.append(hr)
  const tbody = el('tbody')
  for (const m of moved) {
    const tr = el('tr')
    tr.append(
      el('td', { text: m.sensor_id }),
      el('td', { class: 'num', text: m.interval_start }),
      el('td', { class: 'num', text: m.old?.fc ?? '—' }),
      el('td', { class: 'num', text: m.new.fc }),
      el('td', { class: 'num', text: m.old?.fch4 ?? '—' }),
      el('td', { class: 'num', text: m.new.fch4 }),
      el('td', { class: 'num', text: m.old === null ? '—' : String(m.old.qc) }),
      el('td', { class: 'num', text: String(m.new.qc) }),
      el('td', { class: 'num', text: displayChecked(m.revised_at) }),
    )
    tbody.append(tr)
  }
  table.append(thead, tbody)
  wrap.append(table)
  return { wrap, empty: false }
}

export async function renderAudit(main: HTMLElement, figureId: string, slug: string): Promise<void> {
  clear(main)
  const wrap = el('div', { class: 'single-column' })
  main.append(wrap)
  wrap.append(el('h1', { text: `Readings audit trail for ${figureId}` }))

  let moved: MovedReading[] = []
  try {
    const res = await api<{ moved: MovedReading[] }>('GET', `/api/figures/${figureId}/audit`)
    moved = res.moved
  } catch {
    wrap.append(el('p', { text: 'The audit trail is unavailable right now. Try again in a few minutes.' }))
    return
  }
  const { wrap: tableWrap } = auditTable(moved)
  wrap.append(tableWrap)
}
