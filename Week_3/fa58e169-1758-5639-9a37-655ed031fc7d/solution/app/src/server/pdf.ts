import { symbolsFor } from '../shared/symbols.ts'
import { config } from './config.ts'
import type { ChartData } from './domain/chart.ts'

const PAGE = { width: 595, height: 842, margin: 48 }

const WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]

const REPLACEMENTS: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' }

function plain(text: string): string {
  return [...text].map((ch) => REPLACEMENTS[ch] ?? (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 256 ? ch : '?')).join('')
}

function widthOf(text: string, size: number, bold = false): number {
  let total = 0
  for (const ch of text) total += WIDTHS[ch.charCodeAt(0) - 32] ?? 556
  return (total * size * (bold ? 1.07 : 1)) / 1000
}

function escape(text: string): string {
  return plain(text).replace(/[\\()]/g, (c) => `\\${c}`)
}

function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const out: string[] = []
  let line = ''
  for (const word of plain(text).split(' ')) {
    const attempt = line ? `${line} ${word}` : word
    if (line && widthOf(attempt, size, bold) > maxWidth) { out.push(line); line = word } else line = attempt
  }
  out.push(line)
  return out
}

const num = (n: number) => (Math.round(n * 100) / 100).toString()

/** One page's drawing operators. */
class Canvas {
  readonly ops: string[] = []
  text(x: number, y: number, size: number, text: string, bold = false): void {
    this.ops.push(`0.15 g BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td (${escape(text)}) Tj ET`)
  }
  line(x1: number, y1: number, x2: number, y2: number, width: number, grey = 0): void {
    this.ops.push(`${num(grey)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`)
  }
  rect(x: number, y: number, w: number, h: number, fill: [number, number, number] | null, stroke: number | null, width = 0.4): void {
    const paint = fill && stroke !== null ? 'B' : fill ? 'f' : 'S'
    this.ops.push(`${fill ? `${fill.map(num).join(' ')} rg ` : ''}${stroke !== null ? `${num(stroke)} G ${num(width)} w ` : ''}${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${paint}`)
  }
  circle(cx: number, cy: number, r: number, width: number, ink: number): void {
    const k = 0.5523 * r
    this.ops.push(`${num(ink)} G ${num(width)} w ${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c `
      + `${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c `
      + `${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c S`)
  }
}

type Rgb = [number, number, number]

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Draws one stitch glyph inside the cell at (x, y) with side s; ink 0 is black, 1 is white. */
function glyph(canvas: Canvas, key: string, x: number, y: number, s: number, ink: number): void {
  const w = Math.max(0.5, s / 10)
  const [l, r, b, t, cx, cy] = [x + s * 0.25, x + s * 0.75, y + s * 0.2, y + s * 0.8, x + s / 2, y + s / 2]
  switch (key) {
    case 'k': canvas.line(cx, b, cx, t, w, ink); break
    case 'p': canvas.line(l, cy, r, cy, w, ink); break
    case 'yo': canvas.circle(cx, cy, s * 0.22, w, ink); break
    case 'k2tog': canvas.line(l, b, r, t, w, ink); break
    case 'ssk': canvas.line(l, t, r, b, w, ink); break
    case 'cdd': canvas.line(l, b, cx, t, w, ink); canvas.line(cx, t, r, b, w, ink); canvas.line(cx, b, cx, t, w, ink); break
    case 'm1l': canvas.line(l, b, r, t, w, ink); canvas.line(l, t, l + s * 0.12, t, w * 1.6, ink); break
    case 'm1r': canvas.line(l, t, r, b, w, ink); canvas.line(r, t, r - s * 0.12, t, w * 1.6, ink); break
    case 'c22': canvas.line(l, b, r, t, w, ink); canvas.line(l, t, r, b, w, ink); break
    case 'sc': canvas.line(l, cy, r, cy, w, ink); canvas.line(cx, b, cx, t, w, ink); break
    case 'hdc': canvas.line(l, t, r, t, w, ink); canvas.line(cx, b, cx, t, w, ink); break
    case 'dc': canvas.line(l, t, r, t, w, ink); canvas.line(cx, b, cx, t, w, ink); canvas.line(cx - s * 0.15, cy - s * 0.1, cx + s * 0.15, cy + s * 0.1, w, ink); break
    case 'inc': canvas.line(l, t, cx, b, w, ink); canvas.line(cx, b, r, t, w, ink); break
    case 'dec': canvas.line(l, b, cx, t, w, ink); canvas.line(cx, t, r, b, w, ink); break
  }
}

function drawChart(canvas: Canvas, chart: ChartData, left: number, top: number, boxWidth: number, boxHeight: number): void {
  const gutter = 16
  const cell = Math.min(24, (boxWidth - gutter) / chart.width, boxHeight / chart.height)
  const colourwork = chart.colours.length > 1
  const hex = new Map(chart.colours.map((c) => [c.letter, rgb(c.hex)]))
  const labels = cell >= 7
  for (let row = 1; row <= chart.height; row++) {
    const y = top - (chart.height - row + 1) * cell
    if (labels) canvas.text(left, y + cell * 0.28, Math.min(7, cell * 0.7), String(row))
    for (let col = 1; col <= chart.width; col++) {
      const x = left + gutter + (col - 1) * cell
      const yarn = hex.get(chart.colour[row - 1][col - 1]) ?? [1, 1, 1]
      const stitch = chart.stitch[row - 1][col - 1]
      const fill: Rgb = colourwork && stitch !== 'ns' ? yarn : [1, 1, 1]
      canvas.rect(x, y, cell, cell, fill, 0.75, 0.3)
      glyph(canvas, stitch, x, y, cell, luminance(fill) < 0.45 ? 1 : 0)
    }
  }
  for (const box of chart.repeats) {
    canvas.rect(left + gutter + (box.fromCol - 1) * cell, top - (chart.height - box.fromRow + 1) * cell, (box.toCol - box.fromCol + 1) * cell,
      (box.toRow - box.fromRow + 1) * cell, null, 0.15, Math.max(0.8, cell / 8))
  }
}

function usedSymbols(chart: ChartData): { text: string; name: string }[] {
  const used = new Set(chart.stitch.flat())
  return symbolsFor(chart.craft, chart.terms).filter((s) => s.key !== 'ns' && used.has(s.key)).map((s) => ({ text: s.rsText, name: s.name }))
}

function footer(canvas: Canvas, name: string, page: number, total: number): void {
  const line = `${name} - page ${page} of ${total}`
  let size = 9
  while (size > 5 && widthOf(plain(line), size) > PAGE.width - 2 * PAGE.margin) size -= 0.5
  canvas.text(PAGE.margin, 28, size, line)
}

function firstPage(name: string, version: number, chart: ChartData, total: number): Canvas {
  const canvas = new Canvas()
  const inner = PAGE.width - 2 * PAGE.margin
  let y = PAGE.height - PAGE.margin - 16
  for (const part of wrap(name, 20, inner, true)) { canvas.text(PAGE.margin, y, 20, part, true); y -= 24 }
  canvas.text(PAGE.margin, y, 11, `Version ${version}`); y -= 16
  canvas.text(PAGE.margin, y, 11, `Cast on ${chart.castOn} ${chart.castOn === 1 ? 'stitch' : 'stitches'}`); y -= 26
  canvas.text(PAGE.margin, y, 13, 'Chart', true); y -= 12
  const key = usedSymbols(chart)
  const keyHeight = 30 + key.length * 15
  const room = y - (PAGE.margin + 20) - keyHeight
  drawChart(canvas, chart, PAGE.margin, y, inner, Math.max(60, room))
  const cell = Math.min(24, (inner - 16) / chart.width, Math.max(60, room) / chart.height)
  y -= chart.height * cell + 28
  canvas.text(PAGE.margin, y, 13, 'Key', true); y -= 16
  for (const entry of key) { canvas.text(PAGE.margin, y, 10, `${entry.text} ${entry.name}`); y -= 15 }
  footer(canvas, name, 1, total)
  return canvas
}

function instructionPage(name: string, lines: string[], page: number, total: number): Canvas {
  const canvas = new Canvas()
  const inner = PAGE.width - 2 * PAGE.margin
  const top = PAGE.height - PAGE.margin - 16
  canvas.text(PAGE.margin, top, 16, 'Instructions', true)
  const available = top - 28 - (PAGE.margin + 20)
  let size = 10.5
  let wrapped = lines.map((l) => wrap(l, size, inner))
  while (size > 5 && wrapped.flat().length * size * 1.45 + lines.length * 4 > available) {
    size -= 0.5
    wrapped = lines.map((l) => wrap(l, size, inner))
  }
  let y = top - 28
  for (const parts of wrapped) {
    for (const part of parts) { canvas.text(PAGE.margin, y, size, part); y -= size * 1.45 }
    y -= 4
  }
  footer(canvas, name, page, total)
  return canvas
}

function assemble(pages: Canvas[]): Buffer {
  const objects: string[] = []
  const add = (body: string) => objects.push(body) && objects.length
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const kids: number[] = []
  for (const canvas of pages) {
    const stream = canvas.ops.join('\n')
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** The printable sheet: cover page with the chart and key, then the written lines, each page footed. */
export function buildSheet(name: string, version: number, chart: ChartData, lines: string[]): Buffer {
  const per = config.limits.sheetLinesPerPage
  const chunks = Array.from({ length: Math.ceil(lines.length / per) }, (_, i) => lines.slice(i * per, (i + 1) * per))
  const total = 1 + chunks.length
  return assemble([firstPage(name, version, chart, total), ...chunks.map((chunk, i) => instructionPage(name, chunk, i + 2, total))])
}
