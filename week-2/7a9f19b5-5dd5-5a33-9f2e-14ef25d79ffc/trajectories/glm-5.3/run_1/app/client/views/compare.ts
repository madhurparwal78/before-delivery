/** Comparison table. */
import { el } from '../lib/dom.js'
import { api, type ComparisonItem } from '../lib/api.js'
import { money } from '../lib/domain.js'
import type { App } from '../main.js'

const ROWS: [string, (item: ComparisonItem) => string][] = [
  ['Product', (i) => i.product_name],
  ['Code', (i) => i.code],
  ['Finish', (i) => i.finish_name],
  ['Beam', (i) => `${i.beam_deg}°`],
  ['Colour temperature', (i) => `${i.cct_k}K`],
  ['Lumens', (i) => String(i.lumens)],
  ['Candela', (i) => String(i.candela)],
  ['Watts', (i) => String(i.watts)],
  ['CRI', (i) => String(i.cri)],
  ['IP rating', (i) => i.ip_rating],
  ['Price', (i) => {
    const trade = i.trade_price_cents !== undefined
    if (i.clearance) return `${money(i.retail_price_cents)} + GST (was ${money(i.was_price_cents ?? 0)})`
    return trade ? `Trade ${money(i.trade_price_cents!)} + GST / RRP ${money(i.retail_price_cents)} + GST` : `${money(i.retail_price_cents)} + GST`
  }],
  ['Pool at 2.7 m', (i) => `${i.pool_diameter_mm_at_2700} mm`],
  ['Centre lux at 2.7 m', (i) => `${i.centre_lux_at_2700} lux`],
]

export async function render_compare(main: HTMLElement, app: App): Promise<void> {
  const codes = app.tray.list().map((i) => i.code)
  const items: ComparisonItem[] = []
  if (codes.length > 0) {
    const reply = await api.get<{ items: ComparisonItem[] }>(`/api/compare?codes=${codes.join(',')}`)
    if (reply.ok) items.push(...reply.body.items)
  }
  const table = el('table', { 'aria-label': 'Comparison' })
  const head = el('tr', {}, [el('th', { text: 'Spec' }), ...items.map((i) => el('th', { text: i.product_name }))])
  table.append(el('thead', {}, [head]))
  const body = el('tbody')
  for (const [label, get] of ROWS) {
    body.append(el('tr', {}, [el('th', { scope: 'row', text: label }), ...items.map((i) => el('td', { class: 'num', text: get(i) }))]))
  }
  table.append(body)
  main.append(el('div', { class: 'page' }, [el('h1', { text: 'Comparison' }), table]))
}
