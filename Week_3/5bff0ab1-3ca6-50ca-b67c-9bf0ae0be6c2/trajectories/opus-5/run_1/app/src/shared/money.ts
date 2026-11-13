/** Money is integer paise everywhere; this is the only place amounts become text. */
export function formatPaise(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const digits = String(rupees);
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const pairs: string[] = [];
    while (rest.length > 2) {
      pairs.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) pairs.unshift(rest);
    grouped = `${pairs.join(',')},${last3}`;
  }
  const decimals = fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`;
  return `${negative ? '-' : ''}\u20b9${grouped}${decimals}`;
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
