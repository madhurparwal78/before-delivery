export type ShipmentState = "placed" | "packed" | "shipped" | "delivered" | "cancelled";

export interface ShipmentLine {
  line_id: string;
  title: string;
  quantity: number;
  unit_price_paise: number;
  coupon_share_paise: number;
  line_total_paise: number;
  gst_rate: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  returnable_until: string | null;
  refunded_paise: number;
  refund_pending_paise: number;
}

export interface Shipment {
  shipment_id: string;
  order_id: string;
  seller_name: string;
  state: ShipmentState;
  promise_date: string | null;
  timeline: { state: ShipmentState; at: string }[];
  delivery_fee_paise: number;
  cod_fee_paise: number;
  gift_wrap_paise: number;
  invoice_status: "pending" | "ready";
  lines: ShipmentLine[];
}

export interface Refund {
  shipment_id: string;
  line_id: string | null;
  amount_paise: number;
  status: string;
  method: string;
  card_last4: string | null;
}

export type PaymentStatus = "awaiting_customer" | "confirmed" | "expired" | "failed";

export interface OrderPayment {
  payment_id: string;
  method: string | null;
  status: PaymentStatus;
  expires_at: string | null;
}

export interface Order {
  order_id: string;
  placed_at: string;
  payable_paise: number;
  payment: OrderPayment;
  shipments: Shipment[];
  refunds: Refund[];
  server_time: string;
}
