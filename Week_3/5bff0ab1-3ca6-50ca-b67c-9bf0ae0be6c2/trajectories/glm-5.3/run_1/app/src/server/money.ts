// Money is integer paise throughout and is never held in a float.
// Display uses Indian digit grouping and a rupee sign in every browser locale,
// with no decimals when the paise are zero and two decimals otherwise.

export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = groupIndian(String(rupees));
  const body = rem === 0 ? grouped : `${grouped}.${rem < 10 ? `0${rem}` : String(rem)}`;
  return `${neg ? "-" : ""}₹${body}`;
}

// Indian digit grouping: last three, then groups of two -> 2,65,211
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, digits.length - 3);
  const tail = digits.slice(-3);
  const groups: string[] = [];
  for (let i = head.length; i > 0; i -= 2) {
    groups.unshift(head.slice(Math.max(0, i - 2), i));
  }
  return [...groups, tail].join(",");
}

// Road tax is ex-showroom x percent, rounded half up to a whole paisa.
export function roadTaxPaise(exShowroomPaise: number, percent: number): number {
  const product = exShowroomPaise * percent;
  // half up to a whole paisa
  const quotient = product / 100;
  const floor = Math.floor(quotient);
  const frac = quotient - floor;
  return floor + (frac >= 0.5 ? 1 : 0);
}
