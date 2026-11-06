/** Cart with quantity controls and GST totals. */
import { el } from '../lib/dom.js'
import { api, type OrderPublic } from '../lib/api.js'
import { money } from '../lib/domain.js'
import type { App } from '../main.js'

export async function render_cart(main: HTMLElement, app: App): Promise<void> {
  if (!app.user) {
    window.location.href = '/signin'
    return
  }
  const reply = await api.get<{ order: OrderPublic }>('/api/cart')
  const holder = el('div', { class: 'page' })
  main.append(holder)
  if (!reply.ok) {
    holder.append(el('h1', { text: 'Cart' }), el('p', { text: 'Your cart is empty.' }))
    return
  }
  await draw(holder, app, reply.body.order)
}

export async function draw(holder: HTMLElement, app: App, order: OrderPublic): Promise<void> {
  const table = el('table', { 'aria-label': 'Cart' })
  const head = el('tr', {}, [
    el('th', { text: 'Code' }),
    el('th', { text: 'Product' }),
    el('th', { text: 'Quantity' }),
    el('th', { class: 'num', text: 'Line total' }),
    el('th', { text: '' }),
  ])
  table.append(el('thead', {}, [head]))
  const body = el('tbody')
  for (const line of order.lines) {
    const qty = el('input', {
      type: 'number',
      value: String(line.quantity),
      min: '0',
      max: '999',
      'aria-label': `Quantity for ${line.variant_code}`,
    })
    qty.addEventListener('change', async () => {
      const value = Number(qty.value) || 0
      const update = await api.patch<{ order: OrderPublic }>(`/api/cart/lines/${line.variant_code}`, { quantity: value })
      if (update.ok) await draw(holder, app, update.body.order)
      await app.refresh_header()
    })
    body.append(
      el('tr', {}, [
        el('td', { class: 'num', text: line.variant_code }),
        el('td', { text: line.product_name }),
        el('td', {}, [qty]),
        el('td', { class: 'num', text: money(line.line_total_cents) }),
        el('td', {}, [
          el('button', {
            text: `Remove ${line.variant_code}`,
            class: 'linklike',
            onclick: async () => {
              await api.patch(`/api/cart/lines/${line.variant_code}`, { quantity: 0 })
              const fresh = await api.get<{ order: OrderPublic }>('/api/cart')
              if (fresh.ok) await draw(holder, app, fresh.body.order)
              await app.refresh_header()
            },
          }),
        ]),
      ]),
    )
  }
  table.append(body)
  const totals = el('div', {}, [
    el('p', { class: 'num', text: `Subtotal (excl. GST): ${money(order.subtotal_cents)}` }),
    el('p', { class: 'num', text: `GST (15%): ${money(order.gst_cents)}` }),
    el('p', { class: 'num', text: `Total (incl. GST): ${money(order.total_cents)}` }),
    el('a', { href: '/checkout', class: 'btn primary', text: 'Checkout' }),
  ])
  holder.replaceChildren(el('h1', { text: 'Cart' }), table, totals)
}
