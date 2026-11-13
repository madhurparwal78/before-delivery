// Wire types shared by the server and the web app. Every shape is the one the brief publishes.

export type Role = "customer" | "operations" | "support";

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  sku?: string;
  available?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Config {
  reservation_ttl_seconds: number;
  return_window_days: number;
  trial_window_days: number;
  compare_max: number;
  page_size: number;
  cart_undo_seconds: number;
  toast_seconds: number;
  low_stock_threshold: number;
  free_shipping_minimum: number;
  tax_rate_percent: number;
  upload_max_bytes: number;
  warranty_years_luggage: number;
  warranty_years_bags: number;
  warranty_years_accessories: number;
}

export interface CollectionSummary {
  slug: string;
  name: string;
  designs: number;
  units: number;
}

export type StockBadge = "Out of stock" | `Only ${number} left` | "In stock";

export interface SearchResultColour {
  name: string;
  slug: string;
  image_url: string;
}

export interface SearchResult {
  slug: string;
  name: string;
  category: string;
  min_price: number;
  compare_at: number | null;
  save_percent: number | null;
  colours: SearchResultColour[];
  badge: StockBadge;
  /** Colour slug to the SKU of that colour's first size (card quick add, compare). */
  first_skus: Record<string, string>;
  /** Every variant SKU of the product (a card is "in the comparison" when any of them is). */
  skus: string[];
  /** True when the product's variants differ in price, so the card reads "From ₹<min>". */
  price_varies: boolean;
}

export type FacetGroup = "category" | "colour" | "size" | "material" | "price" | "fit";
export type FacetCounts = Record<FacetGroup, Record<string, number>>;
export type FilterOptions = Record<FacetGroup, { value: string; label: string }[]>;

export interface SearchResponse {
  mode: "search" | "fallback";
  total: number;
  page: number;
  page_size: number;
  results: SearchResult[];
  facets: FacetCounts | null;
  notice: string | null;
  /** Every filter option the collection holds, with its label, in display order. */
  options: FilterOptions;
}

export interface SuggestResponse {
  mode: "search" | "fallback";
  suggestions: { name: string; slug: string }[];
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string;
  position: number;
}

export interface Dimensions {
  height: number;
  width: number;
  depth: number;
}

export interface Variant {
  sku: string;
  colour: string;
  colour_slug: string;
  size: string;
  size_slug: string;
  dimensions_cm: Dimensions;
  weight_kg: number;
  price: number;
  compare_at: number | null;
  save_percent: number | null;
  available: number;
  badge: StockBadge;
  images: ProductImage[];
}

export interface Product {
  slug: string;
  name: string;
  category: string;
  collection: string;
  material: string;
  warranty_years: number;
  saves: number;
  /** Product-level stock badge, the same rule as the search result badge. */
  badge: StockBadge;
  variants: Variant[];
}

export interface Airline {
  code: string;
  name: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
  weight_kg: number;
}

export interface Fit {
  sku: string;
  airline: string;
  fits: boolean;
  overhang_cm: Dimensions;
  max_overhang_cm: number;
  verdict: string;
}

export interface Address {
  id: string;
  label: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postcode: string;
  phone: string;
}

export type AddressFields = Omit<Address, "id" | "label">;

export interface Wishlist {
  count: number;
  items: { slug: string; name: string; saved_at: string }[];
}

export interface AppNotification {
  id: string;
  text: string;
  at: string;
  email_status: "emailed" | "pending";
}

export interface Totals {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  gift_card: number;
  total: number;
}

export interface CartLine {
  id: string;
  sku: string;
  product: string;
  colour: string;
  size: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_discount: number;
  available: number;
  badge: StockBadge;
}

export interface Cart {
  count: number;
  lines: CartLine[];
  discount: { code: string; kind: "percent" | "fixed"; value: number } | null;
  gift_card: { last4: string; balance: number } | null;
  shipping_method: ShippingMethod;
  totals: Totals;
  notices: string[];
}

export type ShippingMethod = "standard" | "express";
export type CheckoutStep = "contact" | "delivery" | "shipping" | "payment";

export interface Hold {
  status: "none" | "active" | "expired";
  expires_at: string | null;
  seconds_left: number;
}

export interface Checkout {
  id: string;
  step: CheckoutStep;
  contact: { email: string; phone: string } | null;
  delivery: { address_id: string | null; address: AddressFields } | null;
  shipping_method: ShippingMethod;
  gift: boolean;
  gift_message: string;
  lines: CartLine[];
  totals: Totals;
  discount: Cart["discount"];
  gift_card: Cart["gift_card"];
  hold: Hold;
  server_time: string;
  /** Set once the checkout has become an order. */
  order_number: string | null;
}

export type OrderStatus =
  | "placed"
  | "packed"
  | "partially_shipped"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";
export type PaymentStatus = "pending" | "authorized" | "captured" | "partially_refunded" | "refunded" | "failed";
export type Fulfillment = "unfulfilled" | "packed" | "shipped" | "out_for_delivery" | "delivered" | "cancelled";

export interface Shipment {
  carrier: string;
  tracking_number: string;
}

export interface OrderLine {
  id: string;
  sku: string;
  product: string;
  colour: string;
  size: string;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  line_discount: number;
  line_tax: number;
  fulfillment: Fulfillment;
  shipment: Shipment | null;
  return_eligible: boolean;
  trial_eligible: boolean;
  warranty: { registration_id: string; covered_until: string } | null;
  /** Other variants of the product at the same price, for the exchange choice. */
  exchange_options: { sku: string; colour: string; size: string; available: number }[];
  /** True when the product category carries a trial (luggage, backpacks, totes). */
  trial_category: boolean;
}

export interface Window {
  ends_at: string | null;
  seconds_left: number;
  open: boolean;
}

export interface Order {
  number: string;
  status: OrderStatus;
  version: number;
  placed_at: string;
  delivered_at: string | null;
  confirmation_emailed_at: string | null;
  payment: {
    status: PaymentStatus;
    amount: number;
    card_amount: number;
    gift_card_amount: number;
    card_last4: string | null;
    refunded: number;
  };
  lines: OrderLine[];
  totals: Totals;
  shipping_tax: number;
  timeline: { status: OrderStatus; label: string; at: string }[];
  return_window: Window;
  trial_window: Window;
  server_time: string;
  email: string | null;
  address: AddressFields | null;
  shipping_method: ShippingMethod;
  gift_message: string | null;
}

export interface OrderSummary {
  number: string;
  status: OrderStatus;
  placed_at: string;
  total: number;
}

export type CaseKind = "return" | "trial" | "claim";
export type ReturnStatus = "requested" | "approved" | "rejected" | "in_transit" | "received" | "inspected" | "refunded" | "exchanged";
export type TrialStatus = "requested" | "approved" | "rejected" | "returned" | "refunded";
export type ClaimStatus = "submitted" | "under_review" | "approved" | "rejected" | "repair" | "replacement" | "resolved";

interface CaseBase<S extends string> {
  number: string;
  status: S;
  version: number;
  order_number: string;
  order_line_id: string;
  history: { status: S; at: string }[];
  refund_amount: number | null;
  /** Staff rejection reason; null unless rejected. */
  reason: string | null;
  product: string;
  variant: string;
}

export interface ReturnCase extends CaseBase<ReturnStatus> {
  quantity: number;
  outcome: "refund" | "exchange";
  request_reason: string;
  exchange_sku: string | null;
  exchange_order_number: string | null;
}

export interface TrialCase extends CaseBase<TrialStatus> {
  note: string;
}

export interface Evidence {
  id: string;
  kind: "photo" | "receipt";
  filename: string;
  content_type: string;
  bytes: number;
  sha256: string;
  status: "stored";
  stored_at: string;
}

export interface ClaimCase extends CaseBase<ClaimStatus> {
  component: string;
  description: string;
  resolution_order_number: string | null;
  evidence: { id: string; kind: "photo" | "receipt"; filename: string; status: "stored" }[];
}

export interface WarrantyRegistration {
  id: string;
  order_line_id: string;
  covered_until: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export type AnyCase = ReturnCase | TrialCase | ClaimCase;
export type AdminCase<C extends AnyCase = AnyCase> = C & { customer: Customer };
export type AdminOrder = Order & { customer: Customer };

export interface StockLocation {
  location: "bhiwandi" | "gurugram";
  available: number;
  reserved: number;
  committed: number;
  on_hand: number;
}

export interface AdminVariant {
  sku: string;
  colour: string;
  size: string;
  version: number;
  price: number;
  compare_at: number | null;
  stock: { location: "bhiwandi" | "gurugram"; available: number }[];
}

export interface AdminProduct {
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  version: number;
  colours: string[];
  variants: AdminVariant[];
}

export interface InventoryRow {
  sku: string;
  product: string;
  colour: string;
  size: string;
  locations: StockLocation[];
  available: number;
  on_hand: number;
}

export interface StockMovement {
  movement_id: string;
  reason: string;
  ref: string;
  at: string;
  entries: { account: string; location: string; quantity: number }[];
}

export interface DiscountCode {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  collection: string | null;
  minimum: number;
  starts_at: string;
  ends_at: string;
  usage_limit: number | null;
  used: number;
}

export interface GiftCardLedger {
  code: string;
  balance: number;
  entries: { group_id: string; account: string; amount: number; reason: string; ref: string; at: string }[];
}

export interface AuditEntry {
  id: string;
  actor: { id: string; name: string; role: Role };
  action: string;
  entity: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  at: string;
}

export interface Metrics {
  orders: number;
  gross_sales: number;
  refunds: number;
  net_sales: number;
  units_sold: number;
  average_order_value: number;
}

export interface UploadedImage {
  id: string;
  colour: string;
  alt: string;
  position: number;
  url: string;
}

export interface LiveEvents {
  stock: { sku: string; available: number; badge: StockBadge };
  price: { sku: string; price: number; compare_at: number | null };
  collection: { slug: string; units: number };
  order: { number: string; status: OrderStatus; payment_status: PaymentStatus; version: number; lines: { id: string; fulfillment: Fulfillment; shipment: Shipment | null }[] };
  return: { number: string; status: ReturnStatus; version: number };
  trial: { number: string; status: TrialStatus; version: number };
  warranty: { number: string; status: ClaimStatus; version: number };
  cart: { count: number };
  wishlist: { count: number; slugs: string[] };
  notification: { text: string; email_status: "emailed" | "pending" };
  queue: { kind: CaseKind | "order"; number: string; status: string };
}

export type LiveEventType = keyof LiveEvents;
