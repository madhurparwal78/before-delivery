import { roundHalfUp } from "./money.js";

/** The taxable value inside a GST-inclusive amount: amount times 100 over (100 plus the rate), rounded. */
export function taxableValue(amountPaise: number, gstRate: number): number {
  return roundHalfUp(amountPaise * 100, 100 + gstRate);
}

export interface TaxSplit {
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

/** A GST-inclusive line total split into taxable value and CGST plus SGST (same state) or IGST. */
export function splitTax(lineTotalPaise: number, gstRate: number, sameState: boolean): TaxSplit {
  const taxableValuePaise = taxableValue(lineTotalPaise, gstRate);
  const tax = lineTotalPaise - taxableValuePaise;
  if (!sameState) return { taxableValuePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
  const sgstPaise = Math.floor(tax / 2);
  return { taxableValuePaise, cgstPaise: tax - sgstPaise, sgstPaise, igstPaise: 0 };
}
