// Geometry of one staff in one system, kept relative to the top staff line until the system's
// vertical layout is known. Drawing code only collects marks; art emission turns them into SVG.

import { idKey } from '../../shared/voice.js'
import { textRuns, type TextRun } from '../../shared/text.js'
import {
  accidentalCode, accidentalWidth, AUGMENTATION_DOT, BEAM_PITCH, BEAM_THICKNESS, DOT_ADVANCE, dynamicCodes, flagCount, flagGlyph, glyphRef,
  headCode, headWidth, LEDGER_EXTENSION, restCode, restWidth, STEM_ATTACH_Y, STEM_THICKNESS, STEM_UP_X,
} from './smufl.js'
import type { Cell, Index, Item, MeasureLayout } from './model.js'

interface GlyphMark {
  x: number
  y: number
  text: string
  attrs: string
}
interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}
/** A beam from its outer edge; `inward` is +1 when the beam body lies below the edge. */
interface BeamMark extends Segment {
  inward: 1 | -1
}
/** A tie or stub; `dir` is -1 for an arc above the notes and +1 for below. */
interface TieMark extends Segment {
  dir: 1 | -1
}
export interface TextMark {
  x: number
  runs: TextRun[]
}
export interface DynamicMark {
  x: number
  text: string
  above: boolean
}

export interface Env {
  sp: number
  index: Index
  first: number
  stretch: number
  /** X of the left barline of each measure of the system. */
  left: number[]
  /** Width of each measure in user units. */
  widths: number[]
  layouts: MeasureLayout[]
  groupTicks: number[]
  /** X where the system's first measure starts. */
  startX: number
  endX: number
}

export function at<T>(list: readonly T[], i: number): T {
  const value = list[i]
  if (value === undefined) throw new Error(`index ${i} out of range`)
  return value
}

export class StaffArt {
  glyphs: GlyphMark[] = []
  stems: Segment[] = []
  ledgers: Segment[] = []
  beams: BeamMark[] = []
  ties: TieMark[] = []
  texts: TextMark[] = []
  dynamics: DynamicMark[] = []
  top = 0
  bottom: number
  textLines = 0
  dynamicAbove = false
  dynamicBelow = false

  constructor(readonly sp: number) {
    this.bottom = 4 * sp
  }

  reach(y: number): void {
    if (y < this.top) this.top = y
    if (y > this.bottom) this.bottom = y
  }

  glyph(x: number, y: number, codes: readonly number[], attrs = ''): void {
    this.glyphs.push({ x, y, text: glyphRef(codes), attrs })
  }
}

const yOfPos = (pos: number, sp: number): number => ((8 - pos) * sp) / 2

function eventAttrs(item: Item): string {
  const event = item.event
  if (!event) return ''
  const id = idKey(event.id).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `data-event="${id}" data-voice="${item.voice}" data-measure="${item.measure}" data-beat="${item.beat}"`
}

function headX(env: Env, i: number, item: Item): number {
  const layout = at(env.layouts, i)
  const column = layout.columnOf.get(item.tick) ?? 0
  return at(env.left, i) + (layout.heads[column] ?? 0) * env.sp * env.stretch + item.shift * env.sp
}

function stemDirection(item: Item, voice: 1 | 2, both: boolean): boolean {
  return both ? voice === 1 : item.pos < 4
}

function drawDots(art: StaffArt, item: Item, x: number, y: number, headRight: number, onLine: boolean): void {
  const sp = art.sp
  const dotY = onLine ? y - sp / 2 : y
  for (let k = 0; k < item.dots; k++) art.glyph(x + headRight * sp + (0.35 + k * DOT_ADVANCE) * sp, dotY, [AUGMENTATION_DOT])
}

function drawMarks(art: StaffArt, item: Item, x: number): void {
  const event = item.event
  if (!event || !item.leading) return
  const sp = art.sp
  const width = item.pitch ? headWidth(item.duration) : restWidth(item.duration)
  if (event.dynamic) {
    const above = event.dynamicPlacement === 'above'
    art.dynamics.push({ x: x + (width * sp) / 2, text: glyphRef(dynamicCodes(event.dynamic)), above })
    if (above) art.dynamicAbove = true
    else art.dynamicBelow = true
  }
  if (event.text) {
    const runs = textRuns(event.text)
    if (runs.length > 0) {
      art.texts.push({ x, runs })
      art.textLines = Math.max(art.textLines, 1 + runs.filter((run) => run.breakBefore).length)
    }
  }
}

function drawHead(art: StaffArt, item: Item, x: number, y: number): void {
  const sp = art.sp
  const width = headWidth(item.duration)
  art.glyph(x, y, [headCode(item.duration)], eventAttrs(item))
  art.reach(y - sp / 2)
  art.reach(y + sp / 2)
  const below = item.pos < 0
  if (below || item.pos > 8) {
    const evenPos = item.pos % 2 === 0
    const farthest = below ? (evenPos ? item.pos : item.pos + 1) : evenPos ? item.pos : item.pos - 1
    for (let p = below ? -2 : 10; below ? p >= farthest : p <= farthest; p += below ? -2 : 2) {
      const ly = yOfPos(p, sp)
      art.ledgers.push({ x1: x - LEDGER_EXTENSION * sp, y1: ly, x2: x + (width + LEDGER_EXTENSION) * sp, y2: ly })
      art.reach(ly)
    }
  }
  if (item.accidental !== null) {
    const accidentalX = x - item.shift * sp - (0.3 + accidentalWidth(item.accidental) + item.accidentalShift) * sp
    art.glyph(accidentalX, y, [accidentalCode(item.accidental)])
  }
  drawDots(art, item, x, y, width, item.pos % 2 === 0)
  drawMarks(art, item, x)
}

function drawTies(art: StaffArt, env: Env, item: Item, x: number, y: number, up: boolean, both: boolean): void {
  const sp = art.sp
  const dir: 1 | -1 = both ? (item.voice === 1 ? -1 : 1) : up ? 1 : -1
  const width = headWidth(item.duration)
  const dotsReach = item.dots > 0 ? 0.35 + item.dots * DOT_ADVANCE : 0
  const reachY = y + dir * 0.35 * sp
  const target = item.tieOut
  if (target) {
    const lastMeasure = env.first + env.layouts.length - 1
    const x1 = x + (width + dotsReach + 0.15) * sp
    if (target.measure <= lastMeasure) {
      const j = target.measure - env.first
      const targetX = headX(env, j, target)
      const lead = target.accidental === null ? 0 : accidentalWidth(target.accidental) + 0.35 + target.accidentalShift
      const x2 = targetX - (lead + 0.15) * sp
      if (x2 > x1 + 0.3 * sp) art.ties.push({ x1, y1: reachY, x2, y2: yOfPos(target.pos, sp) + dir * 0.35 * sp, dir })
    } else {
      const x2 = Math.min(env.endX - 0.25 * sp, x1 + 4 * sp)
      if (x2 > x1 + 0.3 * sp) art.ties.push({ x1, y1: reachY, x2, y2: reachY, dir })
    }
  }
  if (item.tieFromMeasure > 0 && item.tieFromMeasure < env.first) {
    const lead = item.accidental === null ? 0 : accidentalWidth(item.accidental) + 0.35 + item.accidentalShift
    const x2 = x - item.shift * sp - (lead + 0.15) * sp
    const x1 = Math.max(env.startX + (at(env.layouts, 0).signatureWidth + 0.2) * sp, x2 - 3.5 * sp)
    if (x2 > x1 + 0.3 * sp) art.ties.push({ x1, y1: reachY, x2, y2: reachY, dir })
  }
}

function stemGeometry(art: StaffArt, x: number, y: number, up: boolean): { stemX: number; startY: number } {
  const sp = art.sp
  return {
    stemX: up ? x + STEM_UP_X * sp - (STEM_THICKNESS * sp) / 2 : x + (STEM_THICKNESS * sp) / 2,
    startY: up ? y - STEM_ATTACH_Y * sp : y + STEM_ATTACH_Y * sp,
  }
}

function drawNote(art: StaffArt, env: Env, i: number, item: Item, voice: 1 | 2, both: boolean): void {
  const sp = art.sp
  const x = headX(env, i, item)
  const y = yOfPos(item.pos, sp)
  const up = stemDirection(item, voice, both)
  drawHead(art, item, x, y)
  if (item.duration !== 'whole') {
    const flags = flagCount(item.duration)
    const extra = flags > 1 ? (flags - 1) * 0.5 * sp : 0
    const { stemX, startY } = stemGeometry(art, x, y, up)
    const tip = up ? Math.min(y - 3.5 * sp - extra, 2 * sp) : Math.max(y + 3.5 * sp + extra, 2 * sp)
    art.stems.push({ x1: stemX, y1: startY, x2: stemX, y2: tip })
    art.reach(tip)
    if (flags > 0) {
      const flag = flagGlyph(flags, up)
      art.glyph(stemX - (STEM_THICKNESS * sp) / 2, tip + flag.anchor * sp, [flag.code])
      art.reach(up ? tip - 0.2 * sp : tip + 0.2 * sp)
    }
  }
  drawTies(art, env, item, x, y, up, both)
}

function beamLevels(item: Item): number {
  return flagCount(item.duration)
}

function groupDirection(group: readonly Item[], voice: 1 | 2, both: boolean): boolean {
  if (both) return voice === 1
  let farthest = at(group, 0)
  for (const item of group) if (Math.abs(item.pos - 4) > Math.abs(farthest.pos - 4)) farthest = item
  return farthest.pos < 4
}

function drawBeamed(art: StaffArt, env: Env, i: number, group: readonly Item[], voice: 1 | 2, both: boolean): void {
  const sp = art.sp
  const up = groupDirection(group, voice, both)
  const xs = group.map((item) => headX(env, i, item))
  const ys = group.map((item) => yOfPos(item.pos, sp))
  const stems = group.map((_, k) => stemGeometry(art, at(xs, k), at(ys, k), up))
  const stemXs = stems.map((s) => s.stemX)
  const firstX = at(stemXs, 0)
  const lastX = at(stemXs, stemXs.length - 1)
  const span = Math.max(lastX - firstX, 1)
  const deepest = Math.max(...group.map(beamLevels))
  const slope = Math.max(-sp, Math.min(sp, 0.5 * (at(ys, ys.length - 1) - at(ys, 0))))
  const minimum = 3.3 * sp + (deepest - 1) * BEAM_PITCH * sp
  let origin = up ? Infinity : -Infinity
  group.forEach((_, k) => {
    const along = (at(stemXs, k) - firstX) / span
    const y = at(ys, k)
    if (up) origin = Math.min(origin, y - Math.max(minimum, y - 2 * sp) - slope * along)
    else origin = Math.max(origin, y + Math.max(minimum, 2 * sp - y) - slope * along)
  })
  const lineAt = (x: number): number => origin + (slope * (x - firstX)) / span
  const inward: 1 | -1 = up ? 1 : -1
  const half = (STEM_THICKNESS * sp) / 2
  group.forEach((item, k) => {
    const x = at(xs, k)
    drawHead(art, item, x, at(ys, k))
    const stem = at(stems, k)
    art.stems.push({ x1: stem.stemX, y1: stem.startY, x2: stem.stemX, y2: lineAt(stem.stemX) })
    drawTies(art, env, item, x, at(ys, k), up, both)
  })
  art.reach(lineAt(firstX))
  art.reach(lineAt(lastX))
  art.reach(lineAt(firstX) + inward * BEAM_THICKNESS * sp)
  art.reach(lineAt(lastX) + inward * BEAM_THICKNESS * sp)
  for (let level = 1; level <= deepest; level++) {
    const offset = inward * (level - 1) * BEAM_PITCH * sp
    let k = 0
    while (k < group.length) {
      if (beamLevels(at(group, k)) < level) {
        k++
        continue
      }
      let end = k
      while (end + 1 < group.length && beamLevels(at(group, end + 1)) >= level) end++
      let x1 = at(stemXs, k) - half
      let x2 = at(stemXs, end) + half
      if (end === k && level > 1) {
        if (k === 0) x2 = x1 + 1.3 * sp
        else x1 = x2 - 1.3 * sp
      }
      art.beams.push({ x1, y1: lineAt(x1) + offset, x2, y2: lineAt(x2) + offset, inward })
      k = end + 1
    }
  }
}

function restY(item: Item, sp: number, voice: 1 | 2, both: boolean): number {
  const base = item.duration === 'whole' ? sp : 2 * sp
  return base + (both ? (voice === 1 ? -sp : sp) : 0)
}

function drawRest(art: StaffArt, env: Env, i: number, item: Item, voice: 1 | 2, both: boolean): void {
  const sp = art.sp
  const y = restY(item, sp, voice, both)
  const layout = at(env.layouts, i)
  const width = restWidth(item.duration)
  const x = item.fullMeasure
    ? centreOf(env, i) - (restWidth('whole') * sp) / 2
    : at(env.left, i) + (layout.heads[layout.columnOf.get(item.tick) ?? 0] ?? 0) * sp * env.stretch
  art.glyph(x, y, [restCode(item.fullMeasure ? 'whole' : item.duration)], eventAttrs(item))
  if (!item.fullMeasure) drawDots(art, item, x, y, width, false)
  drawMarks(art, item, x)
}

function centreOf(env: Env, i: number): number {
  const sp = env.sp
  const offset = at(env.layouts, i).signatureWidth * sp
  return at(env.left, i) + offset + (at(env.widths, i) - offset) / 2
}

function drawVoice(art: StaffArt, env: Env, i: number, items: readonly Item[], voice: 1 | 2, both: boolean): void {
  const groupTicks = at(env.groupTicks, i)
  let group: Item[] = []
  const flush = (): void => {
    if (group.length > 1) drawBeamed(art, env, i, group, voice, both)
    else if (group.length === 1) drawNote(art, env, i, at(group, 0), voice, both)
    group = []
  }
  for (const item of items) {
    if (item.pitch === null) {
      flush()
      drawRest(art, env, i, item, voice, both)
    } else if (flagCount(item.duration) === 0) {
      flush()
      drawNote(art, env, i, item, voice, both)
    } else {
      const first = group[0]
      if (first && Math.floor(first.tick / groupTicks) !== Math.floor(item.tick / groupTicks)) flush()
      group.push(item)
    }
  }
  flush()
}

/** Draws one measure of one staff: both voices, and the whole-measure rest when voice 1 is empty. */
export function drawStaffMeasure(art: StaffArt, env: Env, i: number, cell: Cell | undefined): void {
  const upper = cell ? cell.voices[0] : []
  const lower = cell ? cell.voices[1] : []
  const both = lower.length > 0
  if (upper.length === 0) {
    const sp = art.sp
    const y = sp + (both ? -sp : 0)
    art.glyph(centreOf(env, i) - (restWidth('whole') * sp) / 2, y, [restCode('whole')])
  }
  drawVoice(art, env, i, upper, 1, both)
  drawVoice(art, env, i, lower, 2, both)
}
