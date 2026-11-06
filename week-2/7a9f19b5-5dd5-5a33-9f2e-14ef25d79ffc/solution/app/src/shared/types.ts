// API shapes, exactly as the brief's API section publishes them.
import type { DialMode } from "./dial.js";

export type Role = "retail" | "trade" | "admin";
export type TradeStatus = "submitted" | "approved" | "declined";
export type Family = "downlights" | "track-spots" | "pendants" | "surface";
export type Occupation = "electrician" | "architect" | "lighting_designer" | "wholesaler";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  trade_status: TradeStatus | null;
  dial_mode: DialMode;
}

export interface Variant {
  code: string;
  finish: string;
  finish_name: string;
  beam_deg: number;
  cct_k: number;
  lumens: number;
  candela: number;
  retail_price_cents: number;
  was_price_cents: number | null;
  clearance: boolean;
  stock_on_hand: number | null;
  trade_price_cents?: number;
}

export interface Product {
  slug: string;
  name: string;
  family: Family;
  description: string;
  watts: number;
  cri: number;
  ip_rating: string;
  default_variant: string;
  variants: Variant[];
}

export interface ComparisonItem extends Variant {
  product_slug: string;
  product_name: string;
  watts: number;
  cri: number;
  ip_rating: string;
  pool_diameter_mm_at_2700: number;
  centre_lux_at_2700: number;
}

export interface FavouriteItem extends Variant {
  product_name: string;
  product_slug: string;
}

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
  | "paid";

/** The status an order reports: an invoiced order past its due date reads `overdue`. */
export type ReportedStatus = OrderStatus | "overdue";

interface OrderLine {
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

export interface Invoice {
  kb_invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
}

export interface Order {
  order_key: string;
  status: ReportedStatus;
  display_status: string;
  payment_method: "card" | "account" | null;
  price_tier: "retail" | "trade";
  lines: OrderLine[];
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  captured_cents: number;
  refunded_cents: number;
  refunds: Refund[];
  card_last4: string | null;
  purchase_order: string | null;
  invoice: Invoice | null;
  created_at: string;
}

export interface AdminOrder extends Order {
  customer_email: string;
}

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

export interface Project {
  id: string;
  name: string;
  client_name: string | null;
  owner_id: string;
  is_owner: boolean;
  ceiling_height_mm: number;
  room_width_mm: number;
  room_depth_mm: number;
  cover: { status: "ready"; url: string } | null;
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

export interface Viewer {
  user_id: string;
  name: string;
  initials: string;
}

export type PriceDisplay = "trade" | "retail" | "none";
type PdfStatus = "pending" | "waiting_for_storage" | "ready";

export interface Share {
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
  status: TradeStatus;
  submitted_at: string;
  decided_at: string | null;
  decline_reason: string | null;
}

export interface StockMovement {
  delta: number;
  reason: "seed" | "sale" | "release" | "adjust";
  order_key: string | null;
  note: string | null;
  created_at: string;
}

export interface StockItem {
  variant_code: string;
  product_name: string;
  /** null once an admin ends the variant's clearance. */
  clearance_price_cents: number | null;
  stock_on_hand: number;
  movements: StockMovement[];
}

type ServiceName = "postgres" | "killbill" | "mailpit" | "minio" | "pocketbase";
export type ServiceHealth = Record<ServiceName, "up" | "down">;

export type LiveEvent =
  | { type: "presence"; data: { viewers: Viewer[] } }
  | { type: "comment"; data: { comment: Comment } }
  | { type: "placement"; data: { action: "created" | "updated"; placement: Placement } }
  | { type: "placement"; data: { action: "deleted"; placement: Pick<Placement, "id" | "variant_code"> } }
  | { type: "status"; data: { live: boolean } };

export interface ApiErrorBody {
  error: string;
  errors?: Record<string, string>;
  status?: string;
  available?: number;
  order?: Order;
}
