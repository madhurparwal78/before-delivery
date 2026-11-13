/** ISO 4217 currency table: code -> minor unit exponent. Kept in sync with
 *  the published ISO table; only codes active today appear. */
const TABLE: Record<string, number> = {
  AED: 2, AFN: 2, ALL: 2, AMD: 2, ANG: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BGN: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BOV: 2,
  BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2, CAD: 2, CDF: 2, CHE: 2, CHF: 2,
  CHW: 2, CLF: 4, CLP: 0, CNY: 2, COP: 2, COU: 2, CRC: 2, CUC: 2, CUP: 2, CVE: 2,
  CZK: 2, DJF: 0, DKK: 2, DOP: 2, DZD: 2, EGP: 2, ERN: 2, ETB: 2, EUR: 2, FJD: 2,
  FKP: 2, GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2, GNF: 0, GTQ: 2, GYD: 2, HKD: 2,
  HNL: 2, HRK: 2, HTG: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2, IQD: 3, IRR: 2, ISK: 0,
  JMD: 2, JOD: 3, JPY: 0, KES: 2, KGS: 2, KHR: 2, KMF: 0, KPW: 2, KRW: 0, KWD: 3,
  KYD: 2, KZT: 2, LAK: 2, LBP: 2, LKR: 2, LRD: 2, LSL: 2, LYD: 3, MAD: 2, MDL: 2,
  MGA: 0, MKD: 2, MMK: 2, MNT: 2, MOP: 2, MRU: 2, MUR: 2, MVR: 2, MWK: 2, MXN: 2,
  MXV: 2, MYR: 2, MZN: 2, NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2, OMR: 3,
  PAB: 2, PEN: 2, PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0, QAR: 2, RON: 2, RSD: 2,
  RUB: 2, RWF: 0, SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2, SHP: 2, SLL: 2,
  SOS: 2, SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2, THB: 2, TJS: 2, TMT: 2,
  TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2, UAH: 2, UGX: 0, USD: 2, UYI: 0,
  UYU: 2, UYW: 4, UZS: 2, VES: 2, VND: 0, VUV: 0, WST: 2, XAF: 0, XCD: 2, XDR: 2,
  XOF: 0, XPF: 0, XSU: 2, XUA: 2, YER: 2, ZAR: 2, ZMW: 2, ZWL: 2,
};

export function isCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLE, code);
}

export function currencyExponent(code: string): number {
  return TABLE[code];
}

/** Largest-remainder (Hamilton) allocation of an amount by basis points.
 *  Ties go to the payer's share. Returns [payerShare, otherShare] with
 *  payerShare + otherShare === amount. */
export function allocate(amount: number, payerBp: number): { payer: number; other: number } {
  const other = amount - largestRemainderShare(amount, payerBp);
  return { payer: largestRemainderShare(amount, payerBp), other };
}

function largestRemainderShare(amount: number, shareBp: number): number {
  // shares sum to amount; this computes one side's share with the stated tie rule.
  const exact = (amount * shareBp) / 10000;
  const floor = Math.floor(exact);
  if (floor === exact) return exact;
  return floor;
}

/** Split `amount` into two integer parts by `planningBp` (basis points).
 *  Largest remainder: floor both exact shares, then hand the leftover
 *  points to the larger fractional part, ties to the payer. `payerRole`
 *  names which role paid. Returns the two shares in role order. */
export function splitAmount(
  amount: number,
  planningBp: number,
  payer: 'planning' | 'other',
): { planning: number; other: number } {
  const otherBp = 10000 - planningBp;
  const exactPlanning = (amount * planningBp) / 10000;
  const exactOther = (amount * otherBp) / 10000;
  let planning = Math.floor(exactPlanning);
  let other = Math.floor(exactOther);
  let leftover = amount - planning - other;
  const fracPlanning = exactPlanning - planning;
  const fracOther = exactOther - other;
  // hand leftover points one at a time to the larger fraction; tie to payer
  while (leftover > 0) {
    if (fracPlanning > fracOther || (fracPlanning === fracOther && payer === 'planning')) {
      planning += 1;
    } else {
      other += 1;
    }
    leftover -= 1;
  }
  return { planning, other };
}

/** Screen split cell: two whole percentages summing to 100, planning first,
 *  floor both then give the leftover point to the larger fraction, tie to planning. */
export function screenSplit(planningBp: number): { planning: number; other: number } {
  const exactPlanning = planningBp / 100;
  const exactOther = (10000 - planningBp) / 100;
  let planning = Math.floor(exactPlanning);
  let other = Math.floor(exactOther);
  let leftover = 100 - planning - other;
  const fracPlanning = exactPlanning - planning;
  const fracOther = exactOther - other;
  while (leftover > 0) {
    if (fracPlanning > fracOther || (fracPlanning === fracOther && true)) {
      planning += 1;
    } else {
      other += 1;
    }
    leftover -= 1;
  }
  return { planning, other };
}

/** Format money for the screen: − optional, groups of three with U+202F,
 *  a comma and exactly the currency's decimals when it has any, one space
 *  and the ISO code. */
export function formatMoney(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const negative = amountMinor < 0;
  let digits = Math.abs(amountMinor).toString().padStart(exp + 1, '0');
  let whole: string;
  let frac: string;
  if (exp > 0) {
    whole = digits.slice(0, -exp);
    frac = digits.slice(-exp);
  } else {
    whole = digits;
    frac = '';
  }
  const groups: string[] = [];
  for (let i = whole.length; i > 0; i -= 3) {
    groups.unshift(whole.slice(Math.max(0, i - 3), i));
  }
  const grouped = groups.join('\u202f');
  const body = exp > 0 ? `${grouped},${frac}` : grouped;
  return `${negative ? '\u2212' : ''}${body} ${currency}`;
}
