/** All money arithmetic is integer paise. No price is ever computed in floating point. */

export interface UnitSalePrice {
  rupees: string;
  per: 'ml' | 'litre';
}

function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function formatRupees(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const fraction = Math.abs(paise % 100);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Rupees per millilitre under a litre, rupees per litre at a litre and over,
 * rounded half up to two decimals, and omitted when it equals the retail price.
 */
export function unitSalePrice(retailPricePaise: number, sizeMl: number): UnitSalePrice | null {
  const per: 'ml' | 'litre' = sizeMl < 1000 ? 'ml' : 'litre';
  const hundredths =
    per === 'ml' ? roundHalfUp(retailPricePaise, sizeMl) : roundHalfUp(retailPricePaise * 1000, sizeMl);
  if (hundredths === retailPricePaise) return null;
  return { rupees: formatRupees(hundredths), per };
}

export function sugarMgPerPack(sugarMgPer100Ml: number, sizeMl: number): number {
  return roundHalfUp(sugarMgPer100Ml * sizeMl, 100);
}

/** The sticker ceiling in exact integer paise. */
export function stickerCeilingPaise(oldMrpPaise: number, oldRate: number, newRate: number): number {
  return Math.floor((oldMrpPaise * (100 + newRate)) / (100 + oldRate));
}
