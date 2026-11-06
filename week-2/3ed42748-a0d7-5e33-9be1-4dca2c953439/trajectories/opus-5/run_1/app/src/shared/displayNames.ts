export const DISPLAY_NAME_MAX_CODE_POINTS = 24;

const FOLDABLE =
  /[\p{White_Space}\p{Cc}\p{Zl}\p{Zp}\u200E\u200F\u202A-\u202E\u2066-\u2069]+/gu;

export function hasLoneSurrogate(raw: string): boolean {
  for (let index = 0; index < raw.length; index += 1) {
    const unit = raw.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = raw.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Folds every run of white space and control characters into one space, trims and normalises. */
export function foldDisplayName(raw: string): string {
  return raw.replace(FOLDABLE, ' ').replace(/^ +| +$/g, '').normalize('NFC');
}

export function countCodePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export type DisplayNameFault = 'invalid' | 'required' | 'too_long';

export interface DisplayNameCheck {
  stored: string;
  fault: DisplayNameFault | null;
}

/** The one display-name check: lone surrogates, folding, trimming, NFC, then code points. */
export function checkDisplayName(raw: string): DisplayNameCheck {
  if (hasLoneSurrogate(raw)) return { stored: '', fault: 'invalid' };
  const stored = foldDisplayName(raw);
  const count = countCodePoints(stored);
  if (count === 0) return { stored, fault: 'required' };
  if (count > DISPLAY_NAME_MAX_CODE_POINTS) return { stored, fault: 'too_long' };
  return { stored, fault: null };
}
