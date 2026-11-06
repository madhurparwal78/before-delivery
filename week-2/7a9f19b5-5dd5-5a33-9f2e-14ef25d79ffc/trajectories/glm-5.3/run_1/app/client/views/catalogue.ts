/** Catalogue: search, filters, cards. */
import { el, status_region } from '../lib/dom.js'
import { api, type ProductPublic } from '../lib/api.js'
import { results_count } from '../lib/copy.js'
import { product_card, shown_variant } from './card.js'
import type { App } from '../main.js'

const FINISHES: [string, string][] = [
  ['WH', 'Matte White'],
  ['BK', 'Matte Black'],
  ['BR', 'Brushed Brass'],
  ['BZ', 'Aged Bronze'],
  ['CH', 'Charcoal'],
  ['SN', 'Satin Nickel'],
]
const BEAMS = [15, 24, 36, 60]
const CCTS = [2700, 3000, 4000]

interface FilterState {
  q: string
  finishes: Set<string>
  beams: Set<string>
  ccts: Set<string>
  clearance: boolean
  family: string | null
}

export async function render_catalogue(main: HTMLElement, app: App): Promise<void> {
  const url = new URL(location.href)
  const state: FilterState = {
    q: url.searchParams.get('q') ?? '',
    finishes: new Set(),
    beams: new Set(),
    ccts: new Set(),
    clearance: false,
    family: url.searchParams.get('family'),
  }
  if (state.family === 'clearance') state.clearance = true

  const count_status = status_region('Results count')
  const grid = el('div', { class: 'card-grid' })
  const search = el('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search fittings',
    value: state.q,
    placeholder: 'Search fittings',
  })
  let search_timer = 0
  search.addEventListener('input', () => {
    window.clearTimeout(search_timer)
    search_timer = window.setTimeout(() => {
      state.q = search.value
      void refresh()
    }, 250)
  })

  const filter_body = build_filters(state, () => void refresh())

  const head = el('div', { class: 'results-head' }, [search])
  const inline_region = el('div', { class: 'filters-inline' }, [filter_body])

  const filters_button = el('button', {
    text: 'Filters',
    onclick: () => {
      const sheet = el('div', { class: 'sheet panel-anim', role: 'dialog', 'aria-label': 'Filters' })
      const body = build_filters(state, () => {
        /* each tick applies immediately */
      })
      const show = el('button', { text: 'Show results', class: 'primary', onclick: () => sheet.remove() })
      sheet.append(body, show)
      document.body.append(sheet)
      const first = sheet.querySelector('input') as HTMLInputElement
      first.focus()
      const on_key = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          sheet.remove()
          document.removeEventListener('keydown', on_key)
          filters_button.focus()
        }
      }
      document.addEventListener('keydown', on_key)
    },
  })

  const layout = el('div', { class: 'catalogue-layout' }, [
    el('div', {}, [el('div', { class: 'filters', role: 'region', 'aria-label': 'Filters' }, [inline_region]), filters_button]),
    el('div', {}, [head, count_status, grid]),
  ])
  main.append(el('div', { class: 'page' }, [layout]))

  async function refresh(): Promise<void> {
    const params = new URLSearchParams()
    if (state.q) params.set('q', state.q)
    if (state.family) params.set('family', state.family)
    if (state.finishes.size) params.set('finish', Array.from(state.finishes).join(','))
    if (state.beams.size) params.set('beam', Array.from(state.beams).join(','))
    if (state.ccts.size) params.set('cct', Array.from(state.ccts).join(','))
    if (state.clearance) params.set('clearance', 'true')
    const new_url = `${location.pathname}?${params.toString()}`
    history.replaceState({}, '', new_url)
    const reply = await api.get<{ products: ProductPublic[] }>(`/api/catalogue?${params.toString()}`)
    const products = reply.ok ? reply.body.products : []
    count_status.textContent = results_count(products.length)
    grid.replaceChildren()
    for (const product of products) {
      grid.append(await product_card(app, product, state.clearance))
    }
  }

  await refresh()
  void shown_variant
}

function build_filters(state: FilterState, onchange: () => void): HTMLElement {
  const group = (name: string, options: [string, string][], set: Set<string>) => {
    const box = el('div', { class: 'group', role: 'group', 'aria-label': name })
    box.append(el('h4', { text: name }))
    for (const [value, label] of options) {
      const input = el('input', { type: 'checkbox', id: `${name}-${value}`, value })
      input.addEventListener('change', () => {
        if (input.checked) set.add(value)
        else set.delete(value)
        onchange()
      })
      box.append(el('label', { class: 'choice', for: `${name}-${value}` }, [input, label]))
    }
    return box
  }
  const clearance_input = el('input', { type: 'checkbox', id: 'clearance-only' })
  clearance_input.addEventListener('change', () => {
    state.clearance = clearance_input.checked
    onchange()
  })
  return el('div', {}, [
    group('Finish', FINISHES, state.finishes),
    group('Beam', BEAMS.map((b) => [String(b), `${b}°`] as [string, string]), state.beams),
    group('Colour temperature', CCTS.map((c) => [String(c), `${c}K`] as [string, string]), state.ccts),
    el('label', { class: 'choice', for: 'clearance-only' }, [clearance_input, 'Clearance only']),
  ])
}
