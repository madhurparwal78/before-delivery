import type { Quote } from "./quote.js";

export interface ShopperShipmentLine {
  line_id: string; title: string; quantity: number; unit_price_paise: number;
  coupon_share_paise: number; line_total_paise: number; gst_rate: number;
  taxable_value_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
  returnable_until: string | null; refunded_paise: number; refund_pending_paise: number;
}

export interface ShopperShipment {
  shipment_id: string; order_id: string; seller_name: string; state: string;
  promise_date: string; timeline: Array<{ state: string; at: string }>;
  delivery_fee_paise: number; cod_fee_paise: number; gift_wrap_paise: number;
  invoice_status: string;
  lines: ShopperShipmentLine[];
}

export interface SellerShipmentLine {
  line_id: string; listing_id: string; title: string; quantity: number;
  unit_price_paise: number; gross_paise: number;
}

export interface SellerShipment {
  shipment_id: string; order_id: string; state: string; promise_date: string;
  ship_to: { name: string; city: string; pincode: string };
  payment_kind: string; payment_status: string; invoice_status: string; label_status: string;
  lines: SellerShipmentLine[];
}

export interface SupportReturn {
  return_id: string; state: string; quantity: number; refund_paise: number;
  refund_legs: Array<{ method: string; amount_paise: number; status: string }>;
  decline_reason: string;
}

export type QuoteView = Quote;
