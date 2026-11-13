/**
 * The one place the quote figures are worked out. The desk records these as one Kill Bill
 * invoice and afterwards shows, stores and emails only what Kill Bill returns.
 */

import { divideHalfUp } from './money';

export interface QuoteFigureInput {
  unitPriceMinor: number;
  quantity: number;
  /** The deciding edition's owner contribution percent when inside, 100 when outside. */
  ownerContributionPercent: number;
  inside: boolean;
  carriageMinor: number;
}

export interface QuoteFigures {
  partLineMinor: number;
  carriageMinor: number;
  totalMinor: number;
}

export function quoteFigures(input: QuoteFigureInput): QuoteFigures {
  const percent = input.inside ? input.ownerContributionPercent : 100;
  const partLineMinor = divideHalfUp(input.unitPriceMinor * input.quantity * percent, 100);
  return {
    partLineMinor,
    carriageMinor: input.carriageMinor,
    totalMinor: partLineMinor + input.carriageMinor,
  };
}
