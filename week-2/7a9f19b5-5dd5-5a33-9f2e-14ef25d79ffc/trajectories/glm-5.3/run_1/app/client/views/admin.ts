/** Admin: Applications, Orders, Stock and Health tabs. */
import { el, status_region, open_dialog } from '../lib/dom.js'
import { api, idempotency_key, type TradeApplicationPublic, type OrderPublic, type StockItemPublic } from '../lib/api.js'
import { money } from '../lib/domain.js'
import {
  approved_copy, declined_copy, ALREADY_DECIDED, CANNOT_DISPATCH, captured_copy, invoiced_copy,
  KILLBILL_OUTAGE, refunded_copy, exceeds_refundable, payment_recorded, MUST_EQUAL_INVOICE,
  stock_now, STOCK_BELOW_ZERO,
} from '../lib/copy.js'
import type { App } from '../main.js'

export async function render_admin(main: HTMLElement, app: App): Promise<void> {
  if (!app.user || app.user.role !== 'admin') {
    main.append(el('div', { class: 'page' }, [el('h1', { text: 'Admin' }), el('p', { text: 'Admins only.' })]))
    return
  }
  const status = status_region('Admin updates')
  const tabs = el('div', { class: 'tabs', role: 'tablist' })
  const panels = el('div', {})
  const names = ['Applications', 'Orders', 'Stock', 'Health'] as const
  const render_tab = {
    Applications: render_applications,
    Orders: render_orders,
    Stock: render_stock,
    Health: render_health,
  }
  let current: (typeof names)[number] = 'Applications'
  const buttons: Record<string, HTMLButtonElement> = {}
  for (const name of names) {
    const button = el('button', { role: 'tab', text: name, 'aria-selected': String(name === current) })
    button.addEventListener('click', async () => {
      current = name
      for (const other of names) {
        buttons[other]!.setAttribute('aria-selected', String(other === name))
      }
      panels.replaceChildren()
      await render_tab[name](panels, app, status)
    })
    buttons[name] = button
    tabs.append(button)
  }
  main.append(el('div', { class: 'page' }, [el('h1', { text: 'Admin' }), tabs, panels, status]))
  await render_tab[current](panels, app, status)
}

async function render_applications(panel: HTMLElement, _app: App, status: HTMLElement): Promise<void> {
  const reply = await api.get<{ applications: TradeApplicationPublic[] }>('/api/admin/trade-applications')
  const table = el('table', { 'aria-label': 'Trade applications' })
  table.append(
    el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Applicant' }), el('th', { text: 'Business' }), el('th', { text: 'NZBN' }), el('th', { text: 'Status' }), el('th', { text: '' })]),
    ]),
  )
  const body = el('tbody')
  for (const application of reply.ok ? reply.body.applications : []) {
    const approve = el('button', {
      text: `Approve ${application.business_name}`,
      onclick: async (event: MouseEvent) => {
        const button = event.currentTarget as HTMLButtonElement
        button.textContent = 'Saving'
        const result = await api.post(`/api/admin/trade-applications/${application.id}/approve`)
        if (result.ok) status.textContent = approved_copy(application.business_name)
        else if (result.status === 409) status.textContent = ALREADY_DECIDED
        await rerender()
      },
    })
    const decline = el('button', {
      text: `Decline ${application.business_name}`,
      onclick: () => {
        const reason = el('input', { type: 'text', 'aria-label': 'Reason' })
        const dialog = el('dialog', { 'aria-label': 'Decline application' }, [
          el('h2', { text: 'Decline application' }),
          el('div', { class: 'field' }, [el('label', { text: 'Reason' }), reason]),
          el('button', {
            class: 'primary',
            text: 'Decline',
            onclick: async () => {
              const result = await api.post(`/api/admin/trade-applications/${application.id}/decline`, {
                reason: (reason as HTMLInputElement).value,
              })
              if (result.ok) status.textContent = declined_copy(application.business_name)
              else if (result.status === 409) status.textContent = ALREADY_DECIDED
              dialog.close()
              await rerender()
            },
          }),
        ])
        document.body.append(dialog)
        open_dialog(dialog, decline)
      },
    })
    body.append(
      el('tr', {}, [
        el('td', { text: application.applicant_name }),
        el('td', { text: application.business_name }),
        el('td', { class: 'num', text: application.nzbn }),
        el('td', { text: application.status }),
        el('td', {}, application.status === 'submitted' ? [approve, decline] : []),
      ]),
    )
  }
  table.append(body)
  panel.append(table)

  async function rerender(): Promise<void> {
    panel.replaceChildren()
    await render_applications(panel, _app, status)
  }
}

async function render_orders(panel: HTMLElement, _app: App, status: HTMLElement): Promise<void> {
  const reply = await api.get<{ orders: OrderPublic[] }>('/api/admin/orders')
  const table = el('table', { 'aria-label': 'Orders' })
  table.append(
    el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Order' }), el('th', { text: 'Customer' }), el('th', { text: 'Status' }), el('th', { class: 'num', text: 'Total' }), el('th', { text: '' })]),
    ]),
  )
  const body = el('tbody')
  for (const order of reply.ok ? reply.body.orders : []) {
    const dispatch = el('button', {
      text: `Dispatch ${order.order_key}`,
      onclick: async () => {
        status.textContent = order.payment_method === 'account' ? 'Invoicing' : 'Capturing'
        const result = await api.post<{ order: OrderPublic }>(`/api/admin/orders/${order.order_key}/dispatch`)
        if (result.ok) {
          const fresh = result.body.order
          status.textContent =
            fresh.payment_method === 'account' && fresh.invoice
              ? invoiced_copy(fresh.invoice.invoice_number, fresh.order_key)
              : captured_copy(fresh.order_key)
        } else if (result.status === 503) {
          status.textContent = KILLBILL_OUTAGE(order.order_key)
        } else {
          status.textContent = CANNOT_DISPATCH
        }
        await rerender()
      },
    })
    const refund = el('button', {
      text: `Refund ${order.order_key}`,
      onclick: () => {
        const amount = el('input', { type: 'text', 'aria-label': 'Amount (NZD)', placeholder: '0.00' })
        const reason = el('input', { type: 'text', 'aria-label': 'Reason' })
        const dialog = el('dialog', { 'aria-label': 'Refund' }, [
          el('h2', { text: 'Refund' }),
          el('div', { class: 'field' }, [el('label', { text: 'Amount (NZD)' }), amount]),
          el('div', { class: 'field' }, [el('label', { text: 'Reason' }), reason]),
          el('button', {
            class: 'primary',
            text: 'Issue refund',
            onclick: async (event: MouseEvent) => {
              const button = event.currentTarget as HTMLButtonElement
              button.textContent = 'Refunding'
              const dollars = Number((amount as HTMLInputElement).value.trim())
              const cents = Math.round(dollars * 100)
              const refundable = order.captured_cents - order.refunded_cents
              const result = await api.post<{ order: OrderPublic }>(
                `/api/admin/orders/${order.order_key}/refunds`,
                { amount_cents: cents, reason: (reason as HTMLInputElement).value },
                { 'Idempotency-Key': idempotency_key() },
              )
              button.textContent = 'Issue refund'
              if (result.status === 201) {
                status.textContent = refunded_copy(dollars.toFixed(2), order.order_key)
                dialog.close()
              } else if (result.status === 422) {
                status.textContent = exceeds_refundable(money(refundable))
              } else if (result.status === 503) {
                status.textContent = KILLBILL_OUTAGE(order.order_key)
              }
              await rerender()
            },
          }),
        ])
        document.body.append(dialog)
        open_dialog(dialog, refund)
      },
    })
    const record = el('button', {
      text: `Record payment ${order.order_key}`,
      onclick: () => {
        const amount = el('input', { type: 'text', 'aria-label': 'Amount received (NZD)', placeholder: '0.00' })
        const dialog = el('dialog', { 'aria-label': 'Record payment' }, [
          el('h2', { text: 'Record payment' }),
          el('div', { class: 'field' }, [el('label', { text: 'Amount received (NZD)' }), amount]),
          el('button', {
            class: 'primary',
            text: 'Record',
            onclick: async (event: MouseEvent) => {
              const button = event.currentTarget as HTMLButtonElement
              button.textContent = 'Recording'
              const cents = Math.round(Number((amount as HTMLInputElement).value.trim()) * 100)
              const result = await api.post<{ order: OrderPublic }>(`/api/admin/orders/${order.order_key}/record-payment`, {
                amount_cents: cents,
              })
              button.textContent = 'Record'
              if (result.ok) {
                status.textContent = payment_recorded(order.order_key)
                dialog.close()
              } else if (result.status === 422) {
                status.textContent = MUST_EQUAL_INVOICE
              } else if (result.status === 503) {
                status.textContent = KILLBILL_OUTAGE(order.order_key)
              }
              await rerender()
            },
          }),
        ])
        document.body.append(dialog)
        open_dialog(dialog, record)
      },
    })
    const actions: HTMLElement[] = []
    if (order.status === 'authorised' || order.status === 'placed') actions.push(dispatch)
    if (order.status === 'captured' || order.status === 'partially_refunded') actions.push(refund)
    if (order.status === 'invoiced' || order.status === 'overdue') actions.push(record)
    body.append(
      el('tr', {}, [
        el('td', { class: 'num', text: order.order_key }),
        el('td', { text: order.customer_email ?? '' }),
        el('td', { text: order.display_status }),
        el('td', { class: 'num', text: money(order.total_cents) }),
        el('td', {}, actions),
      ]),
    )
  }
  table.append(body)
  panel.append(table)

  async function rerender(): Promise<void> {
    panel.replaceChildren()
    await render_orders(panel, _app, status)
  }
}

async function render_stock(panel: HTMLElement, _app: App, status: HTMLElement): Promise<void> {
  const reply = await api.get<{ items: StockItemPublic[] }>('/api/admin/stock')
  const table = el('table', { 'aria-label': 'Clearance stock' })
  table.append(
    el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Code' }), el('th', { text: 'Product' }), el('th', { class: 'num', text: 'Clearance price' }), el('th', { class: 'num', text: 'On hand' }), el('th', { text: '' })]),
    ]),
  )
  const body = el('tbody')
  for (const item of reply.ok ? reply.body.items : []) {
    const adjust = el('button', {
      text: `Adjust stock ${item.variant_code}`,
      onclick: () => {
        const change = el('input', { type: 'number', value: '0', 'aria-label': 'Change' })
        const note = el('input', { type: 'text', 'aria-label': 'Note' })
        const dialog = el('dialog', { 'aria-label': 'Adjust stock' }, [
          el('h2', { text: 'Adjust stock' }),
          el('div', { class: 'field' }, [el('label', { text: 'Change' }), change]),
          el('div', { class: 'field' }, [el('label', { text: 'Note' }), note]),
          el('button', {
            class: 'primary',
            text: 'Save',
            onclick: async (event: MouseEvent) => {
              const button = event.currentTarget as HTMLButtonElement
              button.textContent = 'Saving'
              const result = await api.patch<{ item: StockItemPublic }>(`/api/admin/variants/${item.variant_code}`, {
                stock_adjust: Number((change as HTMLInputElement).value) || 0,
                note: (note as HTMLInputElement).value || undefined,
              })
              button.textContent = 'Save'
              if (result.ok) {
                status.textContent = stock_now(item.variant_code, result.body.item.stock_on_hand)
                dialog.close()
              } else if (result.status === 409) {
                status.textContent = STOCK_BELOW_ZERO
              }
              await rerender()
            },
          }),
        ])
        document.body.append(dialog)
        open_dialog(dialog, adjust)
      },
    })
    body.append(
      el('tr', {}, [
        el('td', { class: 'num', text: item.variant_code }),
        el('td', { text: item.product_name }),
        el('td', { class: 'num', text: money(item.clearance_price_cents ?? 0) }),
        el('td', { class: 'num', text: String(item.stock_on_hand) }),
        el('td', {}, [adjust]),
      ]),
    )
  }
  table.append(body)
  panel.append(table)

  async function rerender(): Promise<void> {
    panel.replaceChildren()
    await render_stock(panel, _app, status)
  }
}

async function render_health(panel: HTMLElement, _app: App, _status: HTMLElement): Promise<void> {
  const table = el('table', { 'aria-label': 'Service health' })
  table.append(el('thead', {}, [el('tr', {}, [el('th', { text: 'Service' }), el('th', { text: 'State' })])]))
  const body = el('tbody')
  table.append(body)
  panel.append(table)

  const refresh = async () => {
    const reply = await api.get<{ services: Record<string, string> }>('/api/admin/health')
    if (!reply.ok) return
    const display_names: Record<string, string> = {
      postgres: 'Postgres',
      killbill: 'Kill Bill',
      mailpit: 'Mailpit',
      minio: 'MinIO',
      pocketbase: 'PocketBase',
    }
    body.replaceChildren(
      ...Object.entries(reply.body.services).map(([name, state]) =>
        el('tr', {}, [el('td', { text: display_names[name] ?? name }), el('td', { text: state === 'up' ? 'Up' : 'Down' })]),
      ),
    )
  }
  await refresh()
  setInterval(refresh, 10_000)
}
