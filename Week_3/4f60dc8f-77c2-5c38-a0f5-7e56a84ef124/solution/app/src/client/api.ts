// Same-origin JSON calls; every failure comes back in the API's one error shape.
export type ApiFailure = { error: string; message: string; fields?: Record<string, string> };
type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; failure: ApiFailure };

const NETWORK: ApiFailure = { error: "network", message: "The connection dropped. Check it and try again." };

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, failure: NETWORK };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const failure = parsed && typeof parsed === "object" && "message" in parsed ? (parsed as ApiFailure) : NETWORK;
  return { ok: false, status: response.status, failure };
}

export function newKey(): string {
  return crypto.randomUUID();
}

/** Sends the browser to sign in when a client page answers 401, keeping where it was. */
export function toSignIn(): void {
  location.assign(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
}

// ---------- shapes the pages read ----------

export type Currency = "GBP" | "EUR" | "USD" | "JPY";
type QuoteLine = { shot_code: string; title: string; quantity: number; unit_price_gbp_minor: number; amount_minor: number };
export type Quote = {
  currency: Currency;
  exponent: number;
  revision: number;
  fx_rate: string;
  fx_locked: boolean;
  fx_locked_at: string | null;
  lines: QuoteLine[];
  subtotal_minor: number;
  vat_minor: number;
  total_minor: number;
  milestones: { deposit_minor: number; look_dev_minor: number; final_delivery_minor: number };
};
export type Dimensions = { x: number; y: number; z: number };
export type IntakeFile = {
  id: string;
  name: string;
  kind: "model" | "step" | "reference";
  size_bytes: number;
  status: "received" | "superseded";
  measurement: "pending" | "delayed" | "measured" | "failed" | null;
  needs_unit_confirmation: boolean;
  unit: "as_exported" | "mm" | "cm" | "in" | null;
  dimensions_m: Dimensions | null;
  dimensions_mm: Dimensions | null;
};
export type Invoice = {
  id: string;
  milestone: "deposit" | "look_dev" | "final_delivery";
  number: string | null;
  status: "draft" | "issued" | "paid" | "payment_failed" | "overdue" | "void";
  lines: { description: string; amount_minor: number }[];
  amount_minor: number;
  balance_minor: number;
  currency: Currency;
  failed_attempts: number;
  issued_at: string | null;
  overdue_at: string | null;
};
export type LedgerEntry = { id: string; kind: "deposit" | "invoice_payment" | "refund"; amount_minor: number; currency: Currency; invoice_id: string | null; created_at: string };
export type Engagement = {
  id: string;
  reference: string;
  title: string;
  state: string;
  brand: { id: string; name: string; currency: Currency };
  finance_email: string;
  quote: Quote;
  files: IntakeFile[];
  invoices: Invoice[];
  ledger: LedgerEntry[];
  revision_rounds: { look_dev: number; final_delivery: number };
  stills?: { id: string; shot_code: string; milestone: string }[];
  review_link?: { expires_at: string } | null;
};
export type Primitive = "box" | "cylinder" | "sphere" | "torus" | "capsule";
export type Accent = "ember" | "cobalt" | "violet";
export type CaseStudy = { slug: string; title: string; client: string; summary: string; scene: { primitives: Primitive[]; accent: Accent }; published: boolean; sort: number };
export type Service = { code: string; title: string; list_price_pence: number; azimuth_deg: number; elevation_deg: number; sort: number };
export type Content = { case_studies: CaseStudy[]; services: Service[]; team: { name: string; role: string; bio: string }[]; insights: { slug: string; title: string; summary: string }[]; marquee: string[] };
