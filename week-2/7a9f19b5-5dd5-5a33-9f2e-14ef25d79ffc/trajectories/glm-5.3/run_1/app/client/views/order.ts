/** Order page: status, lines, invoice details. */
import { el } from '../lib/dom.js'
import { api, type OrderPublic } from '../lib/api.js'
import { money } from '../lib/domain.js'
import { ORDER_CONFIRMED, order_confirmed_body, ORDER_PLACED, order_placed_body } from '../lib/copy.js'
import type { App } from '../main.js'

export async function render_order(main: HTMLElement, app: App, order_key: string): Promise<void> {
  const reply = await api.get<{ order: OrderPublic }>(`/api/orders/${order_key}`)
  if (!reply.ok) {
    main.append(el('div', { class: 'page' }, [el('h1', { text: 'Order not found' })]))
    return
  }
  const order = reply.body.order
  const url = new URL(location.href)
  const heading = url.searchParams.get('confirmed')
    ? ORDER_CONFIRMED
    : url.searchParams.get('placed')
      ? ORDER_PLACED
      : `Order ${order.order_key}`
  const body_text = url.searchParams.get('confirmed')
    ? order_confirmed_body(order.order_key, app.user?.email ?? '')
    : url.searchParams.get('placed')
      ? order_placed_body(order.order_key, app.user?.email ?? '')
      : null

  const rows = order.lines.map((line) =>
    el('tr', {}, [
      el('td', { class: 'num', text: line.variant_code }),
      el('td', { text: line.product_name }),
      el('td', { class: 'num', text: `x ${line.quantity}` }),
      el('td', { class: 'num', text: money(line.line_total_cents) }),
    ]),
  )
  const table = el('table', { 'aria-label': `Order ${order.order_key}` }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Code' }), el('th', { text: 'Product' }), el('th', { text: 'Qty' }), el('th', { class: 'num', text: 'Total' })])]),
    el('tbody', {}, rows),
  ])

  const invoice = order.invoice
    ? el('p', { class: 'num', text: `Invoice ${order.invoice.invoice_number} — due ${order.invoice.due_date}` })
    : null

  main.append(
    el('div', { class: 'page' }, [
      el('h1', { text: heading }),
      body_text ? el('p', { text: body_text }) : null,
      el('p', { class: 'badge', text: order.display_status }),
      table,
      el('p', { class: 'num', text: `Subtotal (excl. GST): ${money(order.subtotal_cents)}` }),
      el('p', { class: 'num', text: `GST (15%): ${money(order.gst_cents)}` }),
      el('p', { class: 'num', text: `Total (incl. GST): ${money(order.total_cents)}` }),
      order.purchase_order ? el('p', { class: 'num', text: `Purchase order: ${order.purchase_order}` }) : null,
      invoice,
      el('a', { href: '/catalogue', class: 'btn', text: 'Back to catalogue' }),
    ]),
  )
}
