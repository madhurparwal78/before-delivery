/** Cash-on-delivery eligibility, refused for the first reason that applies. */

import { errorMessage } from '../../shared/messages.js';
import { COD_CAP_PAISE } from './money.js';
import type { PincodeRecord } from './promise.js';

export type CodInput = {
  sellers: { display_name: string; cod_allowed: boolean }[];
  destination: PincodeRecord | null;
  openCodOrders: number;
  cashPaise: number;
};

export type CodDecision = {
  eligible: boolean;
  reason: 'cod_seller' | 'cod_pincode' | 'cod_open_orders' | 'cod_over_cap' | null;
  message: string | null;
  cap_paise: number;
  cash_paise: number;
};

export function codEligibility(input: CodInput): CodDecision {
  const base = { cap_paise: COD_CAP_PAISE, cash_paise: input.cashPaise };
  const refusingSeller = input.sellers.find((seller) => !seller.cod_allowed);
  if (refusingSeller !== undefined) {
    return {
      eligible: false,
      reason: 'cod_seller',
      message: errorMessage('cod_seller', { seller: refusingSeller.display_name }),
      ...base,
    };
  }
  if (input.destination === null || !input.destination.cod || !input.destination.serviceable) {
    return {
      eligible: false,
      reason: 'cod_pincode',
      message: errorMessage('cod_pincode', { pincode: input.destination?.pincode ?? '' }),
      ...base,
    };
  }
  if (input.openCodOrders >= 3) {
    return {
      eligible: false,
      reason: 'cod_open_orders',
      message: errorMessage('cod_open_orders'),
      ...base,
    };
  }
  if (input.cashPaise > COD_CAP_PAISE) {
    return {
      eligible: false,
      reason: 'cod_over_cap',
      message: errorMessage('cod_over_cap'),
      ...base,
    };
  }
  return { eligible: true, reason: null, message: null, ...base };
}
