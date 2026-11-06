/** Every length limit in Tallyroom counts Unicode code points. */
export function codePointLength(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

/** Text holding U+0000 or an unpaired surrogate cannot be stored as submitted. */
export function isStorableText(value: string): boolean {
  if (value.includes('\u0000')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}
