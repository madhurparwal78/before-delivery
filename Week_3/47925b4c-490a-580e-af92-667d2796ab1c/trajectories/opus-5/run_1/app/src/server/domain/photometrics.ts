import { CELL_METRES } from './cells.js';
import { type Band, bandOf, BANDS } from './catalogue.js';
import { oneDecimal } from './format.js';
import { round4, roundWholeHalfEven } from './round.js';

export const AMBIENT_FLOOR_LUX = 0.1;
export const PI = 3.141592653589793;
export const BLEND_GAMMA = 2.2;
export const OBLIQUITY_LIMIT_DEGREES = 25;

export interface PlacementOptics {
  readonly id: string;
  readonly ordinal: number;
  readonly aimAcross: number;
  readonly aimDown: number;
  readonly bodyAcross: number;
  readonly bodyDown: number;
  readonly standoff: number;
  readonly ratio: number;
  readonly shiftAcrossPercent: number;
  readonly shiftDownPercent: number;
  readonly effectiveLumens: number;
  readonly nativeWidthPx: number;
  readonly nativeHeightPx: number;
}

export interface Projection {
  readonly throwMetres: number;
  readonly obliquityDegrees: number;
  readonly imageWidthMetres: number;
  readonly imageHeightMetres: number;
  readonly centreAcross: number;
  readonly centreDown: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function projectionOf(placement: PlacementOptics): Projection {
  const across = placement.bodyAcross - placement.aimAcross;
  const down = placement.bodyDown - placement.aimDown;
  const throwMetres = Math.sqrt(across * across + down * down + placement.standoff * placement.standoff);
  const obliquityDegrees = (Math.acos(placement.standoff / throwMetres) * 180) / PI;
  const imageWidthMetres = throwMetres / placement.ratio;
  const imageHeightMetres = (imageWidthMetres * placement.nativeHeightPx) / placement.nativeWidthPx;
  const centreAcross = placement.aimAcross + (placement.shiftAcrossPercent / 100) * imageWidthMetres;
  const centreDown = placement.aimDown + (placement.shiftDownPercent / 100) * imageHeightMetres;
  return {
    throwMetres,
    obliquityDegrees,
    imageWidthMetres,
    imageHeightMetres,
    centreAcross,
    centreDown,
    left: centreAcross - imageWidthMetres / 2,
    right: centreAcross + imageWidthMetres / 2,
    top: centreDown - imageHeightMetres / 2,
    bottom: centreDown + imageHeightMetres / 2,
  };
}

export function covers(projection: Projection, across: number, down: number): boolean {
  return across >= projection.left && across < projection.right && down >= projection.top && down < projection.bottom;
}

/**
 * The linear light share of `placement` at a point also covered by `other`:
 * complementary and linear across the overlap, the left-hand image keeping 1 − t.
 */
export function blendShare(
  placement: PlacementOptics,
  projection: Projection,
  other: PlacementOptics,
  otherProjection: Projection,
  across: number,
): number {
  const overlapLeft = Math.max(projection.left, otherProjection.left);
  const overlapWidth = Math.min(projection.right, otherProjection.right) - overlapLeft;
  if (overlapWidth <= 0) return 1;
  const t = (across - overlapLeft) / overlapWidth;
  const leftmost =
    projection.centreAcross < otherProjection.centreAcross ||
    (projection.centreAcross === otherProjection.centreAcross && placement.ordinal <= other.ordinal);
  return leftmost ? 1 - t : t;
}

export function maskSignal(share: number): number {
  return Math.pow(share, 1 / BLEND_GAMMA);
}

export interface Contribution {
  readonly placementId: string;
  readonly effectiveLumens: number;
  readonly throwMetres: number;
  readonly obliquityDegrees: number;
  readonly share: number;
  readonly lux: number;
}

export interface CellLight {
  readonly ambientLux: string | null;
  readonly projectedLux: number | null;
  readonly totalLux: number | null;
  readonly luminanceCdM2: number | null;
  readonly contrast: number | null;
  readonly contrastText: string | null;
  readonly band: Band;
  readonly pixelsPerMetre: number;
  readonly blended: boolean;
  readonly litLevel: number | null;
  readonly hatched: boolean;
  readonly contributions: readonly Contribution[];
}

export interface CellGround {
  readonly across: number;
  readonly down: number;
  readonly reflectance: number;
  readonly recessMetres: number;
  readonly ambientLux: string | null;
}

interface Lit {
  readonly placement: PlacementOptics;
  readonly projection: Projection;
}

function luxAt(lit: Lit, ground: CellGround, share: number): number {
  const spread = lit.placement.effectiveLumens / (lit.projection.imageWidthMetres * lit.projection.imageHeightMetres);
  const across = lit.placement.bodyAcross - ground.across;
  const down = lit.placement.bodyDown - ground.down;
  const depth = lit.placement.standoff + ground.recessMetres;
  const distance = Math.sqrt(across * across + down * down + depth * depth);
  const sideways = Math.sqrt(across * across + down * down);
  const cosine = depth / distance;
  const recessShare = Math.max(0, 1 - (ground.recessMetres * (sideways / depth)) / CELL_METRES);
  const fall = (lit.projection.throwMetres * lit.projection.throwMetres) / (distance * distance);
  return spread * fall * cosine * recessShare * share;
}

/** Every photometric figure for one cell, decided here and nowhere else. */
export function lightCell(ground: CellGround, placements: readonly PlacementOptics[]): CellLight {
  const lit: Lit[] = [];
  for (const placement of placements) {
    const projection = projectionOf(placement);
    if (covers(projection, ground.across, ground.down)) lit.push({ placement, projection });
  }
  lit.sort((left, right) => left.placement.ordinal - right.placement.ordinal);
  const blended = lit.length > 1;
  const contributions: Contribution[] = [];
  let projected = 0;
  let pixelsPerMetre = 0;
  for (const [index, entry] of lit.entries()) {
    const other = blended ? (lit[index === 0 ? 1 : 0] as Lit) : null;
    const share =
      other === null
        ? 1
        : blendShare(entry.placement, entry.projection, other.placement, other.projection, ground.across);
    const lux = luxAt(entry, ground, share);
    projected += lux;
    contributions.push({
      placementId: entry.placement.id,
      effectiveLumens: round4(entry.placement.effectiveLumens),
      throwMetres: round4(entry.projection.throwMetres),
      obliquityDegrees: round4(entry.projection.obliquityDegrees),
      share: round4(share),
      lux: round4(lux),
    });
    const density = roundWholeHalfEven(entry.placement.nativeWidthPx / entry.projection.imageWidthMetres);
    pixelsPerMetre = index === 0 ? density : Math.min(pixelsPerMetre, density);
  }

  if (ground.ambientLux === null) {
    return {
      ambientLux: null,
      projectedLux: null,
      totalLux: null,
      luminanceCdM2: null,
      contrast: null,
      contrastText: null,
      band: BANDS.none,
      pixelsPerMetre,
      blended,
      litLevel: null,
      hatched: false,
      contributions,
    };
  }

  const ambient = Math.max(Number(ground.ambientLux), AMBIENT_FLOOR_LUX);
  const total = projected + ambient;
  const contrast = total / ambient;
  const band = bandOf(contrast);
  return {
    ambientLux: ground.ambientLux,
    projectedLux: round4(projected),
    totalLux: round4(total),
    luminanceCdM2: round4((total * ground.reflectance) / PI),
    contrast: round4(contrast),
    contrastText: `${oneDecimal(contrast)} to 1`,
    band,
    pixelsPerMetre,
    blended,
    litLevel: round4(1 - 1 / contrast),
    hatched: band === BANDS.washedOut,
    contributions,
  };
}
