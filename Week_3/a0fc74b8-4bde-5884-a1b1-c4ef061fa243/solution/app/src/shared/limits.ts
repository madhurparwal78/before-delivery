export const TITLE_LIMIT = 120;
export const LABEL_LIMIT = 40;
export const NAME_LIMIT = 100;
export const SIGNER_LIMIT = 10;
export const TEXT_LIMIT = 200;
export const TYPED_LIMIT = 100;
export const REASON_LIMIT = 500;
export const STROKE_POINT_LIMIT = 5000;
export const SIGNATURE_PAD_ASPECT = 2.2;

export function codePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function truncateCodePoints(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join("");
}
