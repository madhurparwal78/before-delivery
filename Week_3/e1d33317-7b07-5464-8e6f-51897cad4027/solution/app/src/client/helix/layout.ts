// Geometry of the drum (how the systems are wound) and of the portrait part page (where strips settle).

export const DRUM_RADIUS = 1
const TARGET_HEIGHT_TO_DIAMETER = 1.3
const MAX_COLUMNS = 8

interface DrumCell {
  /** Angle of the cell's centre about the drum axis, before the drum turns. */
  yaw: number
  /** World y of the cell's top edge. */
  top: number
}

export interface DrumLayout {
  columns: number
  rows: number
  /** Arc length of one cell at the drum radius. */
  cellWidth: number
  cellHeight: number
  height: number
  cells: DrumCell[]
}

/**
 * Systems are wound onto the drum in order, `columns` to a turn and one row below the next, edge to edge.
 * The column count is chosen so the drum stands about as tall as the target while each system keeps its own aspect
 * and few cells stay empty.
 */
export function layoutDrum(systemCount: number, aspect: number): DrumLayout {
  const count = Math.max(1, systemCount)
  const circumference = 2 * Math.PI * DRUM_RADIUS
  let columns = 1
  let bestScore = Number.POSITIVE_INFINITY
  for (let k = 1; k <= Math.min(MAX_COLUMNS, count); k++) {
    const rows = Math.ceil(count / k)
    const height = rows * (circumference / k / aspect)
    const empty = (rows * k - count) / (rows * k)
    const score = Math.abs(Math.log(height / (2 * DRUM_RADIUS) / TARGET_HEIGHT_TO_DIAMETER)) + 2 * empty
    if (score < bestScore - 1e-9) {
      bestScore = score
      columns = k
    }
  }
  const rows = Math.ceil(count / columns)
  const cellWidth = circumference / columns
  const cellHeight = cellWidth / aspect
  const height = rows * cellHeight
  const cells: DrumCell[] = []
  for (let i = 0; i < rows * columns; i++) {
    cells.push({
      yaw: ((i % columns) + 0.5) * ((2 * Math.PI) / columns),
      top: height / 2 - Math.floor(i / columns) * cellHeight,
    })
  }
  return { columns, rows, cellWidth, cellHeight, height, cells }
}

/** The part page in the server's own units: 9 by 12 inches at 96 dpi with systems between the margins. */
export const SHEET = {
  width: 864,
  height: 1152,
  margin: 54,
  systemsTop: 96,
  systemsBottom: 1088,
  systemWidth: 756,
} as const

export const SHEET_ASPECT = SHEET.width / SHEET.height

/** Where the server stacks the systems of a page: one slot each, ten to a page for one staff, five for two. */
export function sheetPitch(systemCount: number, staffCount: number): number {
  const capacity = Math.max(systemCount, staffCount > 1 ? 5 : 10)
  return (SHEET.systemsBottom - SHEET.systemsTop) / capacity
}

/** A strip's band height and the width of the system it was cut from, both in that system's viewBox units. */
interface StripSize {
  bandHeight: number
  systemWidth: number
}

export interface RestRect {
  /** Centre on the sheet, in sheet units measured from the sheet's centre (y up). */
  cx: number
  cy: number
  width: number
  height: number
}

/**
 * Settled positions of the lifted strips, top to bottom in score order. Each strip is a full system
 * width at its natural height; strips share the page evenly when there are more than fit.
 */
export function restRects(bands: readonly StripSize[], pitch: number): RestRect[] {
  const region = SHEET.systemsBottom - SHEET.systemsTop
  const step = Math.min(pitch, region / Math.max(1, bands.length))
  return bands.map(({ bandHeight, systemWidth }, i) => {
    const natural = bandHeight * (SHEET.systemWidth / systemWidth)
    const height = Math.min(natural, step * 0.96)
    const width = (height / natural) * SHEET.systemWidth
    const top = SHEET.systemsTop + i * step
    return {
      cx: SHEET.margin + SHEET.systemWidth / 2 - SHEET.width / 2,
      cy: SHEET.height / 2 - (top + height / 2),
      width,
      height,
    }
  })
}
