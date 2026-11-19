import type { Hand, PieceBody, Piece, Point } from './domain'

// The one place where piece geometry is decided. Coordinates are millimetres on the hall floor:
// x runs east, y north, heading is degrees counter-clockwise from east.

const RADIANS = Math.PI / 180

function normalizeHeading(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360
  return Math.round(wrapped * 100) / 100
}

function turnoutAngleDeg(frogNumber: number): number {
  return Math.round(2 * Math.atan(1 / (2 * frogNumber)) / RADIANS * 100) / 100
}

function curveLengthMm(radiusMm: number, angleDeg: number): number {
  return Math.round(radiusMm * angleDeg * RADIANS)
}

export function pieceLengthMm(body: PieceBody): number {
  return body.kind === 'curve' ? curveLengthMm(body.radius_mm, body.angle_deg) : body.length_mm
}

// A curve turns about a centre to the left (+1) or the right (-1) of its start; the same centre serves its end and its samples.
const turnSign = (hand: Hand): 1 | -1 => (hand === 'left' ? 1 : -1)

function curveCentre(start: Point, hand: Hand, radiusMm: number): { x: number; y: number } {
  const h = start.heading_deg * RADIANS
  return { x: start.x_mm - turnSign(hand) * radiusMm * Math.sin(h), y: start.y_mm + turnSign(hand) * radiusMm * Math.cos(h) }
}

function onArc(centre: { x: number; y: number }, hand: Hand, radiusMm: number, headingRad: number): { x: number; y: number } {
  return { x: centre.x + turnSign(hand) * radiusMm * Math.sin(headingRad), y: centre.y - turnSign(hand) * radiusMm * Math.cos(headingRad) }
}

function turn(start: Point, hand: Hand, radiusMm: number, angleDeg: number, rise: number): Point {
  const sign = turnSign(hand)
  const arrival = onArc(curveCentre(start, hand, radiusMm), hand, radiusMm, start.heading_deg * RADIANS + sign * angleDeg * RADIANS)
  return {
    x_mm: Math.round(arrival.x),
    y_mm: Math.round(arrival.y),
    elevation_mm: start.elevation_mm + rise,
    heading_deg: normalizeHeading(start.heading_deg + sign * angleDeg),
  }
}

function run(start: Point, lengthMm: number, bearingDeg: number, headingDeg: number, rise: number): Point {
  const b = bearingDeg * RADIANS
  return {
    x_mm: Math.round(start.x_mm + lengthMm * Math.cos(b)),
    y_mm: Math.round(start.y_mm + lengthMm * Math.sin(b)),
    elevation_mm: start.elevation_mm + rise,
    heading_deg: normalizeHeading(headingDeg),
  }
}

interface PieceEnds {
  length_mm: number
  end: Point
  diverging_end: Point | null
}

export function pieceEnds(start: Point, body: PieceBody): PieceEnds {
  if (body.kind === 'straight') {
    return { length_mm: pieceLengthMm(body), end: run(start, body.length_mm, start.heading_deg, start.heading_deg, body.rise_mm), diverging_end: null }
  }
  if (body.kind === 'curve') {
    return { length_mm: pieceLengthMm(body), end: turn(start, body.hand, body.radius_mm, body.angle_deg, body.rise_mm), diverging_end: null }
  }
  const sign = turnSign(body.hand)
  const angle = turnoutAngleDeg(body.frog_number)
  return {
    length_mm: pieceLengthMm(body),
    end: run(start, body.length_mm, start.heading_deg, start.heading_deg, body.rise_mm),
    diverging_end: run(start, body.length_mm, start.heading_deg + (sign * angle) / 2, start.heading_deg + sign * angle, body.rise_mm),
  }
}

export interface PathPoint { x_mm: number; y_mm: number; elevation_mm: number }

// Points along a stored piece from its start to its end, for drawing and for block paths.
export function samplePiece(piece: Piece, curveSteps = 4): PathPoint[] {
  const { start, end } = piece
  if (piece.kind !== 'curve') {
    return [start, end].map(p => ({ x_mm: p.x_mm, y_mm: p.y_mm, elevation_mm: p.elevation_mm }))
  }
  const centre = curveCentre(start, piece.hand, piece.radius_mm)
  const points: PathPoint[] = []
  for (let i = 0; i <= curveSteps; i += 1) {
    const t = i / curveSteps
    const at = onArc(centre, piece.hand, piece.radius_mm, (start.heading_deg + turnSign(piece.hand) * piece.angle_deg * t) * RADIANS)
    points.push({
      x_mm: at.x,
      y_mm: at.y,
      elevation_mm: start.elevation_mm + (end.elevation_mm - start.elevation_mm) * t,
    })
  }
  return points
}
