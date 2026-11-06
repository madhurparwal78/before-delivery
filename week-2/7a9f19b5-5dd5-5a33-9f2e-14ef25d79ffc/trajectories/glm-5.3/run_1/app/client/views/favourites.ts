/** Favourites list. */
import { el, status_region } from '../lib/dom.js'
import { api, type ProductPublic } from '../lib/api.js'
import { FAV_SIGNIN, FAV_SAVED, FAV_REMOVED } from '../lib/copy.js'
import type { App } from '../main.js'

interface FavouriteItem {
  code: string
  product_name: string
  product_slug: string
  retail_price_cents: number
  trade_price_cents?: number
  was_price_cents: number | null
  clearance: boolean
  stock_on_hand: number | null
  finish: string
  finish_name: string
  beam_deg: number
  cct_k: number
  lumens: number
  candela: number
}

export async function render_favourites(main: HTMLElement, app: App): Promise<void> {
  if (!app.user) {
    main.append(el('div', { class: 'page' }, [el('h1', { text: 'Favourites' }), el('p', { text: FAV_SIGNIN })]))
    return
  }
  const status = status_region('Product updates')
  const reply = await api.get<{ items: FavouriteItem[] }>('/api/favourites')
  const grid = el('div', { class: 'card-grid' })
  main.append(el('div', { class: 'page' }, [el('h1', { text: 'Favourites' }), status, grid]))
  if (!reply.ok) return
  const products_reply = await api.get<{ products: ProductPublic[] }>('/api/catalogue')
  const by_slug = new Map<string, ProductPublic>()
  if (products_reply.ok) for (const p of products_reply.body.products) by_slug.set(p.slug, p)
  for (const item of reply.body.items) {
    const product = by_slug.get(item.product_slug)
    if (!product) continue
    const card = document.createElement('article')
    card.className = 'card'
    card.setAttribute('aria-label', item.product_name)
    const variant = product.variants.find((v) => v.code === item.code)
    if (!variant) continue
    const { product_card } = await import('./card.js')
    const built = await product_card(app, product, false)
    grid.append(built)
    void card
  }
  void FAV_SAVED
  void FAV_REMOVED
}
