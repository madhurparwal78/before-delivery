const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

/** The decimal a text holds after trimming, or null when it is not a plain finite decimal. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Numbers compare as numbers when both sides parse as numbers; everything else compares as case-sensitive text. */
export function compare(left: string, operator: string, right: string): boolean {
  switch (operator) {
    case 'is empty':
      return left.trim() === '';
    case 'is not empty':
      return left.trim() !== '';
    case 'contains':
      return left.includes(right);
    case 'equals':
    case 'not equals':
    case 'greater than':
    case 'less than': {
      const a = parseDecimal(left);
      const b = parseDecimal(right);
      const numeric = a !== null && b !== null;
      const [x, y] = numeric ? [a, b] : [left, right];
      if (operator === 'equals') return x === y;
      if (operator === 'not equals') return x !== y;
      return operator === 'greater than' ? x > y : x < y;
    }
    default:
      return false;
  }
}
