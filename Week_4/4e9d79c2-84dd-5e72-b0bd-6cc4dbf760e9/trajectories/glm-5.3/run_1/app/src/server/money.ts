/** Money is held as integer pennies everywhere. */
export type Pennies = number;

export function parseMoneyToPennies(text: string): Pennies | null {
  const t = (text ?? "").toString().trim();
  const m = /^(?:(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2}))$/.exec(t) ?? /^(\d+)\.(\d{2})$/.exec(t);
  if (m) {
    const whole = m[1].replace(/,/g, "");
    const p = Number(whole) * 100 + Number(m[2]);
    return Number.isSafeInteger(p) ? p : null;
  }
  const w = /^(\d{1,3}(?:,\d{3})*|\d+)$/.exec(t);
  if (w) {
    const p = Number(w[1].replace(/,/g, "")) * 100;
    return Number.isSafeInteger(p) ? p : null;
  }
  const h = /^(\d+)[.,](\d)$/.exec(t);
  if (h) {
    const p = Number(h[1]) * 100 + Number(h[2]) * 10;
    return Number.isSafeInteger(p) ? p : null;
  }
  return null;
}

export function penniesToString(p: Pennies): string {
  const sign = p < 0 ? "-" : "";
  const a = Math.abs(p);
  return sign + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
}

export function pounds(p: Pennies): string {
  const sign = p < 0 ? "-£" : "£";
  const a = Math.abs(p);
  return sign + Math.floor(a / 100).toLocaleString("en-GB") + "." + String(a % 100).padStart(2, "0");
}

/** Divide `pennies` by `count`, half-up to a penny, earlier shares taking the extra pennies. */
export function splitEvenly(pennies: Pennies, count: number): Pennies[] {
  if (count <= 0) return [];
  const base = Math.floor(pennies / count);
  let rest = pennies - base * count;
  const out: Pennies[] = [];
  for (let i = 0; i < count; i++) {
    let x = base;
    if (pennies >= 0) {
      const take = Math.min(1, rest);
      x += take;
      rest -= take;
    }
    out.push(x);
  }
  if (pennies < 0 && rest !== 0) {
    for (let i = out.length - 1; rest !== 0 && i >= 0; i--) {
      out[i] -= 1;
      rest += 1;
    }
  }
  return out;
}

/** Multiply pennies by a percent figure (15 means 15%), half up. */
export function applyPercent(p: Pennies, percent: string): Pennies {
  const pv = Number(percent);
  return percentOf(p, pv);
}

/** Adds a percent margin (15 means 15% on top), half-up: percentOf(100630, 15) = 115725. */
export function percentOf(p: Pennies, percent: number): Pennies {
  const scaled = p * (100 + percent) + 50;
  return scaled >= 0 ? Math.floor(scaled / 100) : -Math.floor(-scaled / 100);
}

/** A plain fraction of a value, half-up: fractionOf(115725, 25) = 28931. */
export function fractionOf(p: Pennies, percent: number): Pennies {
  const scaled = p * percent + 50;
  return scaled >= 0 ? Math.floor(scaled / 100) : -Math.floor(-scaled / 100);
}
