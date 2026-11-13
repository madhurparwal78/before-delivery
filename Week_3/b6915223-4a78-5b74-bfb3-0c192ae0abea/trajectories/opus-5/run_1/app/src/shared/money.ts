export const BUDGET_TENTHS = 1000;

/** Millions with one decimal, from whole tenths. */
export const formatMillions = (tenths: number): string => {
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  return `${sign}${Math.trunc(abs / 10)}.${abs % 10}`;
};

/** Parses millions with one decimal into whole tenths. Returns null when malformed. */
export const parseMillions = (text: string): number | null => {
  if (!/^-?\d+(\.\d)?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole, decimal] = text.replace('-', '').split('.');
  const tenths = Number(whole) * 10 + Number(decimal ?? '0');
  return negative ? -tenths : tenths;
};

/**
 * Selling price in whole tenths: purchase price plus half of any rise rounded
 * down to a tenth, or the current price when the price has not risen.
 */
export const sellingPriceTenths = (purchaseTenths: number, currentTenths: number): number => {
  if (currentTenths <= purchaseTenths) return currentTenths;
  return purchaseTenths + Math.floor((currentTenths - purchaseTenths) / 2);
};
