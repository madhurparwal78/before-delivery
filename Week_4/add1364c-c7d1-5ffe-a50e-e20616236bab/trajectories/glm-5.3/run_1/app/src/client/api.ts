/** Client API helpers and shared types. */

export interface Person {
  id: string;
  full_name: string;
  email: string;
  handle: string;
  role: string;
  aliases: string[];
  status: string;
  vault_ids: string[];
  term: { starts_on: string; ends_on: string } | null;
  travel: Array<{ id: string; starts_at: string; ends_at: string }>;
  seat: 'confirmed' | 'waiting_on_billing' | 'release_waiting' | 'released';
  left_at: string | null;
}

export interface Rule {
  id: string;
  vault_id: string;
  min_length: number;
  effective_on: string;
  state: string;
  version: number;
  drafted_by: string;
  signed_by: string | null;
  stub_text: string | null;
}

export interface Vault {
  id: string;
  name: string;
  formerly: string | null;
  off_when_travelling: boolean;
  rule_in_force: { id: string; min_length: number; effective_on: string } | null;
  pending_rules: Rule[];
  credential_count: number;
}

export interface Credential {
  id: string;
  vault_id: string;
  vendor: { id: string; name: string; domain: string; formerly: string | null };
  label: string;
  username: string;
  held_by: Array<{ person_id: string; name: string; left: boolean }>;
  next_turn: { office_date: string; office_time: string; offset: string } | null;
  health: string;
  out_of_policy: boolean;
  out_of_policy_since: string | null;
  leeway_ends_at: string | null;
  rule_id: string | null;
  last_turned_on: string | null;
}

export interface AsOfAnswer {
  night: string;
  offset: string;
  starts_at: string;
  out_of_policy_count: number;
  vaults: Array<{
    vault_id: string;
    name: string;
    rule_in_force: { id: string; min_length: number; effective_on: string } | null;
    cylinder: 'pending' | 'in_force';
    stubs: Array<{ rule_id: string; version: number; min_length: number; text: string; in_force: boolean }>;
    out_of_policy_count: number;
  }>;
}

export interface ClockAnswer {
  now: string;
  office_date: string;
  office_time: string;
  offset: string;
  time_zone: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const err = parsed as ApiErrorBody | null;
    const code = err?.error?.code ?? 'unknown';
    // A signed-out request goes to the sign-in screen with next; the page keeps no secret.
    if (res.status === 401 && code === 'signed_out') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/sign-in?next=${next}`;
      throw new ApiError(res.status, code, err?.error?.message ?? 'Sign in to use the drawer.', err?.error?.fields);
    }
    throw new ApiError(
      res.status,
      code,
      err?.error?.message ?? 'Something went wrong.',
      err?.error?.fields
    );
  }
  return parsed as T;
}

/** The published office date display: `Fri 1 Jan`. */
export function displayOfficeDate(dateStr: string): string {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${weekdays[dt.getUTCDay()]} ${d} ${months[m - 1]} ${y}`;
}

/** The office stamp for the drawer's clock, from the server's answer. */
export function displayStamp(clock: ClockAnswer): string {
  return `${displayOfficeDateShort(clock.office_date)}, ${clock.office_time} ${clock.offset}`;
}

function displayOfficeDateShort(dateStr: string): string {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${weekdays[dt.getUTCDay()]} ${d} ${months[m - 1]}`;
}
