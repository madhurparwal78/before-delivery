/** The cycle name rule: the one place a name is trimmed and judged. */
export function normalizeCycleName(raw: string): string {
  return raw.replace(/^\s+/u, '').replace(/\s+$/u, '');
}

export function cycleNameIsValid(name: string): boolean {
  const codePoints = [...name];
  if (codePoints.length < 1 || codePoints.length > 60) return false;
  for (const codePoint of codePoints) {
    const value = codePoint.codePointAt(0) ?? 0;
    if (value <= 0x1f) return false;
    if (value >= 0x7f && value <= 0x9f) return false;
  }
  return true;
}
