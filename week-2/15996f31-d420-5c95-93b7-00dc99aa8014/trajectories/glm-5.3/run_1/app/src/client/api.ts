/** Shared client types and the API fetch helper. */

export interface User {
  id: string;
  name: string;
  role: "broker" | "beekeeper" | "grower";
}

export interface OrchardListEntry {
  id: string;
  name: string;
  county: string;
  blocks: { id: string; name: string; acres: number }[];
  orders: { id: string; ref: string; status: string; bloom_start: string }[];
  grower?: { id: string; name: string };
}

export interface OrderBlock {
  id: string;
  name: string;
  acres?: number;
  hives_ordered: number;
  hives_delivered?: number;
  sample_count?: number;
  average_frames: number | null;
  tier: string | null;
  payable_cents?: number;
  placements?: Placement[];
}

export interface Placement {
  yard_name: string;
  hives: number;
  delivered_on: string;
  average_frames: number | null;
  drop_id?: string;
  beekeeper?: { id: string; name: string };
  status?: string;
  pay_per_hive_cents?: number | null;
  payout_cents?: number | null;
}

export interface Order {
  id: string;
  ref: string;
  status: string;
  settlement_status: string;
  orchard: { id: string; name: string; county: string };
  bloom_start: string;
  bloom_end: string;
  delivery_deadline: string;
  hives_ordered: number;
  hives_delivered?: number;
  deposit_cents?: number;
  payable_cents?: number;
  report_available?: boolean;
  blocks?: OrderBlock[];
  grower?: { id: string; name: string };
  hives_committed?: number;
  rule_set?: { id: string; name: string };
  commission_bps?: number;
  commission_cents?: number;
  inspection_link?: {
    id: string;
    status: string;
    inspector_email: string;
    expires_at: string;
  } | null;
  hives_remaining?: number;
  pay_per_hive_cents?: Record<string, number>;
  my_drops?: Drop[];
}

export interface Drop {
  id: string;
  order: { id: string; ref: string };
  orchard: { id: string; name: string };
  yard_name: string;
  hives: number;
  status: string;
  block: { id: string; name: string } | null;
  delivered_on: string | null;
  average_frames: number | null;
  block_average_frames: number | null;
  tier: string | null;
  pay_per_hive_cents: number | null;
  payout_cents: number | null;
  dispute_reason: string | null;
  resolution_note: string | null;
  photos: { id: string; colony_label: string; url: string }[];
  beekeeper?: { id: string; name: string };
}

export interface Settlement {
  status: string;
  payment_received_on: string | null;
  rule_set: { id: string; name: string };
  payable_cents: number;
  commission_bps: number;
  commission_cents: number;
  shares: { beekeeper: { id: string; name: string }; hives: number; gross_cents: number; payout_cents: number }[];
}

export interface SheetBlock {
  id: string;
  name: string;
  hives_delivered: number;
  samples_required: number;
  sample_count: number;
  average_frames: number | null;
  tier: string | null;
  payable_cents: number;
  yards: { drop_id: string; yard_name: string; hives: number }[];
  samples: { id: string; drop_id: string; colony_label: string; frames: number; photos: { id: string; url: string }[] }[];
}

export interface Sheet {
  order: { ref: string };
  orchard: { name: string; county: string };
  link: { status: string; expires_at: string };
  blocks: SheetBlock[];
  payable_cents: number;
}

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly remaining: number | undefined;

  constructor(status: number, code: string, message: string, fields: Record<string, string>, remaining?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.remaining = remaining;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string; formData?: FormData } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "same-origin",
  });
  if (response.status === 204) {
    return { status: 204, body: undefined as T };
  }
  const text = await response.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!response.ok && parsed && typeof parsed === "object" && "error" in parsed) {
    const errorBody = parsed as { error: string; message: string; fields?: Record<string, string>; remaining?: number };
    throw new ApiProblem(
      response.status,
      errorBody.error,
      errorBody.message,
      errorBody.fields ?? {},
      errorBody.remaining,
    );
  }
  return { status: response.status, body: parsed as T };
}

export function problemOf(error: unknown): ApiProblem | null {
  return error instanceof ApiProblem ? error : null;
}

export function networkProblem(): ApiProblem {
  return new ApiProblem(0, "network", "Bloom Desk can't reach its server. Check your connection and try again.", {});
}
