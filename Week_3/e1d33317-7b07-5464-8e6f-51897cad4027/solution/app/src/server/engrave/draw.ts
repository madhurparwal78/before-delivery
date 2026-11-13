// Draws one system as SVG markup: staff groups with their notation, barlines, measure boxes and
// the numbers above the top staff. renderSystem wraps it in a root svg; renderPartPage stacks several.

import type { TextRun } from '../../shared/text.js'
import {
  at, drawStaffMeasure, StaffArt, type DynamicMark, type Env, type TextMark,
} from './art.js'
import {
  availableWidth, beamGroupTicks, HEADER_WIDTH, measureLayout, TEXT_SIZE, type Metrics,
} from './plan.js'
import { indexOf, type Cell } from './model.js'
import {
  BARLINE_THICKNESS, BEAM_THICKNESS, clefShape, glyphRef, INK, LEDGER_THICKNESS, MUTED, NOTATION_FONT, NOTE_QUARTER_UP,
  NUMBER_FONT, STAFF_LINE, STEM_THICKNESS, TEXT_FONT, THICK_BARLINE_THICKNESS, THIN_THICK_SEPARATION, TIE_THICKNESS, TIME_DIGIT_WIDTH, TIME_SIG_0,
} from './smufl.js'
import type { EngraveRequest, SystemPlan } from './types.js'

const MAX_STRETCH = 2.5
const MIN_STRETCH = 0.6
const LAST_SYSTEM_FILL = 0.7
const TOP_BAND = 3.1
const MIN_ABOVE = 2
const MIN_BELOW = 1.6
const MIN_STAFF_GAP = 4.4
const DYNAMIC_ABOVE_BAND = 3.3
const DYNAMIC_BELOW_BAND = 3.4
const TEXT_LINE = 2.0

interface DrawnSystem {
  /** SVG content of the system in its own coordinates, no root element. */
  content: string
  width: number
  height: number
}

export const fmt = (value: number): string => String(Math.round(value * 100) / 100)

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function bravura(x: number, y: number, size: number, text: string, extra = ''): string {
  return `<text font-family="${NOTATION_FONT}" font-size="${fmt(size)}" x="${fmt(x)}" y="${fmt(y)}"${extra}>${text}</text>`
}

function textLines(runs: readonly TextRun[]): TextRun[][] {
  const lines: TextRun[][] = []
  for (const run of runs) {
    if (run.breakBefore || lines.length === 0) lines.push([])
    at(lines, lines.length - 1).push(run)
  }
  return lines
}

function runStyle(run: TextRun): string {
  return `${run.italic ? ' font-style="italic"' : ''}${run.bold ? ' font-weight="700"' : ''}`
}

function textMarkup(mark: TextMark, lastBaseline: number, sp: number): string {
  const lines = textLines(mark.runs)
  const size = TEXT_SIZE * sp
  const lineHeight = TEXT_LINE * sp
  const firstBaseline = lastBaseline - (lines.length - 1) * lineHeight
  const spans = lines
    .map((line, k) => {
      const lead = k === 0 ? '' : ` x="${fmt(mark.x)}" dy="${fmt(lineHeight)}"`
      return line
        .map((run, r) => {
          const attrs = `${r === 0 ? lead : ''}${runStyle(run)}`
          return `<tspan${attrs}>${escapeXml(run.text)}</tspan>`
        })
        .join('')
    })
    .join('')
  return `<text font-family="${TEXT_FONT}" font-size="${fmt(size)}" x="${fmt(mark.x)}" y="${fmt(firstBaseline)}">${spans}</text>`
}

function dynamicMarkup(mark: DynamicMark, baseline: number, sp: number): string {
  return bravura(mark.x, baseline, 4 * sp, mark.text, ' text-anchor="middle"')
}

function strokePath(d: string, width: number): string {
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${fmt(width)}"/>`
}

function crescent(x1: number, y1: number, x2: number, y2: number, dir: number, sp: number): string {
  const peak = Math.max(0.55 * sp, Math.min(1.15 * sp, 0.3 * sp + 0.035 * (x2 - x1)))
  const middle = (y1 + y2) / 2
  const xm = (x1 + x2) / 2
  const outer = middle + dir * 2 * peak
  const inner = middle + dir * 2 * (peak - TIE_THICKNESS * sp)
  return `M${fmt(x1)} ${fmt(y1)}Q${fmt(xm)} ${fmt(outer)} ${fmt(x2)} ${fmt(y2)}Q${fmt(xm)} ${fmt(inner)} ${fmt(x1)} ${fmt(y1)}Z`
}

interface StaffFrame {
  top: number
  art: StaffArt
}

interface Geometry {
  frames: StaffFrame[]
  height: number
}

function stack(arts: readonly StaffArt[], sp: number): Geometry {
  const frames: StaffFrame[] = []
  let cursor = TOP_BAND * sp
  let previousBottom = 0
  let previousBelow = 0
  arts.forEach((art, k) => {
    const above = Math.max(MIN_ABOVE * sp, -art.top + (art.dynamicAbove ? DYNAMIC_ABOVE_BAND : 0.9) * sp + art.textLines * TEXT_LINE * sp + (art.textLines > 0 ? 0.3 * sp : 0))
    const top = k === 0 ? cursor + above : previousBottom + Math.max(previousBelow + above, MIN_STAFF_GAP * sp)
    frames.push({ top, art })
    previousBottom = top + 4 * sp
    previousBelow = Math.max(MIN_BELOW * sp, art.bottom - 4 * sp + (art.dynamicBelow ? DYNAMIC_BELOW_BAND : 1) * sp)
    cursor = previousBottom
  })
  return { frames, height: previousBottom + (arts.length > 0 ? previousBelow : 0) + 0.5 * sp }
}

function artMarkup(frame: StaffFrame, sp: number): string {
  const { art, top } = frame
  const parts: string[] = []
  for (const g of art.glyphs) parts.push(bravura(g.x, top + g.y, 4 * sp, g.text, g.attrs ? ` ${g.attrs}` : ''))
  if (art.stems.length > 0) {
    parts.push(strokePath(art.stems.map((s) => `M${fmt(s.x1)} ${fmt(top + s.y1)}V${fmt(top + s.y2)}`).join(''), STEM_THICKNESS * sp))
  }
  if (art.ledgers.length > 0) {
    parts.push(strokePath(art.ledgers.map((s) => `M${fmt(s.x1)} ${fmt(top + s.y1)}H${fmt(s.x2)}`).join(''), LEDGER_THICKNESS * sp))
  }
  const fills: string[] = []
  for (const b of art.beams) {
    const t = b.inward * BEAM_THICKNESS * sp
    fills.push(`M${fmt(b.x1)} ${fmt(top + b.y1)}L${fmt(b.x2)} ${fmt(top + b.y2)}V${fmt(top + b.y2 + t)}L${fmt(b.x1)} ${fmt(top + b.y1 + t)}Z`)
  }
  for (const t of art.ties) fills.push(crescent(t.x1, top + t.y1, t.x2, top + t.y2, t.dir, sp))
  if (fills.length > 0) parts.push(`<path d="${fills.join('')}" fill="${INK}"/>`)
  const topExtent = Math.max(0, -art.top)
  const belowExtent = Math.max(0, art.bottom - 4 * sp)
  const dynamicAbove = top - topExtent - 1.3 * sp
  const dynamicBelow = top + 4 * sp + belowExtent + 2.7 * sp
  const textBaseline = top - topExtent - (art.dynamicAbove ? DYNAMIC_ABOVE_BAND : 0.9) * sp
  for (const d of art.dynamics) parts.push(dynamicMarkup(d, d.above ? dynamicAbove : dynamicBelow, sp))
  for (const t of art.texts) parts.push(textMarkup(t, textBaseline, sp))
  return parts.join('')
}

interface SystemLayout {
  env: Env
  measures: number[]
  endX: number
}

function layoutSystem(req: EngraveRequest, plan: SystemPlan, metrics: Metrics): SystemLayout {
  const index = indexOf(req)
  const sp = metrics.sp
  const measures: number[] = []
  for (let m = plan.firstMeasure; m <= plan.lastMeasure; m++) measures.push(m)
  const layouts = measures.map((m) => measureLayout(index, m))
  const natural = layouts.reduce((sum, layout) => sum + layout.width * sp, 0)
  const available = availableWidth(metrics) * sp
  const closing = plan.lastMeasure === index.measureCount
  const fills = !closing || natural >= LAST_SYSTEM_FILL * available
  const stretch = fills ? Math.max(MIN_STRETCH, Math.min(MAX_STRETCH, available / natural)) : 1
  const startX = metrics.left + HEADER_WIDTH * sp
  const left: number[] = []
  const widths: number[] = []
  let x = startX
  for (const layout of layouts) {
    left.push(x)
    const width = layout.width * sp * stretch
    widths.push(width)
    x += width
  }
  const env: Env = {
    sp, index, first: plan.firstMeasure, stretch, left, widths, layouts, startX, endX: x,
    groupTicks: measures.map((m) => beamGroupTicks(index, m)),
  }
  return { env, measures, endX: x }
}

function nameMarkup(name: string, top: number, metrics: Metrics): string {
  const sp = metrics.sp
  const size = 1.7 * sp
  const room = metrics.left - 8
  const estimate = name.length * size * 0.55
  const fit = estimate > room ? ` textLength="${fmt(room)}" lengthAdjust="spacingAndGlyphs"` : ''
  return `<text font-family="${TEXT_FONT}" font-size="${fmt(size)}" x="2" y="${fmt(top + 2 * sp + size * 0.35)}"${fit}>${escapeXml(name)}</text>`
}

function signatureMarkup(beats: number, beatType: number, x: number, top: number, sp: number): string {
  const digits = (n: number): string => glyphRef([...String(n)].map((d) => TIME_SIG_0 + Number(d)))
  const width = Math.max(String(beats).length, String(beatType).length) * TIME_DIGIT_WIDTH * sp
  const centre = x + 0.5 * sp + width / 2
  return bravura(centre, top + sp, 4 * sp, digits(beats), ' text-anchor="middle"') + bravura(centre, top + 3 * sp, 4 * sp, digits(beatType), ' text-anchor="middle"')
}

function staffMarkup(
  req: EngraveRequest, s: number, frame: StaffFrame, layout: SystemLayout, plan: SystemPlan, metrics: Metrics,
): string {
  const staff = at(req.staves, s)
  const { env } = layout
  const sp = metrics.sp
  const top = frame.top
  const lines: string[] = []
  for (let k = 0; k < 5; k++) lines.push(`M${fmt(metrics.left)} ${fmt(top + k * sp)}H${fmt(layout.endX)}`)
  const barlines: string[] = [`M${fmt(metrics.left)} ${fmt(top)}V${fmt(top + 4 * sp)}`]
  layout.measures.forEach((m, k) => {
    const x = at(env.left, k) + at(env.widths, k)
    if (m === env.index.measureCount) {
      const thick = THICK_BARLINE_THICKNESS * sp
      const thin = x - thick - THIN_THICK_SEPARATION * sp
      barlines.push(`M${fmt(thin)} ${fmt(top)}V${fmt(top + 4 * sp)}`)
    } else barlines.push(`M${fmt(x)} ${fmt(top)}V${fmt(top + 4 * sp)}`)
  })
  const clef = clefShape(staff.clef)
  const parts = [
    `<g data-staff-id="${escapeXml(staff.id)}" data-staff-top="${fmt(top)}" data-staff-height="${fmt(4 * sp)}">`,
    strokePath(lines.join(''), STAFF_LINE * sp),
    strokePath(barlines.join(''), BARLINE_THICKNESS * sp),
  ]
  if (plan.lastMeasure === env.index.measureCount) {
    const thick = THICK_BARLINE_THICKNESS * sp
    parts.push(strokePath(`M${fmt(layout.endX - thick / 2)} ${fmt(top)}V${fmt(top + 4 * sp)}`, thick))
  }
  parts.push(bravura(metrics.left + 0.8 * sp, top + clef.line * sp, 4 * sp, glyphRef([clef.code])))
  layout.measures.forEach((m, k) => {
    const sig = env.index.signatureChanges.get(m)
    if (sig) parts.push(signatureMarkup(sig.beats, sig.beatType, at(env.left, k), top, sp))
  })
  if (metrics.names) parts.push(nameMarkup(staff.name, top, metrics))
  parts.push(artMarkup(frame, sp), '</g>')
  return parts.join('')
}

function topBandMarkup(layout: SystemLayout, metrics: Metrics): string {
  const sp = metrics.sp
  const size = 1.55 * sp
  const baseline = 2.4 * sp
  const parts: string[] = []
  layout.measures.forEach((m, k) => {
    const x = at(layout.env.left, k) + 0.3 * sp
    parts.push(`<text font-family="${NUMBER_FONT}" font-size="${fmt(size)}" fill="${MUTED}" x="${fmt(x)}" y="${fmt(baseline)}">${m}</text>`)
    const bpm = layout.env.index.tempos.get(m)
    if (bpm !== undefined) {
      const markX = x + (String(m).length * 0.62 * 1.55 + 1.2) * sp
      parts.push(bravura(markX, baseline, 2.4 * sp, glyphRef([NOTE_QUARTER_UP])))
      parts.push(`<text font-family="${NUMBER_FONT}" font-size="${fmt(size)}" x="${fmt(markX + 1.4 * sp)}" y="${fmt(baseline)}">= ${bpm}</text>`)
    }
  })
  return parts.join('')
}

export function drawSystem(req: EngraveRequest, plan: SystemPlan, metrics: Metrics): DrawnSystem {
  const sp = metrics.sp
  const layout = layoutSystem(req, plan, metrics)
  const { env } = layout
  const arts = req.staves.map(() => new StaffArt(sp))
  const cells = layout.measures.map((m) => env.index.cells.get(m))
  const bySlot = new Map<number, Cell>()
  cells.forEach((list, k) => {
    for (const cell of list ?? []) bySlot.set(cell.staff * layout.measures.length + k, cell)
  })
  arts.forEach((art, s) => {
    layout.measures.forEach((_, k) => drawStaffMeasure(art, env, k, bySlot.get(s * layout.measures.length + k)))
  })
  const geometry = stack(arts, sp)
  const height = geometry.height
  const parts: string[] = []
  layout.measures.forEach((m, k) => {
    parts.push(
      `<rect class="measure-box" data-measure-box="${m}" x="${fmt(at(env.left, k))}" y="0" width="${fmt(at(env.widths, k))}" height="${fmt(height)}" fill="none" pointer-events="none"/>`,
    )
  })
  parts.push(topBandMarkup(layout, metrics))
  const first = geometry.frames[0]
  const last = geometry.frames[geometry.frames.length - 1]
  if (first && last && geometry.frames.length > 1) {
    parts.push(strokePath(`M${fmt(metrics.left)} ${fmt(first.top)}V${fmt(last.top + 4 * sp)}`, BARLINE_THICKNESS * sp))
  }
  geometry.frames.forEach((frame, s) => parts.push(staffMarkup(req, s, frame, layout, plan, metrics)))
  return { content: parts.join(''), width: metrics.width, height }
}
