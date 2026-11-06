/** Account page with the trade application banner. */
import { el, status_region } from '../lib/dom.js'
import { TRADE_PENDING, TRADE_DECLINED } from '../lib/copy.js'
import type { App } from '../main.js'
import { api, type OrderPublic } from '../lib/api.js'
import { money } from '../lib/domain.js'

export async function render_account(main: HTMLElement, app: App): Promise<void> {
  if (!app.user) {
    window.location.href = '/signin'
    return
  }
  const status = status_region('Trade application')
  if (app.user.trade_status === 'submitted') status.textContent = TRADE_PENDING
  if (app.user.trade_status === 'declined') status.textContent = TRADE_DECLINED

  const orders_reply = await api.get<{ orders: OrderPublic[] }>('/api/orders')
  const rows = (orders_reply.ok ? orders_reply.body.orders : []).map((order) =>
    el('tr', {}, [
      el('td', { class: 'num' }, [el('a', { href: `/orders/${order.order_key}`, text: order.order_key })]),
      el('td', { text: order.display_status }),
      el('td', { class: 'num', text: money(order.total_cents) }),
    ]),
  )
  main.append(
    el('div', { class: 'page' }, [
      el('h1', { text: `Kia ora, ${app.user.name}` }),
      status,
      el('p', { class: 'muted', text: app.user.email }),
      el('h2', { text: 'Orders' }),
      el('table', { 'aria-label': 'Orders' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Order' }), el('th', { text: 'Status' }), el('th', { class: 'num', text: 'Total' })])]),
        el('tbody', {}, rows),
      ]),
    ]),
  )
}
