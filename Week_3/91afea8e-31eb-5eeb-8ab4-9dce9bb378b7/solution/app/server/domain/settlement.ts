import { roundHalfUp } from "./money.js";
import { prorate } from "./refund.js";
import { taxableValue } from "./tax.js";

export interface SettlementAmounts {
  grossPaise: number;
  commissionPaise: number;
  commissionGstPaise: number;
  tcsPaise: number;
  tdsPaise: number;
  emiSubventionPaise: number;
  netPaise: number;
}

const KEYS = ["grossPaise", "commissionPaise", "commissionGstPaise", "tcsPaise", "tdsPaise", "emiSubventionPaise", "netPaise"] as const;

/** One sale settlement line: commission, 18% GST on commission, 0.5% TCS on taxable value, 0.1% TDS on gross. */
export function saleSettlement(grossPaise: number, gstRate: number, commissionPercent: number, emiSubventionPaise: number): SettlementAmounts {
  const commissionPaise = roundHalfUp(grossPaise * commissionPercent, 100);
  const commissionGstPaise = roundHalfUp(commissionPaise * 18, 100);
  const tcsPaise = roundHalfUp(taxableValue(grossPaise, gstRate) * 5, 1000);
  const tdsPaise = roundHalfUp(grossPaise, 1000);
  return {
    grossPaise,
    commissionPaise,
    commissionGstPaise,
    tcsPaise,
    tdsPaise,
    emiSubventionPaise,
    netPaise: grossPaise - commissionPaise - commissionGstPaise - tcsPaise - tdsPaise - emiSubventionPaise,
  };
}

/** A return line is the negative of the sale times k/q; the last units take the exact remainder of what earlier returns reversed. */
export function returnSettlement(
  sale: SettlementAmounts,
  alreadyReversed: SettlementAmounts,
  unitsReturned: number,
  unitsLeft: number,
  quantity: number,
): SettlementAmounts {
  const part = (key: (typeof KEYS)[number]): number => -prorate(sale[key], quantity, unitsReturned, unitsLeft, alreadyReversed[key]);
  return {
    grossPaise: part("grossPaise"),
    commissionPaise: part("commissionPaise"),
    commissionGstPaise: part("commissionGstPaise"),
    tcsPaise: part("tcsPaise"),
    tdsPaise: part("tdsPaise"),
    emiSubventionPaise: part("emiSubventionPaise"),
    netPaise: part("netPaise"),
  };
}
