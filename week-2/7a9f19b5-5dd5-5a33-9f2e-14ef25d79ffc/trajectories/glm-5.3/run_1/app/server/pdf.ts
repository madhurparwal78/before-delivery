/**
 * Minimal PDF writer for spec sheets and quotes: text-only pages with the
 * standard Helvetica fonts, generated in code without a PDF library.
 */

/** WinAnsi-safe text for the standard fonts: macrons and symbols become ASCII. */
function pdf_text(value: string): string {
  return value
    .replace(/ā/g, 'a').replace(/ē/g, 'e').replace(/ī/g, 'i').replace(/ō/g, 'o').replace(/ū/g, 'u')
    .replace(/Ā/g, 'A').replace(/Ē/g, 'E').replace(/Ī/g, 'I').replace(/Ō/g, 'O').replace(/Ū/g, 'U')
    .replace(/°/g, ' deg')
    .replace(/[^\x20-\xFF]/g, '?')
}

export interface TextItem {
  x: number
  y: number
  size: number
  bold: boolean
  text: string
}

/** Build a one-page PDF from positioned text items. */
export function build_pdf(items: TextItem[]): Buffer {
  const objects: string[] = []

  const content = items
    .map((item) => {
      const escaped = pdf_text(item.text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
      const font = item.bold ? '/F2' : '/F1'
      return `BT ${font} ${item.size} Tf 1 0 0 1 ${item.x.toFixed(2)} ${item.y.toFixed(2)} Tm (${escaped}) Tj ET`
    })
    .join('\n')
  const stream_length = Buffer.byteLength(content, 'latin1')

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  objects[6] = `<< /Length ${stream_length} >>\nstream\n${content}\nendstream`

  const parts: string[] = []
  const header = '%PDF-1.4\n'
  parts.push(header)
  const offsets: number[] = []
  let position = Buffer.byteLength(header, 'latin1')
  for (let i = 1; i <= 6; i++) {
    offsets[i] = position
    const body = `${i} 0 obj\n${objects[i]}\nendobj\n`
    parts.push(body)
    position += Buffer.byteLength(body, 'latin1')
  }
  const xref_position = position
  parts.push('xref\n0 7\n0000000000 65535 f \n')
  for (let i = 1; i <= 6; i++) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }
  parts.push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref_position}\n%%EOF\n`)
  const joined = parts.join('')
  return Buffer.from(joined, 'latin1')
}


const PAGE_H = 841.89
const MARGIN = 56

export interface QuoteLine {
  variant_code: string
  product_name: string
  finish_name: string
  beam_deg: number
  cct_k: number
  quantity: number
  unit_price_cents: number | null
  line_total_cents: number | null
}

export interface QuotePdfInput {
  project_name: string
  client_name: string
  owner_name: string
  show_prices: boolean
  subtotal_cents: number
  gst_cents: number
  total_cents: number
  lines: QuoteLine[]
}

export async function build_quote_pdf(input: QuotePdfInput): Promise<Buffer> {
  const items: TextItem[] = []
  let y = PAGE_H - MARGIN
  const push = (text: string, size = 10, bold = false, x = MARGIN) => {
    items.push({ x, y, size, bold, text })
    y -= size * 1.7
  }
  const gap = (n: number) => {
    y -= n
  }

  push('Lightfall', 20, true)
  push('Southerly Light Works - Otautahi Christchurch', 9)
  gap(8)
  push(`Quote: ${input.project_name}`, 14, true)
  if (input.client_name) push(`Client: ${input.client_name}`)
  push(`Prepared by: ${input.owner_name}`)
  gap(10)

  const col_code = MARGIN
  const col_qty = 320
  const col_price = 390
  const col_total = 480
  push('Code', 10, true, col_code)
  items.push({ x: col_qty, y, size: 10, bold: true, text: 'Qty' })
  if (input.show_prices) {
    items.push({ x: col_price, y, size: 10, bold: true, text: 'Unit' })
    items.push({ x: col_total, y, size: 10, bold: true, text: 'Total' })
  }
  y -= 20

  for (const item of input.lines) {
    items.push({ x: col_code, y, size: 10, bold: false, text: item.variant_code })
    items.push({
      x: col_code,
      y: y - 11,
      size: 8,
      bold: false,
      text: `${item.product_name} | ${item.finish_name} | ${item.beam_deg} deg | ${item.cct_k}K`,
    })
    items.push({ x: col_qty, y, size: 10, bold: false, text: String(item.quantity) })
    if (input.show_prices && item.unit_price_cents !== null && item.line_total_cents !== null) {
      items.push({ x: col_price, y, size: 10, bold: false, text: money_pdf(item.unit_price_cents) })
      items.push({ x: col_total, y, size: 10, bold: false, text: money_pdf(item.line_total_cents) })
    }
    y -= 30
  }
  gap(8)
  if (input.show_prices) {
    items.push({ x: col_price, y, size: 10, bold: false, text: 'Subtotal (excl. GST)' })
    items.push({ x: col_total, y, size: 10, bold: false, text: money_pdf(input.subtotal_cents) })
    y -= 18
    items.push({ x: col_price, y, size: 10, bold: false, text: 'GST (15%)' })
    items.push({ x: col_total, y, size: 10, bold: false, text: money_pdf(input.gst_cents) })
    y -= 18
    items.push({ x: col_price, y, size: 10, bold: true, text: 'Total (incl. GST)' })
    items.push({ x: col_total, y, size: 10, bold: true, text: money_pdf(input.total_cents) })
  }
  return build_pdf(items)
}

export async function build_spec_sheet_pdf(
  product_name: string,
  variant: {
    code: string
    finish_name: string
    beam_deg: number
    cct_k: number
    lumens: number
    candela: number
    retail_price_cents: number
  },
  product: { watts: number; cri: number; ip_rating: string; description: string },
): Promise<Buffer> {
  const items: TextItem[] = []
  let y = PAGE_H - MARGIN
  const push = (text: string, size = 10, bold = false, x = MARGIN) => {
    items.push({ x, y, size, bold, text })
    y -= size * 1.7
  }
  push('Lightfall spec sheet', 20, true)
  push('Southerly Light Works - Otautahi Christchurch', 9)
  y -= 8
  push(product_name, 16, true)
  push(product.description)
  y -= 6
  const rows: [string, string][] = [
    ['Code', variant.code],
    ['Finish', variant.finish_name],
    ['Beam angle', `${variant.beam_deg} deg`],
    ['Colour temperature', `${variant.cct_k}K`],
    ['Lumens', `${variant.lumens} lumens`],
    ['Candela', String(variant.candela)],
    ['Watts', `${product.watts} W`],
    ['CRI', String(product.cri)],
    ['IP rating', product.ip_rating],
    ['RRP + GST', money_pdf(variant.retail_price_cents)],
  ]
  for (const [label, value] of rows) {
    items.push({ x: MARGIN, y, size: 10, bold: true, text: label })
    items.push({ x: MARGIN + 140, y, size: 10, bold: false, text: value })
    y -= 17
  }
  return build_pdf(items)
}

function money_pdf(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100)
  const frac = Math.abs(cents) % 100
  return `$${dollars.toLocaleString('en-NZ')}.${String(frac).padStart(2, '0')}`
}
