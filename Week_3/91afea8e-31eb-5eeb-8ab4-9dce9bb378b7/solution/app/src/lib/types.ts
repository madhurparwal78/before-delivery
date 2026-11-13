export type Role = "shopper" | "seller" | "support";

export interface Account {
  id: string;
  name: string;
  first_name: string;
  role: Role;
}

export interface Deal {
  price_paise: number;
  ends_at: string;
}

export interface QuoteLine {
  line_id: string;
  listing_id: string;
  product_id: string;
  title: string;
  seller_id: string;
  seller_name: string;
  image_url: string;
  quantity: number;
  unit_price_paise: number;
  deal: Deal | null;
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
}

export interface SavedLine {
  line_id: string;
  listing_id: string;
  product_id: string;
  title: string;
  image_url: string;
  quantity: number;
  unit_price_paise: number;
  in_stock: boolean;
}

export interface Parcel {
  seller_id: string;
  seller_name: string;
  line_ids: string[];
  speed: "standard" | "one_day";
  one_day_available: boolean;
  serviceable: boolean | null;
  promise_date: string | null;
  delivery_fee_paise: number;
  cod_fee_paise: number;
}

export type PaymentMethod = "upi" | "card" | "netbanking" | "emi" | "cod";

export interface Quote {
  lines: QuoteLine[];
  saved_for_later: SavedLine[];
  parcels: Parcel[];
  destination: { address_id: string | null; pincode: string | null; city: string | null; state: string | null };
  coupon: { code: string; discount_paise: number } | null;
  payment: { method: PaymentMethod | null; use_balance: boolean; emi_tenure_months: 3 | 6 | 9 | 12 | null };
  subtotal_paise: number;
  discount_paise: number;
  gift_wrap_paise: number;
  delivery_paise: number;
  cod_fee_paise: number;
  emi_discount_paise: number;
  payable_paise: number;
  balance_applied_paise: number;
  due_paise: number;
  cod: { eligible: boolean; reason: string | null; message: string | null; cap_paise: number; cash_paise: number };
  server_time: string;
}

export interface MergeResult {
  listing_id: string;
  title: string;
  outcome: "added" | "combined" | "capped" | "saved_for_later" | "unavailable";
  quantity: number;
}

export interface Hit {
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
}

export interface Offer {
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
}

/** What a guest keeps in the browser for one cart line. */
export interface GuestLine {
  listing_id: string;
  product_id: string;
  title: string;
  seller_name: string;
  image_url: string;
  price_paise: number;
  quantity: number;
}

export interface ListingSnapshot {
  listing_id: string;
  product_id: string;
  title: string;
  seller_name: string;
  image_url: string;
  price_paise: number;
}
