/** API client and shared types for the browser. */

export interface VariantPublic {
  code: string
  finish: string
  finish_name: string
  beam_deg: number
  cct_k: number
  lumens: number
  candela: number
  retail_price_cents: number
  was_price_cents: number | null
  clearance: boolean
  stock_on_hand: number | null
  trade_price_cents?: number
}

export interface ProductPublic {
  slug: string
  name: string
  family: string
  description: string
  watts: number
  cri: number
  ip_rating: string
  default_variant: string
  variants: VariantPublic[]
}

export interface ComparisonItem extends VariantPublic {
  product_slug: string
  product_name: string
  watts: number
  cri: number
  ip_rating: string
  pool_diameter_mm_at_2700: number
  centre_lux_at_2700: number
}

export interface UserPublic {
  id: number
  email: string
  name: string
  role: 'retail' | 'trade' | 'admin'
  trade_status: string | null
  dial_mode: string
}

export interface OrderLine {
  variant_code: string
  product_name: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
}

export interface RefundView {
  id: number
  amount_cents: number
  reason: string
  kb_transaction_id: string
  created_at: string
}

export interface OrderPublic {
  order_key: string
  status: string
  display_status: string
  payment_method: string | null
  price_tier: 'retail' | 'trade'
  lines: OrderLine[]
  subtotal_cents: number
  gst_cents: number
  total_cents: number
  captured_cents: number
  refunded_cents: number
  refunds: RefundView[]
  card_last4: string | null
  purchase_order: string | null
  invoice: { kb_invoice_id: string; invoice_number: string; invoice_date: string; due_date: string } | null
  created_at: string
  customer_email?: string
}

export interface PlacementPublic {
  id: number
  variant_code: string
  ordinal: number
  x_mm: number
  y_mm: number
  beam_deg: number
  cct_k: number
  candela: number
  pool_diameter_mm: number
  own_lux: number
  centre_lux: number
}

export interface ProjectPublic {
  id: number
  name: string
  client_name: string
  owner_id: number
  is_owner: boolean
  ceiling_height_mm: number
  room_width_mm: number
  room_depth_mm: number
  cover: { status: 'ready'; url: string } | null
  lines: { variant_code: string; product_name: string; quantity: number; placed: number }[]
  placements: PlacementPublic[]
  collaborators: { user_id: number; name: string; email: string }[]
  live: boolean
}

export interface CommentPublic {
  id: string
  author_name: string
  body: string
  created_at: string
}

export interface SharePublic {
  id: string
  price_display: 'trade' | 'retail' | 'none'
  recipients: string[]
  pdf_status: 'pending' | 'waiting_for_storage' | 'ready'
  created_at: string
}

export interface StockItemPublic {
  variant_code: string
  product_name: string
  clearance_price_cents: number | null
  stock_on_hand: number
  movements: { delta: number; reason: string; order_key: string | null; note: string | null; created_at: string }[]
}

export interface TradeApplicationPublic {
  id: number
  applicant_name: string
  applicant_email: string
  business_name: string
  nzbn: string
  occupation: string
  status: string
  submitted_at: string
  decided_at: string | null
  decline_reason: string | null
}

export interface ApiErrorReply {
  error: string
  errors?: Record<string, string>
  order?: OrderPublic
  available?: number
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  body: T
}

async function request<T>(method: string, path: string, body?: unknown, extra_headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: extra_headers }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...extra_headers }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(path, init)
  const text = await response.text()
  let parsed: unknown = null
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { error: 'internal' }
    }
  }
  return { ok: response.ok, status: response.status, body: parsed as T }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, extra_headers?: Record<string, string>) => request<T>('POST', path, body, extra_headers),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export function idempotency_key(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
