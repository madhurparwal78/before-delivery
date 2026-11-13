/** Wire shapes shared by the server and the browser. */

import type { ErrorCode, MergeOutcome } from './messages.js';

export type Role = 'shopper' | 'seller' | 'support';

export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'emi' | 'cod';
export type LegMethod = PaymentMethod | 'balance';
export type DeliverySpeed = 'standard' | 'one_day';
export type ShipmentState = 'placed' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
export type ReturnState = 'requested' | 'picked' | 'declined' | 'refunded';
export type DocumentStatus = 'pending' | 'ready';

export type ApiErrorBody = {
  error: ErrorCode;
  message: string;
  errors?: Record<string, string>;
  retry_after?: number;
  listing_ids?: string[];
  quote?: CartQuote;
  from?: string;
  to?: string;
};

export type Account = {
  id: string;
  name: string;
  first_name: string;
  role: Role;
};

export type Address = {
  id: string;
  label: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  pincode: string;
  phone: string;
};

export type SavedCard = {
  card_id: string;
  network: string;
  last4: string;
  expiry_month: number;
  expiry_year: number;
  name: string;
};

export type SearchHit = {
  listing_id: string;
  product_id: string;
  title: string;
  brand: string;
  category: string;
  seller_id: string;
  seller_name: string;
  price_paise: number;
  rating: number;
  image_url: string;
  in_stock: boolean;
  delivers: boolean | null;
  promise_date: string | null;
};

export type SearchResponse = {
  hits: SearchHit[];
  facets: {
    category: Record<string, number>;
    brand: Record<string, number>;
    seller: Record<string, number>;
    rating: Record<string, number>;
  };
  total: number;
  next_cursor: string | null;
  degraded: boolean;
  server_time?: string;
};

export type Offer = {
  listing_id: string;
  seller_id: string;
  seller_name: string;
  seller_rating: number;
  price_paise: number;
  delivery_fee_paise: number;
  landed_paise: number;
  promise_date: string | null;
  cod_available: boolean;
  in_stock: boolean;
  featured: boolean;
};

export type ProductDetail = {
  id: string;
  title: string;
  brand: string;
  category: string;
  gst_rate: number;
  rating: number;
  description: string;
  specs: Record<string, string>;
  offers_count: number;
  featured_offer: Offer | null;
};

export type CompareResponse = {
  category: string;
  products: {
    id: string;
    title: string;
    brand: string;
    rating: number;
    best_price_paise: number;
    specs: Record<string, string>;
  }[];
  attributes: { name: string; values: string[]; differs: boolean }[];
};

export type EmiPlan = {
  tenure_months: number;
  no_cost: boolean;
  upfront_discount_paise: number;
  principal_paise: number;
  instalment_paise: number;
  total_interest_paise: number;
  total_payable_paise: number;
};

export type EmiPlansResponse = {
  amount_paise: number;
  monthly_rate_percent: string;
  plans: EmiPlan[];
};

export type PincodeInfo = {
  pincode: string;
  city: string | null;
  state: string | null;
  serviceable: boolean;
  cod_available: boolean;
};

export type CartLine = {
  line_id: string;
  listing_id: string;
  product_id: string;
  title: string;
  seller_id: string;
  quantity: number;
  unit_price_paise: number;
  deal: { price_paise: number; ends_at: string } | null;
  selected: boolean;
  gift_wrap: boolean;
  gift_message: string;
  line_subtotal_paise: number;
  coupon_share_paise: number;
  line_total_paise: number;
  gst_rate: number;
  taxable_value_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  in_stock: boolean;
};

export type SavedLine = {
  line_id: string;
  listing_id: string;
  title: string;
  unit_price_paise: number;
  in_stock: boolean;
};

export type Parcel = {
  seller_id: string;
  seller_name: string;
  line_ids: string[];
  speed: DeliverySpeed;
  one_day_available: boolean;
  serviceable: boolean;
  promise_date: string | null;
  delivery_fee_paise: number;
  cod_fee_paise: number;
};

export type CartQuote = {
  lines: CartLine[];
  saved_for_later: SavedLine[];
  parcels: Parcel[];
  destination: {
    address_id: string | null;
    pincode: string | null;
    city: string | null;
    state: string | null;
  };
  coupon: { code: string; discount_paise: number } | null;
  payment: {
    method: PaymentMethod | null;
    use_balance: boolean;
    emi_tenure_months: number | null;
  };
  subtotal_paise: number;
  discount_paise: number;
  gift_wrap_paise: number;
  delivery_paise: number;
  cod_fee_paise: number;
  emi_discount_paise: number;
  payable_paise: number;
  balance_applied_paise: number;
  due_paise: number;
  cod: {
    eligible: boolean;
    reason: string | null;
    message: string | null;
    cap_paise: number;
    cash_paise: number;
  };
  server_time: string;
};

export type MergeResult = {
  listing_id: string;
  title: string;
  outcome: MergeOutcome;
  quantity: number;
};

export type WishlistItem = {
  item_id: string;
  product_id: string;
  listing_id: string;
  title: string;
  image_url: string;
  price_paise: number;
};

export type ShareLink = {
  token: string;
  url: string;
  display_name: string;
  expires_at: string;
};

export type SharedPage = {
  kind: 'wishlist' | 'cart';
  display_name: string;
  items: {
    product_id: string;
    listing_id: string;
    title: string;
    image_url: string;
    price_paise: number;
  }[];
};

export type PaymentLeg = {
  method: LegMethod;
  amount_paise: number;
  status: string;
  card_last4?: string | null;
  card_network?: string | null;
};

export type PaymentView = {
  payment_id: string;
  method: PaymentMethod | null;
  status: 'awaiting_customer' | 'confirmed' | 'expired' | 'failed';
  expires_at: string | null;
  legs: PaymentLeg[];
};

export type ShopperShipmentLine = {
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
};

export type ShopperShipmentView = {
  shipment_id: string;
  order_id: string;
  seller_name: string;
  state: ShipmentState;
  promise_date: string;
  timeline: { state: string; at: string }[];
  delivery_fee_paise: number;
  cod_fee_paise: number;
  gift_wrap_paise: number;
  invoice_status: DocumentStatus;
  lines: ShopperShipmentLine[];
};

export type SellerShipmentView = {
  shipment_id: string;
  order_id: string;
  state: ShipmentState;
  promise_date: string;
  ship_to: { name: string; city: string; pincode: string };
  payment_kind: 'prepaid' | 'cod';
  payment_status: 'pending' | 'paid' | 'partially_refunded' | 'refunded';
  invoice_status: DocumentStatus;
  label_status: DocumentStatus;
  lines: {
    line_id: string;
    listing_id: string;
    title: string;
    quantity: number;
    unit_price_paise: number;
    gross_paise: number;
  }[];
};

export type OrderSummary = {
  order_id: string;
  placed_at: string;
  payable_paise: number;
  shipment_count: number;
  shipment_states: string[];
};

export type OrderDetail = {
  order_id: string;
  placed_at: string;
  address: Address;
  payment: PaymentView;
  shipments: ShopperShipmentView[];
  payable_paise: number;
};

export type CheckoutResponse = {
  order_id: string;
  status: 'placed' | 'awaiting_payment';
  payable_paise: number;
  shipments: {
    shipment_id: string;
    seller_id: string;
    seller_name: string;
    state: ShipmentState;
    promise_date: string;
  }[];
  payment: {
    payment_id: string;
    status: 'confirmed' | 'awaiting_customer';
    expires_at: string | null;
    legs: PaymentLeg[];
  };
  confirmation_url: string;
};

export type ReturnView = {
  return_id: string;
  state: ReturnState;
  quantity: number;
  refund_paise: number;
  refund_legs: { method: LegMethod; amount_paise: number; status: string }[];
  decline_reason: string | null;
};

export type SellerListing = {
  listing_id: string;
  product_id: string;
  title: string;
  category: string;
  price_paise: number;
  cost_price_paise: number;
  stock: number;
  status: 'live' | 'unlisted';
  photo_count: number;
  cod_allowed: boolean;
  no_cost_emi: boolean;
  description?: string;
  return_note?: string;
  brand?: string;
  deal?: { price_paise: number; ends_at: string } | null;
  photos?: { photo_id: string; url: string }[];
};

export type SettlementLine = {
  settlement_line_id: string;
  shipment_id: string;
  line_id: string;
  kind: 'sale' | 'return';
  posted_on: string;
  gross_paise: number;
  commission_percent: number;
  commission_paise: number;
  commission_gst_paise: number;
  tcs_paise: number;
  tds_paise: number;
  emi_subvention_paise: number;
  net_paise: number;
  status: 'payment_pending' | 'payment_confirmed';
};

export type SettlementTotals = {
  gross_paise: number;
  commission_paise: number;
  commission_gst_paise: number;
  tcs_paise: number;
  tds_paise: number;
  emi_subvention_paise: number;
  net_paise: number;
};

export type SupportOrderView = {
  order_id: string;
  shopper: { name: string; phone_masked: string };
  payment: {
    legs: {
      method: LegMethod;
      amount_paise: number;
      refunded_paise: number;
      card_last4: string | null;
      card_network: string | null;
    }[];
  };
  shipments: {
    shipment_id: string;
    seller_name: string;
    state: ShipmentState;
    shopper_view: ShopperShipmentView;
    seller_view: SellerShipmentView;
  }[];
  returns: ReturnView[];
};
