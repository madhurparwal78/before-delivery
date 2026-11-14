import { GRID_PX } from '../../shared/domain.ts'

export const ENTITY_WIDTH = 240
export const HEADER_HEIGHT = 32
export const ROW_HEIGHT = 24
const BOTTOM_PADDING = 8
const ELBOW = 28
const MARGIN = 24

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export function entityBox(x: number, y: number, rows: number): Box {
  return { x: x * GRID_PX, y: y * GRID_PX, width: ENTITY_WIDTH, height: HEADER_HEIGHT + rows * ROW_HEIGHT + BOTTOM_PADDING }
}

const rowY = (box: Box, row: number): number => box.y + HEADER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2

/** An orthogonal connector between two rows: leave one card sideways, run to the other, enter sideways. */
export function connector(from: { box: Box; row: number }, to: { box: Box; row: number }): string {
  const sy = rowY(from.box, from.row)
  const ty = rowY(to.box, to.row)
  const fromRight = from.box.x + from.box.width
  const toRight = to.box.x + to.box.width
  if (fromRight + ELBOW <= to.box.x) {
    const mid = (fromRight + to.box.x) / 2
    return `M ${fromRight} ${sy} H ${mid} V ${ty} H ${to.box.x}`
  }
  if (toRight + ELBOW <= from.box.x) {
    const mid = (toRight + from.box.x) / 2
    return `M ${from.box.x} ${sy} H ${mid} V ${ty} H ${toRight}`
  }
  const bend = Math.max(fromRight, toRight) + ELBOW
  return `M ${fromRight} ${sy} H ${bend} V ${ty} H ${toRight}`
}

/** The padded box around a group's members, with a header strip above it. */
export function groupBox(members: Box[]): Box {
  const left = Math.min(...members.map((box) => box.x)) - MARGIN
  const top = Math.min(...members.map((box) => box.y)) - MARGIN - 28
  const right = Math.max(...members.map((box) => box.x + box.width)) + MARGIN
  const bottom = Math.max(...members.map((box) => box.y + box.height)) + MARGIN
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
