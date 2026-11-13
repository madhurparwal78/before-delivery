import { rupees } from "../../shared/format.js";
import { COD_CAP_PAISE, MAX_OPEN_COD_ORDERS } from "./fees.js";

export type CodReason = "cod_seller" | "cod_pincode" | "cod_open_orders" | "cod_over_cap";

interface CodInput {
  sellers: readonly { name: string; allowsCod: boolean }[];
  destination: { pincode: string; codAvailable: boolean } | null;
  openCodOrders: number;
  cashPaise: number;
}

export interface CodVerdict {
  reason: CodReason | null;
  message: string | null;
}

/** Cash on delivery is refused for the first reason that applies. */
export function codEligibility(input: CodInput): CodVerdict {
  const refusing = input.sellers.find((seller) => !seller.allowsCod);
  if (refusing) return { reason: "cod_seller", message: `${refusing.name} doesn't offer cash on delivery.` };
  if (input.destination && !input.destination.codAvailable) {
    return { reason: "cod_pincode", message: `Cash on delivery isn't available at ${input.destination.pincode}.` };
  }
  if (input.openCodOrders >= MAX_OPEN_COD_ORDERS) {
    return { reason: "cod_open_orders", message: `You already have ${MAX_OPEN_COD_ORDERS} cash-on-delivery orders on the way.` };
  }
  if (input.cashPaise > COD_CAP_PAISE) {
    return { reason: "cod_over_cap", message: `Cash on delivery is available up to ${rupees(COD_CAP_PAISE)} per order.` };
  }
  return { reason: null, message: null };
}
