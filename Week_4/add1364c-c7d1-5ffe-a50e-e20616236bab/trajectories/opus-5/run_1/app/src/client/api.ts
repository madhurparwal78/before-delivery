export type Role = 'office_manager' | 'managing_partner' | 'staff_accountant' | 'outside_bookkeeper';

export type Person = {
  id: string;
  full_name: string;
  email: string;
  handle: string;
  role: Role;
  aliases: string[];
  status: 'invited' | 'active' | 'travelling' | 'on_term' | 'left';
  vault_ids: string[];
  term: { starts_on: string; ends_on: string } | null;
  travel: { id: string; starts_at: string; ends_at: string }[];
  seat: 'confirmed' | 'waiting_on_billing' | 'release_waiting' | 'released';
  left_at: string | null;
};

export type Rule = {
  id: string;
  vault_id: string;
  min_length: number;
  effective_on: string;
  state: 'drafted' | 'scheduled' | 'in_force' | 'superseded';
  version: number;
  drafted_by: string | null;
  signed_by: string | null;
  stub_text: string | null;
};

export type Vault = {
  id: string;
  name: string;
  formerly: string | null;
  off_when_travelling: boolean;
  rule_in_force: { id: string; min_length: number; effective_on: string } | null;
  pending_rules: Rule[];
  credential_count: number;
};

export type Credential = {
  id: string;
  vault_id: string;
  vendor: { id: string; name: string; domain: string; formerly: string | null } | null;
  label: string;
  username: string;
  held_by: { person_id: string; name: string; left: boolean }[];
  next_turn: { office_date: string; office_time: string; offset: string } | null;
  health: 'sound' | 'out_of_policy' | 'exposed' | 'vendor_breached' | 'not_checked';
  out_of_policy: boolean;
  out_of_policy_since: string | null;
  leeway_ends_at: string | null;
  rule_id: string | null;
  last_turned_on: string;
};

export type AsOfVault = {
  vault_id: string;
  name: string;
  rule_in_force: { id: string; min_length: number; effective_on: string } | null;
  cylinder: 'pending' | 'in_force';
  stubs: { rule_id: string; version: number; min_length: number; text: string; in_force: boolean }[];
  out_of_policy_count: number;
};

export type AsOf = {
  night: string;
  offset: string;
  starts_at: string;
  out_of_policy_count: number;
  vaults: AsOfVault[];
};

export type Clock = {
  now: string;
  office_date: string;
  office_time: string;
  offset: string;
  time_zone: string;
};

export type ReviewHead = {
  id: string;
  quarter: string;
  opened_on: string;
  overdue_from: string;
  status: 'open' | 'overdue' | 'signed_off';
  signed_off_by: string | null;
};

export type ReviewLine = {
  id: string;
  person_id: string;
  person_name: string;
  vault_id: string;
  vault_name: string;
  vault_formerly: string | null;
  vendors: { name: string; formerly: string | null }[];
  decision: 'undecided' | 'kept' | 'removed';
  decided_by: string | null;
  decided_via: 'review' | 'scope_change' | null;
};

export type Review = ReviewHead & { decided: number; total: number; lines: ReviewLine[] };

export type Billing = {
  reachable: boolean;
  seats: number | null;
  seat_price: string;
  currency: string;
  next_invoice: { date: string; amount: string } | null;
  licence_term_ends_on: string | null;
  waiting: { person_id: string; name: string; change: 'add' | 'release'; since: string }[];
};

export type HealthReport = {
  office_date: string;
  feed: 'ok' | 'unreachable';
  last_good_check_at: string | null;
  counts: {
    exposed: number;
    vendor_breached: number;
    out_of_policy: number;
    turns_due: number;
    turns_overdue: number;
  };
  credentials: Credential[];
};

export type CalendarEntry = {
  turn_id: string | null;
  rotation_id: string | null;
  credential_id: string;
  label: string;
  vendor: { name: string; formerly: string | null };
  kind: 'scheduled' | 'scope_loss';
  office_time: string | null;
  offset: string;
  at: string | null;
  shifted: boolean;
  due_by: string;
  state: 'scheduled' | 'due' | 'overdue' | 'turned';
};

export type Calendar = { month: string; days: { office_date: string; offset: string; entries: CalendarEntry[] }[] };

export type ImportRow = {
  row: number;
  outcome: 'created' | 'matched' | 'held' | 'rejected';
  credential_id: string | null;
  reason: string | null;
  names: {
    text: string;
    match: 'email' | 'full_name' | 'alias' | 'chosen' | 'not_on_record' | null;
    person_id: string | null;
    held: 'no_match' | 'ambiguous' | null;
    candidates: { person_id: string; full_name: string }[];
  }[];
};

export type ImportRun = {
  id: string;
  filename: string;
  counts: { created: number; matched: number; held: number; rejected: number };
  rows: ImportRow[];
};

export type AuditEntry = {
  id: string;
  seq: number;
  at: string;
  office_day: string;
  office_time: string;
  offset: string;
  actor: { person_id: string; name: string } | { system: string };
  action: string;
  subject: { kind: string; id: string | null; name: string };
  details: Record<string, unknown>;
};

export type AuditPage = {
  office_day: string;
  order: string;
  entries: AuditEntry[];
  next_cursor: string | null;
};

export type Vendor = {
  id: string;
  name: string;
  domain: string;
  formerly: string | null;
  renames: { old: string; new: string; by: string; at: string }[];
};

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type Options = { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal };

export async function request<T>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
    signal: options.signal ?? null,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const body = payload as { error?: { code?: string; message?: string }; fields?: Record<string, string> };
    throw new ApiFailure(
      response.status,
      body?.error?.code ?? 'server_error',
      body?.error?.message ?? 'Something went wrong.',
      body?.fields ?? {},
    );
  }
  return payload as T;
}
