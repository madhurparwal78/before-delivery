/**
 * Kill Bill client for the external payment plugin.
 * State-changing calls are idempotent through transaction external keys.
 */
import { config } from './db.js'

export interface KbAccount {
  accountId: string
  paymentMethodId: string
}

export class KbPaymentUnavailable extends Error {}

const TIMEOUT = 10_000

async function kb_fetch(
  path: string,
  init: { method: string; body?: unknown; query?: Record<string, string> } ,
): Promise<{ status: number; json: Record<string, unknown> | null; location: string | null }> {
  const url = new URL(config().killbill_url + path)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method,
      signal: controller.signal,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${config().killbill_username}:${config().killbill_password}`).toString('base64'),
        'X-Killbill-ApiKey': config().killbill_api_key,
        'X-Killbill-ApiSecret': config().killbill_api_secret,
        'X-Killbill-CreatedBy': 'lightfall',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('fetch failed'))) {
      throw new KbPaymentUnavailable('Kill Bill unreachable')
    }
    throw err
  }
  clearTimeout(timer)
  let json: Record<string, unknown> | null = null
  const text = await response.text()
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = null
    }
  }
  return { status: response.status, json, location: response.headers.get('location') }
}

function cents_to_amount(cents: number): string {
  return (cents / 100).toFixed(2)
}

export async function kb_get_account(external_key: string): Promise<{ accountId: string } | null> {
  const reply = await kb_fetch('/1.0/kb/accounts?externalKey=' + encodeURIComponent(external_key), { method: 'GET' })
  if (reply.status === 404) return null
  if (reply.status !== 200) throw new KbPaymentUnavailable(`account lookup failed ${reply.status}`)
  const json = reply.json
  if (!json) return null
  const accountId = json['accountId'] as string | undefined
  if (accountId) return { accountId }
  const list = json['data'] as { accountId: string }[] | undefined
  if (Array.isArray(list) && list.length > 0) return { accountId: list[0]!.accountId }
  return null
}

export async function kb_create_account(external_key: string, name: string): Promise<string> {
  const reply = await kb_fetch('/1.0/kb/accounts', {
    method: 'POST',
    body: { externalKey: external_key, name, currency: 'NZD' },
  })
  if (reply.status >= 400) throw new KbPaymentUnavailable(`account create failed ${reply.status}`)
  const found = await kb_get_account(external_key)
  if (!found) throw new KbPaymentUnavailable('account create not confirmed')
  return found.accountId
}

export async function kb_add_payment_method(account_id: string): Promise<string> {
  const reply = await kb_fetch(`/1.0/kb/accounts/${account_id}/paymentMethods`, {
    method: 'POST',
    query: { pluginName: '__EXTERNAL_PAYMENT__' },
    body: { pluginName: '__EXTERNAL_PAYMENT__' },
  })
  if (reply.status >= 400 && (reply.json?.['code'] as number | undefined) !== 7023) {
    throw new KbPaymentUnavailable(`payment method create failed ${reply.status}`)
  }
  const methods = await kb_fetch(`/1.0/kb/accounts/${account_id}/paymentMethods`, { method: 'GET' })
  const list = methods.json as { paymentMethodId: string; isDefault: boolean }[] | null
  const chosen = list?.find((m) => m.isDefault) ?? list?.[0]
  if (!chosen) throw new KbPaymentUnavailable('payment method missing')
  if (!chosen.isDefault) {
    const makeDefault = await kb_fetch(
      `/1.0/kb/accounts/${account_id}/paymentMethods/${chosen.paymentMethodId}/setDefault`,
      { method: 'PUT' },
    )
    if (makeDefault.status >= 400) throw new KbPaymentUnavailable(`payment method default failed ${makeDefault.status}`)
  }
  return chosen.paymentMethodId
}

export interface KbPayment {
  paymentId: string
  transactions: { transactionId: string; transactionType: string; status: string; transactionExternalKey: string }[]
  authAmount: number
  capturedAmount: number
  refundedAmount: number
}

export async function kb_find_payment_by_key(external_key: string): Promise<KbPayment | null> {
  const reply = await kb_fetch('/1.0/kb/payments?externalKey=' + encodeURIComponent(external_key), { method: 'GET' })
  if (reply.status === 404) return null
  if (reply.status !== 200) throw new KbPaymentUnavailable(`payment lookup failed ${reply.status}`)
  const body = reply.json
  if (Array.isArray(body)) {
    const list = body as unknown as KbPayment[]
    if (list.length === 0) return null
    return list[0]!
  }
  if (body && typeof body === 'object') return body as unknown as KbPayment
  return null
}

/** Find the payment carrying a successful transaction with the given external key. */
export async function kb_find_payment_by_transaction(account_id: string, transaction_key: string): Promise<KbPayment | null> {
  const reply = await kb_fetch(`/1.0/kb/accounts/${account_id}/payments?withAttempts=false`, { method: 'GET' })
  if (reply.status !== 200) throw new KbPaymentUnavailable(`payment list failed ${reply.status}`)
  const list = reply.json as unknown as KbPayment[]
  if (!Array.isArray(list)) return null
  for (const payment of list) {
    const found = payment.transactions.find((t) => t.transactionExternalKey === transaction_key && t.status === 'SUCCESS')
    if (found) return payment
  }
  return null
}

export async function kb_get_payment(payment_id: string): Promise<KbPayment> {
  const reply = await kb_fetch(`/1.0/kb/payments/${payment_id}`, { method: 'GET' })
  if (reply.status !== 200) throw new KbPaymentUnavailable('payment get failed')
  return reply.json as unknown as KbPayment
}

export interface AuthoriseResult {
  paymentId: string
  transactionId: string
  declined: boolean
}

/** AUTHORIZE the order total on the buyer's account payment method. */
export async function kb_authorise(
  account_id: string,
  order_key: string,
  total_cents: number,
): Promise<AuthoriseResult> {
  const existing = await kb_find_payment_by_key(order_key)
  if (existing) {
    const auth = existing.transactions.find((t) => t.transactionExternalKey === `${order_key}-auth` && t.status === 'SUCCESS')
    if (auth) return { paymentId: existing.paymentId, transactionId: auth.transactionId, declined: false }
  }
  const reply = await kb_fetch(`/1.0/kb/accounts/${account_id}/payments`, {
    method: 'POST',
    query: { externalKey: order_key },
    body: {
      paymentExternalKey: order_key,
      transactionType: 'AUTHORIZE',
      amount: cents_to_amount(total_cents),
      currency: 'NZD',
      transactionExternalKey: `${order_key}-auth`,
    },
  })
  if (reply.status === 402) return { paymentId: '', transactionId: '', declined: true }
  if (reply.status >= 400) {
    // A transaction key that already succeeded means an authorisation from an
    // earlier attempt exists under a different payment: adopt it.
    const adopted = await kb_find_payment_by_transaction(account_id, `${order_key}-auth`)
    const auth = adopted?.transactions.find((t) => t.transactionExternalKey === `${order_key}-auth`)
    if (adopted && auth) {
      return { paymentId: adopted.paymentId, transactionId: auth.transactionId, declined: auth.status !== 'SUCCESS' }
    }
    throw new KbPaymentUnavailable(`authorise failed ${reply.status}`)
  }
  // Read the result back through the payment external key.
  for (let attempt = 0; attempt < 3; attempt++) {
    const payment = await kb_find_payment_by_key(order_key)
    if (payment) {
      const auth = payment.transactions.find((t) => t.transactionExternalKey === `${order_key}-auth`)
      if (auth) {
        if (auth.status === 'SUCCESS') return { paymentId: payment.paymentId, transactionId: auth.transactionId, declined: false }
        return { paymentId: payment.paymentId, transactionId: auth.transactionId, declined: true }
      }
    }
  }
  throw new KbPaymentUnavailable('authorise result unknown')
}

export async function kb_capture(payment_id: string, order_key: string, total_cents: number): Promise<string> {
  // Capture is idempotent on the payment's own captured amount.
  const payment = await kb_get_payment(payment_id)
  const captured = payment.transactions.find((t) => t.transactionType === 'CAPTURE' && t.status === 'SUCCESS')
  if (captured) return captured.transactionId
  const reply = await kb_fetch(`/1.0/kb/payments/${payment_id}`, {
    method: 'POST',
    body: {
      transactionType: 'CAPTURE',
      amount: cents_to_amount(total_cents),
      currency: 'NZD',
      transactionExternalKey: `${order_key}-capture`,
    },
  })
  if (reply.status >= 400) {
    const again = await kb_get_payment(payment_id)
    const capped = again.transactions.find((t) => t.transactionType === 'CAPTURE' && t.status === 'SUCCESS')
    if (capped) return capped.transactionId
    throw new KbPaymentUnavailable(`capture failed ${reply.status}`)
  }
  const again = await kb_get_payment(payment_id)
  const capped = again.transactions.find((t) => t.transactionType === 'CAPTURE' && t.status === 'SUCCESS')
  if (!capped) throw new KbPaymentUnavailable('capture not confirmed')
  return capped.transactionId
}

export async function kb_refund(payment_id: string, order_key: string, n: number, amount_cents: number): Promise<string> {
  const key = `${order_key}-refund-${n}`
  const payment = await kb_get_payment(payment_id)
  const existing = payment.transactions.find((t) => t.transactionExternalKey === key && t.status === 'SUCCESS')
  if (existing) return existing.transactionId
  const reply = await kb_fetch(`/1.0/kb/payments/${payment_id}`, {
    method: 'POST',
    body: {
      transactionType: 'REFUND',
      amount: cents_to_amount(amount_cents),
      currency: 'NZD',
      transactionExternalKey: key,
    },
  })
  if (reply.status >= 400) {
    const code = (reply.json?.['code'] as number | undefined) ?? 0
    if (code === 7030) {
      const again = await kb_get_payment(payment_id)
      const found = again.transactions.find((t) => t.transactionExternalKey === key && t.status === 'SUCCESS')
      if (found) return found.transactionId
    }
    throw new KbPaymentUnavailable(`refund failed ${reply.status}`)
  }
  const again = await kb_get_payment(payment_id)
  const found = again.transactions.find((t) => t.transactionExternalKey === key && t.status === 'SUCCESS')
  if (!found) throw new KbPaymentUnavailable('refund not confirmed')
  return found.transactionId
}

export interface KbInvoice {
  invoiceId: string
  invoiceNumber: string
  invoiceDate: string
  balance: number
  amount: number
  status?: string
}

export async function kb_create_invoice(
  account_id: string,
  items: { description: string; amount_cents: number }[],
): Promise<KbInvoice> {
  const charges = items.map((i) => ({
    description: i.description,
    amount: Number(cents_to_amount(i.amount_cents)),
    currency: 'NZD',
  }))
  const reply = await kb_fetch(`/1.0/kb/invoices/charges/${account_id}`, {
    method: 'POST',
    query: { autoCommit: 'true' },
    body: charges,
  })
  if (reply.status >= 400) throw new KbPaymentUnavailable(`invoice create failed ${reply.status}`)
  const items_json = reply.json as { invoiceId: string }[] | null
  const invoice_id = items_json?.[0]?.invoiceId
  if (!invoice_id) throw new KbPaymentUnavailable('invoice id missing')
  const invoice = await kb_fetch(`/1.0/kb/invoices/${invoice_id}`, { method: 'GET' })
  if (invoice.status !== 200) throw new KbPaymentUnavailable('invoice get failed')
  const body = invoice.json as unknown as KbInvoice
  if (body.status !== 'COMMITTED') {
    const commit = await kb_fetch(`/1.0/kb/invoices/${invoice_id}/commitInvoice`, { method: 'PUT' })
    if (commit.status >= 400) throw new KbPaymentUnavailable('invoice commit failed')
  }
  return body
}

export async function kb_record_payment(
  account_id: string,
  invoice_id: string,
  order_key: string,
  amount_cents: number,
): Promise<void> {
  const reply = await kb_fetch(`/1.0/kb/invoices/${invoice_id}/payments`, {
    method: 'POST',
    query: { externalPayment: 'true' },
    body: {
      targetInvoiceId: invoice_id,
      accountId: account_id,
      currency: 'NZD',
      purchasedAmount: Number(cents_to_amount(amount_cents)),
      authAmount: Number(cents_to_amount(amount_cents)),
      paymentExternalKey: `${order_key}-payment`,
      transactions: [
        {
          transactionExternalKey: `${order_key}-payment`,
          transactionType: 'PURCHASE',
          amount: Number(cents_to_amount(amount_cents)),
          currency: 'NZD',
        },
      ],
    },
  })
  if (reply.status >= 400) throw new KbPaymentUnavailable(`payment record failed ${reply.status}`)
}

export async function kb_probe(): Promise<boolean> {
  try {
    const reply = await kb_fetch('/1.0/kb/tenants', { method: 'GET' })
    return reply.status < 500
  } catch {
    return false
  }
}

/** The published decline card: no Kill Bill payment is created for it. */
export function is_declined_card(number: string): boolean {
  return number.replace(/\s+/g, '') === '4000000000000002'
}
