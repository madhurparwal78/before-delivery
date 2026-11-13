/** Settlement line arithmetic: gross down to net, each item rounded once. */

import { percentOf, roundDiv, taxSplit } from './money.js';

export const COMMISSION_GST_PERCENT = 18;
export const TCS_PERCENT = 0.5;
export const TDS_PERCENT = 0.1;

export type SettlementAmounts = {
  gross_paise: number;
  commission_percent: number;
  commission_paise: number;
  commission_gst_paise: number;
  tcs_paise: number;
  tds_paise: number;
  emi_subvention_paise: number;
  net_paise: number;
};

export function saleSettlement(input: {
  grossPaise: number;
  gstRate: number;
  commissionPercent: number;
  emiSubventionPaise: number;
}): SettlementAmounts {
  const taxableValue = taxSplit(input.grossPaise, input.gstRate, true).taxable_value_paise;
  const commission = percentOf(input.grossPaise, input.commissionPercent);
  const commissionGst = percentOf(commission, COMMISSION_GST_PERCENT);
  const tcs = percentOf(taxableValue, TCS_PERCENT);
  const tds = percentOf(input.grossPaise, TDS_PERCENT);
  return {
    gross_paise: input.grossPaise,
    commission_percent: input.commissionPercent,
    commission_paise: commission,
    commission_gst_paise: commissionGst,
    tcs_paise: tcs,
    tds_paise: tds,
    emi_subvention_paise: input.emiSubventionPaise,
    net_paise:
      input.grossPaise - commission - commissionGst - tcs - tds - input.emiSubventionPaise,
  };
}

/**
 * A return posts the negative of the sale line's share; the last units take the exact remainder.
 * `postedSoFar` carries the sums of earlier return postings for this line, so negative values.
 */
export function returnSettlement(
  sale: SettlementAmounts,
  quantity: number,
  units: number,
  alreadyReturnedUnits: number,
  postedSoFar: SettlementAmounts,
): SettlementAmounts {
  const last = alreadyReturnedUnits + units >= quantity;
  const share = (saleValue: number, posted: number): number =>
    last ? -saleValue - posted : -roundDiv(saleValue * units, quantity);
  return {
    gross_paise: share(sale.gross_paise, postedSoFar.gross_paise),
    commission_percent: sale.commission_percent,
    commission_paise: share(sale.commission_paise, postedSoFar.commission_paise),
    commission_gst_paise: share(sale.commission_gst_paise, postedSoFar.commission_gst_paise),
    tcs_paise: share(sale.tcs_paise, postedSoFar.tcs_paise),
    tds_paise: share(sale.tds_paise, postedSoFar.tds_paise),
    emi_subvention_paise: share(sale.emi_subvention_paise, postedSoFar.emi_subvention_paise),
    net_paise: share(sale.net_paise, postedSoFar.net_paise),
  };
}
