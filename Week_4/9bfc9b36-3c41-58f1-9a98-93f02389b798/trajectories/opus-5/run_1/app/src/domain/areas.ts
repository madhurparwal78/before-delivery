import { roundHalfAway, squareFeet, squareMetres } from '../shared/units';

/** The one place that computes a sail area and writes its basis. */

export type SailKind = 'mainsail' | 'headsail';

export interface AreaView {
  readonly area_mm2: number;
  readonly area_m2: string;
  readonly area_ft2: string;
  readonly basis: string;
}

function roachToThreeDecimals(roachPermille: number): string {
  const whole = Math.trunc(roachPermille / 1000);
  const fraction = roachPermille % 1000;
  return `${whole}.${fraction.toString().padStart(3, '0')}`;
}

export function foretriangleArea(iMm: number, jMm: number): number {
  return roundHalfAway(BigInt(iMm) * BigInt(jMm), 2n);
}

export function mainsailArea(pMm: number, eMm: number, roachPermille: number): number {
  return roundHalfAway(BigInt(pMm) * BigInt(eMm) * BigInt(roachPermille), 2000n);
}

export function headsailArea(lpMm: number, llMm: number): number {
  return roundHalfAway(BigInt(lpMm) * BigInt(llMm), 2n);
}

function withBasis(areaMm2: number, basis: string): AreaView {
  return {
    area_mm2: areaMm2,
    area_m2: squareMetres(areaMm2),
    area_ft2: squareFeet(areaMm2),
    basis,
  };
}

export function foretriangleView(iMm: number, jMm: number, toleranceMm: number, version: number): AreaView {
  return withBasis(
    foretriangleArea(iMm, jMm),
    `I × J / 2 · tolerance ±${toleranceMm} mm · rule set v${version}`,
  );
}

export function mainsailView(
  pMm: number,
  eMm: number,
  roachPermille: number,
  toleranceMm: number,
  version: number,
): AreaView {
  return withBasis(
    mainsailArea(pMm, eMm, roachPermille),
    `P × E / 2 × ${roachToThreeDecimals(roachPermille)} · tolerance ±${toleranceMm} mm · rule set v${version}`,
  );
}

export function headsailView(
  lpMm: number,
  llMm: number,
  toleranceMm: number,
  version: number,
): AreaView {
  return withBasis(
    headsailArea(lpMm, llMm),
    `LP × LL / 2 · tolerance ±${toleranceMm} mm · rule set v${version}`,
  );
}

/** The formula part of a basis, as the cut sheet's sail-area line repeats it. */
export function basisFormula(basis: string): string {
  const marker = basis.indexOf(' · tolerance');
  return marker === -1 ? basis : basis.slice(0, marker);
}

/** A mainsail uses P and E; a headsail uses LP and LL. */
export function usedDimensions(sail: SailKind): readonly string[] {
  return sail === 'mainsail' ? ['P', 'E'] : ['LP', 'LL'];
}

/** `luff_mm` and `foot_mm` are P and E for a mainsail, LL and LP for a headsail. */
export function luffAndFoot(sail: SailKind, values: Readonly<Record<string, number>>): { luffMm: number; footMm: number } {
  return sail === 'mainsail'
    ? { luffMm: values['P'] as number, footMm: values['E'] as number }
    : { luffMm: values['LL'] as number, footMm: values['LP'] as number };
}

export function sailAreaView(
  sail: SailKind,
  values: Readonly<Record<string, number>>,
  roachPermille: number,
  toleranceMm: number,
  version: number,
): AreaView {
  return sail === 'mainsail'
    ? mainsailView(values['P'] as number, values['E'] as number, roachPermille, toleranceMm, version)
    : headsailView(values['LP'] as number, values['LL'] as number, toleranceMm, version);
}
