// Money is integer paise throughout. All rounding is half-up, applied once per value.

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

export function divRound(numerator: number, denominator: number): number {
  return Math.floor(numerator / denominator + 0.5);
}

export function pct(amountPaise: number, percent: number): number {
  return roundHalfUp((amountPaise * percent) / 100);
}

export function taxSplit(lineTotalPaise: number, gstRate: number, intraState: boolean): {
  taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number;
} {
  const taxable = divRound((lineTotalPaise * 100), (100 + gstRate));
  const tax = lineTotalPaise - taxable;
  if (!intraState) {
    return { taxableValuePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
  }
  const sgst = Math.floor(tax / 2);
  const cgst = tax - sgst;
  return { taxableValuePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0 };
}

/** Largest-remainder allocation of `total` across `weights`, tie-broken by earlier order. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0) {
    const even = Math.floor(total / weights.length);
    const parts = weights.map(() => even);
    for (let i = 0; i < total - even * weights.length; i++) parts[i] += 1;
    return parts;
  }
  const exact = weights.map((w) => (total * w) / sum);
  const base = exact.map(Math.floor);
  let leftover = total - base.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < order.length && leftover > 0; k++, leftover--) {
    base[order[k].i] += 1;
  }
  return base;
}
