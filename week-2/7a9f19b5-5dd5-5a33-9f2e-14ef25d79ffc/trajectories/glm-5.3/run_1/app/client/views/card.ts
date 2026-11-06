/** Shared catalogue card builder. */
import { el } from '../lib/dom.js'
import { api, type ProductPublic, type VariantPublic } from '../lib/api.js'
import { money } from '../lib/domain.js'
import { compare_button } from '../lib/tray.js'
import { FAV_SAVED, FAV_REMOVED, FAV_SIGNIN, stock_left, SOLD_OUT } from '../lib/copy.js'
import type { App } from '../main.js'

export function shown_variant(product: ProductPublic, clearance_mode: boolean): VariantPublic {
  if (clearance_mode) {
    const clearance = product.variants.find((v) => v.clearance)
    if (clearance) return clearance
  }
  return product.variants.find((v) => v.code === product.default_variant) ?? product.variants[0]!
}

export function price_line(variant: VariantPublic, user: App['user']): HTMLElement {
  const trade = user && (user.role === 'admin' || (user.role === 'trade' && user.trade_status === 'approved'))
  if (variant.clearance) {
    return el('div', { class: 'price' }, [
      el('div', { text: `$${money(variant.retail_price_cents)} + GST` }),
      el('div', { class: 'was', text: `$${money(variant.was_price_cents ?? 0)} + GST` }),
    ])
  }
  if (trade) {
    return el('div', { class: 'price' }, [
      el('div', { text: `Trade $${money(variant.trade_price_cents ?? variant.retail_price_cents)} + GST` }),
      el('div', { class: 'muted', text: `RRP $${money(variant.retail_price_cents)} + GST` }),
    ])
  }
  return el('div', { class: 'price', text: `$${money(variant.retail_price_cents)} + GST` })
}

export function stock_badge(variant: VariantPublic): HTMLElement | null {
  if (!variant.clearance) return null
  const stock = variant.stock_on_hand ?? 0
  return el('span', { class: 'badge', text: stock === 0 ? SOLD_OUT : stock_left(stock) })
}

export async function product_card(app: App, product: ProductPublic, clearance_mode: boolean): Promise<HTMLElement> {
  const variant = shown_variant(product, clearance_mode)
  const saved = app.user ? await is_favourite(app, variant.code) : false
  const card = el('article', { class: 'card', 'aria-label': product.name }, [
    el('a', { href: `/products/${product.slug}`, class: 'name', text: product.name }),
    await thumbnail(product, variant),
    price_line(variant, app.user),
    stock_badge(variant),
    el('div', { class: 'actions' }, [
      await compare_button(app, variant.code, product.name, app.tray.has(variant.code)),
      favourite_button(app, variant.code, product.name, saved),
    ]),
  ])
  return card
}

export function favourite_button(app: App, code: string, name: string, pressed: boolean): HTMLButtonElement {
  const update = (button: HTMLButtonElement, is_pressed: boolean) => {
    button.setAttribute('aria-pressed', String(is_pressed))
    button.classList.toggle('pressed', is_pressed)
    const label = button.getAttribute('data-base-label') ?? `Save ${name}`
    button.setAttribute('aria-label', label)
  }
  const button = el('button', {
    text: `Save ${name}`,
    'data-base-label': `Save ${name}`,
    'aria-pressed': String(pressed),
    class: pressed ? 'pressed' : '',
    onclick: async (event: MouseEvent) => {
      const target = event.currentTarget as HTMLButtonElement
      if (!app.user) {
        announce_product(app, FAV_SIGNIN)
        return
      }
      if (target.getAttribute('aria-pressed') === 'true') {
        await api.delete(`/api/favourites/${code}`)
        update(target, false)
        announce_product(app, FAV_REMOVED)
      } else {
        const reply = await api.put(`/api/favourites/${code}`)
        if (reply.ok) {
          update(target, true)
          announce_product(app, FAV_SAVED)
        }
      }
    },
  })
  update(button, pressed)
  return button
}

function announce_product(app: App, message: string): void {
  const node = document.querySelector('[data-name="Product updates"]')
  if (node) node.textContent = message
  void app
}

async function is_favourite(app: App, code: string): Promise<boolean> {
  if (!app.user) return false
  const reply = await api.get<{ items: { code: string }[] }>('/api/favourites')
  return reply.ok && reply.body.items.some((i) => i.code === code)
}

/** A still thumbnail of the model: an inline SVG line drawing. */
async function thumbnail(product: ProductPublic, variant: VariantPublic): Promise<HTMLElement> {
  const div = el('div', { class: 'thumb' })
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 160 120')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  const style = getComputedStyle(document.documentElement)
  const stroke = style.getPropertyValue('--text').trim() || '#f4efe7'
  const accent = style.getPropertyValue('--accent').trim() || '#e8a33d'
  const lines: string[] = []
  const draw_fitting = (family: string) => {
    if (family === 'downlights') {
      lines.push('<rect x="60" y="30" width="40" height="12" fill="none"/>')
      lines.push('<circle cx="80" cy="42" r="12" fill="none"/>')
      lines.push('<line x1="70" y1="46" x2="90" y2="46"/>')
    } else if (family === 'track-spots') {
      lines.push('<line x1="50" y1="26" x2="110" y2="26"/>')
      lines.push('<rect x="74" y="26" width="12" height="10" fill="none"/>')
      lines.push('<circle cx="80" cy="48" r="13" fill="none"/>')
    } else if (family === 'pendants') {
      lines.push('<line x1="80" y1="14" x2="80" y2="52"/>')
      lines.push('<path d="M60 62 A 20 14 0 0 1 100 62 L 100 66 L 60 66 Z" fill="none"/>')
    } else {
      lines.push('<rect x="68" y="34" width="24" height="26" fill="none"/>')
      lines.push('<line x1="72" y1="62" x2="88" y2="62"/>')
    }
  }
  draw_fitting(product.family)
  const spread = Math.tan((variant.beam_deg * Math.PI) / 360)
  const pool = 16 + spread * 36
  svg.innerHTML = `<g stroke="${stroke}" fill="none" stroke-width="1.2">${lines.join('')}</g>
    <path d="M74 64 L ${80 - pool} 108 L ${80 + pool} 108 L 86 64 Z" stroke="${accent}" fill="none" stroke-width="1"/>
    <ellipse cx="80" cy="108" rx="${pool}" ry="${pool / 5}" stroke="${accent}" fill="none" stroke-width="1"/>`
  div.append(svg)
  return div
}
