/**
 * Quote share processing: PDF to MinIO, confirm, then email each recipient.
 * Worked from the stored share row so any instance on the database finishes it.
 */
import type { Api } from './api.js'
import { build_quote_pdf, type QuotePdfInput } from './pdf.js'
import { money } from './domain.js'
import { quote_share_email } from './mail.js'

const processing = new Set<string>()

export async function queue_share(api: Api, share_id: string): Promise<void> {
  // The background cadence picks the share up from its stored state.
  void api
  void share_id
}

export async function process_shares(api: Api): Promise<void> {
  const pending = await api.with_client(async (client) => {
    const rows = await client.query<{ id: string }>(
      `SELECT id FROM shares WHERE pdf_status IN ('pending','waiting_for_storage') ORDER BY created_at LIMIT 20`,
    )
    return rows.rows.map((r) => r.id)
  })
  for (const id of pending) {
    if (processing.has(id)) continue
    processing.add(id)
    try {
      await process_share(api, id)
    } catch {
      // Retried on the next cadence.
    } finally {
      processing.delete(id)
    }
  }
}

async function process_share(api: Api, share_id: string): Promise<void> {
  let project_id: number | null = null
  const share = await api.with_client(async (client) => {
    const row = await client.query(
      `SELECT s.id, s.project_id, s.price_display, s.recipients, s.message, s.pdf_status,
              p.name AS project_name, p.client_name, p.ceiling_height_mm, p.room_width_mm, p.room_depth_mm,
              u.name AS owner_name
       FROM shares s JOIN projects p ON p.id=s.project_id JOIN users u ON u.id=s.owner_id
       WHERE s.id=$1`,
      [share_id],
    )
    return row.rows[0] ?? null
  })
  if (!share || share.pdf_status === 'ready') return
  project_id = share.project_id
  const lines = await api.with_client(async (client) => {
    const rows = await client.query(
      `SELECT v.code, l.product_name, v.finish, v.beam_deg, v.cct_k, l.quantity
       FROM project_lines l JOIN variants v ON v.id=l.variant_id WHERE l.project_id=$1 ORDER BY l.id`,
      [share.project_id],
    )
    return rows.rows
  })
  const variants = await api.with_client(async (client) => {
    const rows = await client.query(
      `SELECT code, retail_price_cents, trade_price_cents FROM variants`,
    )
    const map = new Map<string, { retail: number; trade: number }>()
    for (const row of rows.rows) map.set(row.code, { retail: row.retail_price_cents, trade: row.trade_price_cents })
    return map
  })
  const show_prices = share.price_display !== 'none'
  const quote_lines = lines.map((l) => {
    const prices = variants.get(l.code)!
    const unit = share.price_display === 'trade' ? prices.trade : prices.retail
    return {
      variant_code: l.code,
      product_name: l.product_name,
      finish_name: finish_name_of(l.finish),
      beam_deg: l.beam_deg,
      cct_k: l.cct_k,
      quantity: l.quantity,
      unit_price_cents: show_prices ? unit : null,
      line_total_cents: show_prices ? unit * l.quantity : null,
    }
  })
  const subtotal = quote_lines.reduce((sum, l) => sum + (l.line_total_cents ?? 0), 0)
  const gst = Math.floor((subtotal * 15) / 100 + 0.5)
  const input: QuotePdfInput = {
    project_name: share.project_name,
    client_name: share.client_name,
    owner_name: share.owner_name,
    show_prices,
    subtotal_cents: subtotal,
    gst_cents: gst,
    total_cents: subtotal + gst,
    lines: quote_lines,
  }
  const pdf = await build_quote_pdf(input)
  const object_key = `quotes/${share.project_id}/${share.id}.pdf`
  try {
    await api.deps.storage.put(object_key, pdf, 'application/pdf')
    if (!(await api.deps.storage.exists(object_key))) throw new Error('not confirmed')
  } catch {
    await api.with_client(async (client) => {
      await client.query(`UPDATE shares SET pdf_status='waiting_for_storage' WHERE id=$1`, [share.id])
    })
    return
  }
  await api.with_client(async (client) => {
    await client.query(`UPDATE shares SET pdf_status='ready', object_key=$2 WHERE id=$1`, [share.id, object_key])
  })

  // Emails go out only once the PDF is ready.
  const recipients = JSON.parse(share.recipients) as string[]
  const text = quote_text(input)
  const html = quote_html(input)
  for (const to of recipients) {
    const email = quote_share_email(share.owner_name, share.project_name, share.message, text, html)
    try {
      await api.deps.mailer.send(to, email.subject, email.text, email.html, [
        { filename: `lightfall-quote-${share.id}.pdf`, content: pdf, contentType: 'application/pdf' },
      ])
    } catch {
      // Mail retry is not required by the brief; the share is already ready.
    }
  }
  void project_id
}

function quote_text(input: QuotePdfInput): string {
  const lines = input.lines
    .map((l) => {
      const detail = `${l.variant_code} — ${l.product_name} (${l.finish_name}, ${l.beam_deg}°, ${l.cct_k}K) x ${l.quantity}`
      if (!input.show_prices) return detail
      return `${detail} — ${money(l.line_total_cents ?? 0)}`
    })
    .join('\n')
  const totals = input.show_prices
    ? [
        '',
        `Subtotal (excl. GST): ${money(input.subtotal_cents)}`,
        `GST (15%): ${money(input.gst_cents)}`,
        `Total (incl. GST): ${money(input.total_cents)}`,
      ].join('\n')
    : ''
  return [input.project_name, lines, totals].filter((s) => s !== undefined).join('\n')
}

function quote_html(input: QuotePdfInput): string {
  const rows = input.lines
    .map((l) => {
      const price_cell = input.show_prices ? `<td>${money(l.unit_price_cents ?? 0)}</td><td>${money(l.line_total_cents ?? 0)}</td>` : ''
      return `<tr><td style="font-family:monospace">${l.variant_code}</td><td>${l.product_name} · ${l.finish_name} · ${l.beam_deg}° · ${l.cct_k}K</td><td>x ${l.quantity}</td>${price_cell}</tr>`
    })
    .join('')
  const head = input.show_prices ? '<tr><th>Code</th><th>Fitting</th><th>Qty</th><th>Unit</th><th>Total</th></tr>' : '<tr><th>Code</th><th>Fitting</th><th>Qty</th></tr>'
  const totals = input.show_prices
    ? `<p style="font-family:monospace">Subtotal (excl. GST): ${money(input.subtotal_cents)}<br/>GST (15%): ${money(input.gst_cents)}<br/>Total (incl. GST): ${money(input.total_cents)}</p>`
    : ''
  return `<table style="border-collapse:collapse">${head}${rows}</table>${totals}`
}

const FINISH_NAMES: Record<string, string> = {
  WH: 'Matte White',
  BK: 'Matte Black',
  BR: 'Brushed Brass',
  BZ: 'Aged Bronze',
  CH: 'Charcoal',
  SN: 'Satin Nickel',
}

function finish_name_of(code: string): string {
  return FINISH_NAMES[code] ?? code
}
