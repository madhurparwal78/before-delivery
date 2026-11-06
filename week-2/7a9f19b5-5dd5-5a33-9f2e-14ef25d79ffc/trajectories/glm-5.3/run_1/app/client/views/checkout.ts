/** Checkout: card payment and monthly account. */
import { el, status_region } from '../lib/dom.js'
import { api, idempotency_key, type OrderPublic } from '../lib/api.js'
import { money } from '../lib/domain.js'
import {
  CARD_DECLINED_HEADING, CARD_DECLINED_BODY, PAYMENT_OUTAGE_HEADING, PAYMENT_OUTAGE_BODY,
  SOLD_OUT_HEADING, sold_out_body, FIELD_ERRORS,
} from '../lib/copy.js'
import type { App } from '../main.js'

export async function render_checkout(main: HTMLElement, app: App): Promise<void> {
  if (!app.user) {
    window.location.href = '/signin'
    return
  }
  const cart = await api.get<{ order: OrderPublic }>('/api/cart')
  if (!cart.ok || cart.body.order.lines.length === 0) {
    window.location.href = '/cart'
    return
  }
  const order = cart.body.order
  const is_trade = app.user.role === 'trade' && app.user.trade_status === 'approved'

  const form = el('form', { 'aria-label': 'Checkout', onsubmit: (event: Event) => event.preventDefault() })
  const status = status_region('Checkout status')
  const alert_box = el('div', { role: 'alert' })
  alert_box.hidden = true

  const full_name = el('input', { type: 'text', 'aria-label': 'Full name' })
  const address = el('input', { type: 'text', 'aria-label': 'Address' })
  const city = el('input', { type: 'text', 'aria-label': 'City' })
  const postcode = el('input', { type: 'text', 'aria-label': 'Postcode', inputmode: 'numeric' })
  const card_number = el('input', { type: 'text', 'aria-label': 'Card number', autocomplete: 'off' })
  const expiry = el('input', { type: 'text', 'aria-label': 'Expiry (MM/YY)', placeholder: 'MM/YY' })
  const cvc = el('input', { type: 'text', 'aria-label': 'Security code', inputmode: 'numeric' })
  const card_name = el('input', { type: 'text', 'aria-label': 'Name on card' })
  const purchase_order = el('input', { type: 'text', 'aria-label': 'Purchase order (optional)' })

  const card_fields = el('div', { 'data-name': 'card-fields' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Card number' }), card_number]),
    el('div', { class: 'field' }, [el('label', { text: 'Expiry (MM/YY)' }), expiry]),
    el('div', { class: 'field' }, [el('label', { text: 'Security code' }), cvc]),
    el('div', { class: 'field' }, [el('label', { text: 'Name on card' }), card_name]),
  ])

  let request_key = idempotency_key()
  const on_field_change = () => {
    request_key = idempotency_key()
  }
  for (const input of [full_name, address, city, postcode, card_number, expiry, cvc, card_name, purchase_order]) {
    input.addEventListener('input', on_field_change)
  }

  const summary = el('div', {}, [
    el('h2', { text: 'Order summary' }),
    ...order.lines.map((line) =>
      el('p', { class: 'num', text: `${line.variant_code} x ${line.quantity} — ${money(line.line_total_cents)}` }),
    ),
    el('p', { class: 'num', text: `Subtotal (excl. GST): ${money(order.subtotal_cents)}` }),
    el('p', { class: 'num', text: `GST (15%): ${money(order.gst_cents)}` }),
    el('p', { class: 'num', text: `Total (incl. GST): ${money(order.total_cents)}` }),
  ])

  const pay_button = el('button', { class: 'primary', text: `Pay $${money(order.total_cents)}` })
  const account_button = el('button', { class: 'primary', text: 'Place order on account' })
  account_button.hidden = !is_trade

  function field_error(name: string): HTMLElement {
    const node = el('span', { class: 'error', role: 'alert', 'data-error-for': name })
    node.hidden = true
    return node
  }
  const errors = {
    'card.number': field_error('card.number'),
    'card.expiry': field_error('card.expiry'),
    'card.cvc': field_error('card.cvc'),
    'card.name': field_error('card.name'),
    'delivery.name': field_error('delivery.name'),
    'delivery.address': field_error('delivery.address'),
    'delivery.city': field_error('delivery.city'),
    'delivery.postcode': field_error('delivery.postcode'),
  }

  function show_field_errors(fields: Record<string, string>): void {
    for (const [key, node] of Object.entries(errors)) {
      const message = fields[key]
      if (message) {
        node.textContent = FIELD_ERRORS[key] ?? message
        node.hidden = false
      } else {
        node.hidden = true
      }
    }
  }

  function payment_method_group(): HTMLElement {
    if (!is_trade) return el('div', {})
    const card_radio = el('input', { type: 'radio', name: 'payment-method', value: 'card', id: 'pay-card' })
    const account_radio = el('input', { type: 'radio', name: 'payment-method', value: 'account', id: 'pay-account' })
    card_radio.checked = true
    card_radio.addEventListener('change', () => {
      card_fields.hidden = false
      pay_button.hidden = false
      account_button.hidden = true
    })
    account_radio.addEventListener('change', () => {
      card_fields.hidden = true
      pay_button.hidden = true
      account_button.hidden = false
    })
    return el('div', { role: 'radiogroup', 'aria-label': 'Payment method', class: 'radiogroup' }, [
      el('label', { class: 'choice', for: 'pay-card' }, [card_radio, 'Card']),
      el('label', { class: 'choice', for: 'pay-account' }, [account_radio, 'Monthly account']),
      purchase_order_field(),
    ])
  }

  function purchase_order_field(): HTMLElement {
    return el('div', { class: 'field', style: 'flex-basis:100%' }, [
      el('label', { text: 'Purchase order (optional)' }),
      purchase_order,
    ])
  }

  form.append(
    payment_method_group(),
    el('h2', { text: 'Delivery' }),
    el('div', { class: 'field' }, [el('label', { text: 'Full name' }), full_name, errors['delivery.name']]),
    el('div', { class: 'field' }, [el('label', { text: 'Address' }), address, errors['delivery.address']]),
    el('div', { class: 'field' }, [el('label', { text: 'City' }), city, errors['delivery.city']]),
    el('div', { class: 'field' }, [el('label', { text: 'Postcode' }), postcode, errors['delivery.postcode']]),
    el('div', { class: 'field' }, [el('label', { text: 'Card number' }), card_number, errors['card.number']]),
    el('div', { class: 'field' }, [el('label', { text: 'Expiry (MM/YY)' }), expiry, errors['card.expiry']]),
    el('div', { class: 'field' }, [el('label', { text: 'Security code' }), cvc, errors['card.cvc']]),
    el('div', { class: 'field' }, [el('label', { text: 'Name on card' }), card_name, errors['card.name']]),
  )
  void card_fields

  pay_button.addEventListener('click', async () => {
    if (pay_button.hasAttribute('disabled')) return
    pay_button.setAttribute('disabled', '')
    pay_button.textContent = 'Authorising payment'
    alert_box.hidden = true
    const reply = await api.post<{ order?: OrderPublic; error?: string; errors?: Record<string, string> }>(
      `/api/orders/${order.order_key}/authorise`,
      {
        card: {
          number: (card_number as HTMLInputElement).value,
          expiry: (expiry as HTMLInputElement).value,
          cvc: (cvc as HTMLInputElement).value,
          name: (card_name as HTMLInputElement).value,
        },
        delivery: {
          name: (full_name as HTMLInputElement).value,
          address: (address as HTMLInputElement).value,
          city: (city as HTMLInputElement).value,
          postcode: (postcode as HTMLInputElement).value,
        },
      },
      { 'Idempotency-Key': request_key },
    )
    pay_button.removeAttribute('disabled')
    pay_button.textContent = `Pay $${money(order.total_cents)}`
    if (reply.status === 200) {
      status.textContent = ''
      window.location.href = `/orders/${order.order_key}?confirmed=1`
      return
    }
    if (reply.status === 402) {
      alert_box.hidden = false
      alert_box.replaceChildren(el('h2', { text: CARD_DECLINED_HEADING }), el('p', { text: CARD_DECLINED_BODY }))
      return
    }
    if (reply.status === 409 && reply.body.error === 'insufficient_stock') {
      const product = reply.body.order?.lines[0]?.product_name ?? 'this fitting'
      alert_box.hidden = false
      alert_box.replaceChildren(el('h2', { text: SOLD_OUT_HEADING }), el('p', { text: sold_out_body(product) }))
      return
    }
    if (reply.status === 422) {
      show_field_errors(reply.body.errors ?? {})
      return
    }
    if (reply.status === 503) {
      alert_box.hidden = false
      alert_box.replaceChildren(el('h2', { text: PAYMENT_OUTAGE_HEADING }), el('p', { text: PAYMENT_OUTAGE_BODY }))
      return
    }
  })

  account_button.addEventListener('click', async () => {
    if (account_button.hasAttribute('disabled')) return
    account_button.setAttribute('disabled', '')
    account_button.textContent = 'Placing order'
    const reply = await api.post<{ order?: OrderPublic; errors?: Record<string, string> }>(
      `/api/orders/${order.order_key}/place-on-account`,
      {
        delivery: {
          name: (full_name as HTMLInputElement).value,
          address: (address as HTMLInputElement).value,
          city: (city as HTMLInputElement).value,
          postcode: (postcode as HTMLInputElement).value,
        },
        purchase_order: (purchase_order as HTMLInputElement).value,
      },
      { 'Idempotency-Key': request_key },
    )
    account_button.removeAttribute('disabled')
    account_button.textContent = 'Place order on account'
    if (reply.status === 200) {
      window.location.href = `/orders/${order.order_key}?placed=1`
      return
    }
    if (reply.status === 422) {
      show_field_errors(reply.body.errors ?? {})
    }
  })

  main.append(
    el('div', { class: 'page' }, [
      el('h1', { text: 'Checkout' }),
      el('div', { class: 'checkout-layout', style: 'display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:24px' }, [
        el('div', {}, [alert_box, form, pay_button, account_button, status]),
        summary,
      ]),
    ]),
  )
  const order_confirmed = new URL(location.href).searchParams.get('confirmed')
  if (order_confirmed) status.textContent = ''
}
