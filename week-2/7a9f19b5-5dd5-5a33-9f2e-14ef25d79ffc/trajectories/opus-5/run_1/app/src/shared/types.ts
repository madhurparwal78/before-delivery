/** Wire shapes shared by the server and the browser. Money is integer cents without GST. */

export type Role = "retail" | "trade" | "admin";
export type TradeStatus = null | "submitted" | "approved" | "declined";
export type DialMode = "auto" | "morning" | "day" | "evening" | "night" | "gallery";
export type LightState = "morning" | "day" | "evening" | "night" | "gallery";
export type Occupation = "electrician" | "architect" | "lighting_designer" | "wholesaler";
export type NewsletterOccupation = "architect" | "trade" | "wholesaler" | "other";
export type PriceTier = "retail" | "trade";
export type PriceDisplay = "trade" | "retail" | "none";
export type FamilySlug = "downlights" | "track-spots" | "pendants" | "surface" | "clearance";
export type FinishCode = "WH" | "BK" | "BR" | "BZ" | "CH" | "SN";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  trade_status: TradeStatus;
  dial_mode: DialMode;
}

/** Keys every caller receives. Approved trade buyers and admins also get `trade_price_cents`. */
export interface PublicVariant {
  code: string;
  finish: FinishCode;
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  lumens: number;
  candela: number;
  retail_price_cents: number;
  was_price_cents: number | null;
  clearance: boolean;
  stock_on_hand: number | null;
}

export interface TradeVariant extends PublicVariant {
  trade_price_cents: number;
}

export type Variant = PublicVariant | TradeVariant;

export interface Product {
  slug: string;
  name: string;
  family: Exclude<FamilySlug, "clearance">;
  description: string;
  watts: number;
  cri: number;
  ip_rating: string;
  default_variant: string;
  variants: Variant[];
}

export type ComparisonItem = Variant & {
  product_slug: string;
  product_name: string;
  watts: number;
  cri: number;
  ip_rating: string;
  pool_diameter_mm_at_2700: number;
  centre_lux_at_2700: number;
};

export type FavouriteItem = Variant & { product_name: string; product_slug: string };

export type OrderStatus =
  | "cart"
  | "authorised"
  | "declined"
  | "gateway_unavailable"
  | "captured"
  | "partially_refunded"
  | "refunded"
  | "placed"
  | "invoiced"
  | "paid"
  | "overdue";

export type PaymentMethod = null | "card" | "account";

export interface OrderLine {
  variant_code: string;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface Refund {
  id: string;
  amount_cents: number;
  reason: string;
  kb_transaction_id: string;
  created_at: string;
}

export interface OrderInvoice {
  kb_invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
}

export interface Order {
  order_key: string;
  status: OrderStatus;
  display_status: string;
  payment_method: PaymentMethod;
  price_tier: PriceTier;
  lines: OrderLine[];
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  captured_cents: number;
  refunded_cents: number;
  refunds: Refund[];
  card_last4: string | null;
  purchase_order: string | null;
  invoice: OrderInvoice | null;
  created_at: string;
}

export type AdminOrder = Order & { customer_email: string };

export interface Placement {
  id: string;
  variant_code: string;
  ordinal: number;
  x_mm: number;
  y_mm: number;
  beam_deg: number;
  cct_k: number;
  candela: number;
  pool_diameter_mm: number;
  own_lux: number;
  centre_lux: number;
}

export interface ProjectLine {
  variant_code: string;
  product_name: string;
  quantity: number;
  placed: number;
}

export interface Collaborator {
  user_id: string;
  name: string;
  email: string;
}

export interface ProjectCover {
  status: "ready";
  url: string;
}

export interface Project {
  id: string;
  name: string;
  client_name: string | null;
  owner_id: string;
  is_owner: boolean;
  ceiling_height_mm: number;
  room_width_mm: number;
  room_depth_mm: number;
  cover: ProjectCover | null;
  lines: ProjectLine[];
  placements: Placement[];
  collaborators: Collaborator[];
  live: boolean;
}

export type ProjectSummary = Omit<Project, "placements">;

export interface Comment {
  id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export type PdfStatus = "pending" | "waiting_for_storage" | "ready";

export interface QuoteShare {
  id: string;
  price_display: PriceDisplay;
  recipients: string[];
  pdf_status: PdfStatus;
  created_at: string;
}

export interface TradeApplication {
  id: string;
  applicant_name: string;
  applicant_email: string;
  business_name: string;
  nzbn: string;
  occupation: Occupation;
  status: "submitted" | "approved" | "declined";
  submitted_at: string;
  decided_at: string | null;
  decline_reason: string | null;
}

export type StockReason = "seed" | "sale" | "release" | "adjust";

export interface StockMovement {
  delta: number;
  reason: StockReason;
  order_key: string | null;
  note: string | null;
  created_at: string;
}

export interface StockItem {
  variant_code: string;
  product_name: string;
  clearance_price_cents: number;
  stock_on_hand: number;
  movements: StockMovement[];
}

export type ServiceName = "postgres" | "killbill" | "mailpit" | "minio" | "pocketbase";
export type ServiceState = "up" | "down";
export type ServiceHealth = Record<ServiceName, ServiceState>;

/** Events carried by `GET /api/projects/<id>/live`. */
export interface PresenceViewer {
  user_id: string;
  name: string;
  initials: string;
}

export type LiveEvent =
  | { type: "presence"; viewers: PresenceViewer[] }
  | { type: "comment"; comment: Comment }
  | { type: "placement"; action: "created" | "updated" | "deleted"; placement: Placement }
  | { type: "status"; live: boolean };
