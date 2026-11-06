export interface FinancingTerm {
  months: number;
  apr_bp: number;
  monthly_cents: number;
  last_cents: number;
}

export interface BoardPackageItem {
  sku: string;
  name: string;
  size: string;
  finish: string;
  price_cents: number;
  defaults: { wing: string; mast: string; propulsion: string; battery: string; controller: string };
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
}

export interface ComponentItem {
  sku: string;
  slot: 'wing' | 'mast' | 'propulsion' | 'battery' | 'controller';
  name: string;
  colour: string;
  price_cents: number;
  wh: number | null;
  mast_m: string | null;
  fits: string[];
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
}

export interface AccessoryItem {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
  in_stock: boolean;
  as_low_as_cents: number | null;
}

export interface Catalog {
  boards: BoardPackageItem[];
  components: ComponentItem[];
  accessories: AccessoryItem[];
}

export type SlotName = 'wing' | 'mast' | 'propulsion' | 'battery' | 'controller';

export interface BuildSlot {
  sku: string;
  name: string;
  delta_cents: number;
}

export interface Build {
  code: string;
  board_sku: string;
  board_name: string;
  slots: Record<SlotName, BuildSlot>;
  spares: number;
  rider_kg: number;
  gear: number;
  total_cents: number;
  ride_min: number;
  total_ride_min: number;
  battery_bars: number;
  financing: FinancingTerm[];
}

export interface CartLine {
  id: number;
  type: 'build' | 'accessory';
  code: string | null;
  sku: string;
  name: string;
  quantity: number;
  unit_cents: number;
  line_cents: number;
}

export interface Cart {
  lines: CartLine[];
  accessory_subtotal_cents: number;
  build_subtotal_cents: number;
  subtotal_cents: number;
  codes: { code: string; amount_cents: number }[];
  item_count: number;
  financing: FinancingTerm[];
}

export interface TaxComponent {
  name: string;
  rate_pcm: number;
  amount_cents: number;
}

export interface Breakdown {
  lines: CartLine[];
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: { kind: 'trade_in' | 'demo'; amount_cents: number }[];
  taxable_cents: number;
  shipping_cents: number;
  free_shipping: boolean;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxComponent[];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  financing: FinancingTerm[];
}

export interface OrderLine extends CartLine {
  protected_until: string | null;
}

export interface Order {
  number: string;
  status: string;
  placed_at: string;
  country: string;
  address: { name: string; line1: string; city: string; postal_code: string; phone: string };
  lines: OrderLine[];
  subtotal_cents: number;
  discounts: { code: string; amount_cents: number }[];
  credits: { kind: string; amount_cents: number }[];
  taxable_cents: number;
  shipping_cents: number;
  packed_batteries: number;
  standalone_batteries: number;
  dangerous_goods_cents: number;
  taxes: TaxComponent[];
  tax_cents: number;
  total_cents: number;
  ships_on: string;
  arrives_on: string;
  trade_in_id: number | null;
  billing_account_key: string | null;
  billing_invoice_id: string | null;
  events: { status: string; at: string; by: string }[];
}

export interface User {
  id: number;
  email: string;
  role: 'customer' | 'admin' | 'dealer' | 'support';
}

export interface Me {
  user: User;
  demo_credit: { amount_cents: number; expires_at: string; used: boolean } | null;
}

export interface MatchResult {
  id: string;
  answers: string[];
  recommended: string;
  scores: Record<string, number>;
  reasons: number[];
}

export interface TradeIn {
  id: number;
  status: string;
  brand: string;
  model_year: number;
  condition: string;
  serial: string;
  note: string;
  quote_cents: number | null;
  quote_expires_at: string | null;
  reject_reason: string | null;
  order_number: string | null;
}

export interface LocationItem {
  id: number;
  name: string;
  city: string;
  country: string;
  timezone: string;
  opening_hours: string;
  lat: number;
  lon: number;
  distance_km: number | null;
}

export interface SlotItem {
  id: number;
  location_id: number;
  starts_at: string;
  ends_at: string;
  capacity: number;
  seats_left: number;
  timezone: string;
  label: string;
}

export interface BookingItem {
  id: number;
  slot_id: number;
  status: string;
  customer_email: string;
}

export interface EventItem {
  id: number;
  title: string;
  location_id: number;
  location_name: string;
  city: string;
  starts_on: string;
  ends_on: string;
}

export interface Registration {
  serial: string;
  order_number: string;
  board_name: string;
  country: string;
  registered_at: string;
  board_warranty_ends_on: string;
  battery_warranty_ends_on: string;
  board_days_left: number;
  battery_days_left: number;
}

export interface Notice {
  id: number;
  to: string;
  template: string;
  reference: string | null;
  subject: string;
  status: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
}
