/**
 * Code shapes: batch-, notice- and SKU-shaped queries are whole matches against
 * Postgres with no typos; anything else goes to the index.
 */

export function isBatchShaped(q: string): boolean {
  return /^[A-Za-z]+-\d{6}-\d{1,4}$/.test(q.trim());
}

export function isSkuShaped(q: string): boolean {
  return /^[A-Za-z]+-\d+-[A-Za-z]+$/.test(q.trim());
}

export function isNoticeShaped(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z]+-\d+-\d+$/.test(t) && !isBatchShaped(t);
}

export type CodeShape = 'batch' | 'notice' | 'sku' | 'none';

export function noticeShapes(q: string): CodeShape {
  const t = q.trim();
  if (isBatchShaped(t)) return 'batch';
  if (isSkuShaped(t)) return 'sku';
  if (isNoticeShaped(t)) return 'notice';
  return 'none';
}

/** `<plant>-<YYMMDD>-<line>`: 2 to 12 uppercase letters, a real 2000s date, 1 to 4 digits, at most 24 characters. */
export function isValidBatchCode(code: string): boolean {
  if (code.length > 24) return false;
  const m = /^([A-Z]{2,12})-(\d{6})-(\d{1,4})$/.exec(code);
  if (!m) return false;
  const y = 2000 + Number(m[2].slice(0, 2));
  const mo = Number(m[2].slice(2, 4));
  const d = Number(m[2].slice(4, 6));
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (mo === 2) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (d > (leap ? 29 : 28)) return false;
  }
  if ([4, 6, 9, 11].includes(mo) && d > 30) return false;
  return true;
}
