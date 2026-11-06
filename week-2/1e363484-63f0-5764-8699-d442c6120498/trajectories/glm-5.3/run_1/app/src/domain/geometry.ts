/** Polygon helpers for coverage geometry. One place owns area allocation. */

import PolyBool from 'polybooljs'

export type Point = [number, number]
export type Polygon = Point[]
export type Pt = { x: number; y: number }

/** Area of a simple polygon (m^2). */
export function polygonArea(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s / 2)
}

type PolyBoolShape = { regions: number[][][] }

function toShape(poly: Polygon): PolyBoolShape {
  return { regions: [poly.map(([x, y]) => [x, y])] }
}

function shapeArea(shape: PolyBoolShape): number {
  let s = 0
  for (const region of shape.regions) {
    for (let i = 0; i < region.length; i++) {
      const [x1, y1] = region[i]!
      const [x2, y2] = region[(i + 1) % region.length]!
      s += x1 * y2 - x2 * y1
    }
  }
  return Math.abs(s / 2)
}

/** Area of a polygon clipped inside another polygon (m^2). */
export function intersectionArea(subject: Polygon, clip: Polygon): number {
  return shapeArea(PolyBool.intersect(toShape(subject), toShape(clip)))
}

/**
 * Allocate each polygon's area inside the boundary minus ground already
 * allocated to an earlier polygon. Earlier polygons take precedence, and no
 * ground is counted twice. Returns integer m^2 per polygon.
 */
export function allocateAreas(boundary: Polygon, polys: Polygon[]): number[] {
  const allocated: number[] = []
  let union: PolyBoolShape = { regions: [] }
  for (const poly of polys) {
    const inside = PolyBool.intersect(toShape(poly), toShape(boundary))
    const free = PolyBool.difference(inside, union)
    const area = shapeArea(free)
    allocated.push(Math.round(area))
    union = PolyBool.union(union, inside)
  }
  return allocated
}
