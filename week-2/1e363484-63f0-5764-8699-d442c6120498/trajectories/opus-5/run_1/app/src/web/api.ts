export type OrgRole = 'admin' | 'steward' | 'member';
export type ProjectRole = 'viewer' | 'analyst' | 'sealer';
export type SensorKind = 'tower' | 'satellite';
export type FigureStatus = 'sealed' | 'broken' | 'superseded';

export interface Person {
  id: string;
  name: string;
  email: string;
  org_role: OrgRole;
}

export interface Summary {
  sealed_net_tco2e: string;
  buffer_tco2e: string;
  intact_count: number;
  broken_count: number;
  superseded_count: number;
}

export interface ProjectListEntry {
  slug: string;
  name: string;
  kind: string;
  floor_pct: string;
  buffer_pct: string;
  role: ProjectRole;
  summary: Summary;
}

export interface Sensor {
  id: string;
  kind: SensorKind;
  polygon: [number, number][];
}

export interface ProjectDetail {
  slug: string;
  name: string;
  kind: string;
  code: string;
  floor_pct: string;
  buffer_pct: string;
  lead_person_id: string;
  boundary: [number, number][];
  boundary_area_m2: number;
  sensors: Sensor[];
  record_start: string | null;
  record_end: string | null;
  role: ProjectRole;
  summary: Summary;
}

export interface TimelineDay {
  date: string;
  net_tco2e: string;
  coverage_pct: string;
}

export interface Contribution {
  sensor_id: string;
  kind: SensorKind;
  area_m2: number;
  qualifying_half_hours: number;
  half_hours: number;
  co2_tco2e: string;
  ch4_tco2e: string;
  net_tco2e: string;
}

export type BlockedReason = 'below_coverage_floor' | 'overlaps_sealed' | 'already_sealed' | 'role';

export interface Preview {
  start: string;
  end: string;
  sensor_ids: string[];
  coverage_pct: string;
  floor_pct: string;
  net_tco2e: string;
  co2_tco2e: string;
  ch4_tco2e: string;
  buffer_pct: string;
  buffer_tco2e: string;
  credited_tco2e: string;
  readings_count: number;
  fingerprint: string;
  contributions: Contribution[];
  sealable: boolean;
  blocked_reason: BlockedReason | null;
  blocking_figure_id: string | null;
}

export interface Figure {
  id: string;
  project: string;
  start: string;
  end: string;
  sensor_ids: string[];
  status: FigureStatus;
  supersedes: string | null;
  superseded_by: string | null;
  coverage_pct: string;
  floor_pct: string;
  net_tco2e: string;
  co2_tco2e: string;
  ch4_tco2e: string;
  buffer_pct: string;
  buffer_tco2e: string;
  credited_tco2e: string;
  readings_count: number;
  fingerprint: string;
  sealed_at: string;
  sealed_by: string;
  checked_at: string;
  contributions: Contribution[];
  evidence: { readings_key: string; derivation_key: string };
  rederived?: { fingerprint: string; coverage_pct: string; net_tco2e: string; matches: boolean };
}

export interface LedgerEntry {
  id: string;
  figure_id: string;
  kind: 'issuance' | 'buffer' | 'reversal';
  tco2e: string;
  reverses: string | null;
  recorded_at: string;
}

export interface Ledger {
  entries: LedgerEntry[];
  balance_tco2e: string;
  buffer_tco2e: string;
}

export interface MovedReading {
  sensor_id: string;
  interval_start: string;
  old: { fc: string; fch4: string; qc: number } | null;
  new: { fc: string; fch4: string; qc: number };
  revised_at: string;
  batch_id: string;
}

export interface RegulatorLinkRow {
  id: string;
  token: string;
  url: string;
  status: 'live' | 'expired' | 'revoked';
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface PublicFigure {
  link: { status: 'live'; expires_at: string };
  project: { name: string; kind: string };
  figure: Figure;
}

export interface AccessData {
  people: Person[];
  projects: { slug: string; name: string }[];
  grants: { person_id: string; project: string; role: ProjectRole }[];
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.error === 'string' ? payload.error : `http_${status}`);
    this.status = status;
    this.code = typeof payload.error === 'string' ? payload.error : `http_${status}`;
    this.payload = payload;
  }
}

/** A request that never reached an answer: no status, so a seal may be retried safely. */
export class NoAnswer extends Error {}

export function hasStatus(error: unknown, status: number): boolean {
  return error instanceof ApiFailure && error.status === status;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer =
    options.timeoutMs === undefined
      ? null
      : setTimeout(() => controller.abort(), options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch {
    throw new NoAnswer('no answer');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new ApiFailure(
      response.status,
      (payload ?? {}) as Record<string, unknown>,
    );
  }
  return payload as T;
}

export const api = {
  signIn: (email: string, password: string) =>
    request<{ person: Person }>('/api/session', { method: 'POST', body: { email, password } }),
  signOut: () => request<void>('/api/session', { method: 'DELETE' }),
  me: () => request<{ person: Person }>('/api/me'),
  projects: () => request<{ projects: ProjectListEntry[] }>('/api/projects'),
  project: (slug: string) => request<ProjectDetail>(`/api/projects/${slug}`),
  timeline: (slug: string, from: string, to: string) =>
    request<{ days: TimelineDay[] }>(
      `/api/projects/${slug}/timeline?from=${from}&to=${to}`,
    ),
  preview: (slug: string, start: string, end: string, sensorIds: string[]) =>
    request<Preview>(`/api/projects/${slug}/preview`, {
      method: 'POST',
      body: { start, end, sensor_ids: sensorIds },
    }),
  seal: (
    slug: string,
    body: { start: string; end: string; sensor_ids: string[]; preview_fingerprint: string },
    idempotencyKey: string,
  ) =>
    request<Figure>(`/api/projects/${slug}/figures`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
      timeoutMs: 15_000,
    }),
  figures: (slug: string) =>
    request<{ figures: Figure[]; summary: Summary }>(`/api/projects/${slug}/figures`),
  ledger: (slug: string) => request<Ledger>(`/api/projects/${slug}/ledger`),
  figure: (id: string) => request<Figure>(`/api/figures/${id}`),
  figureAudit: (id: string) =>
    request<{ figure_id: string; moved: MovedReading[] }>(`/api/figures/${id}/audit`),
  issueLink: (figureId: string) =>
    request<RegulatorLinkRow>(`/api/figures/${figureId}/links`, { method: 'POST', body: {} }),
  links: (figureId: string) =>
    request<{ links: RegulatorLinkRow[] }>(`/api/figures/${figureId}/links`),
  revokeLink: (figureId: string, linkId: string) =>
    request<{ id: string; status: string; revoked_at: string }>(
      `/api/figures/${figureId}/links/${linkId}/revoke`,
      { method: 'POST', body: {} },
    ),
  publicFigure: (token: string) => request<PublicFigure>(`/api/public/links/${token}`),
  rederive: (token: string) =>
    request<PublicFigure>(`/api/public/links/${token}/rederive`, { method: 'POST', body: {} }),
  publicAudit: (token: string) =>
    request<{ figure_id: string; moved: MovedReading[] }>(`/api/public/links/${token}/audit`),
  access: () => request<AccessData>('/api/access'),
  setGrant: (slug: string, personId: string, role: ProjectRole) =>
    request<{ person_id: string; project: string; role: ProjectRole }>(
      `/api/projects/${slug}/grants/${personId}`,
      { method: 'PUT', body: { role } },
    ),
  removeGrant: (slug: string, personId: string) =>
    request<void>(`/api/projects/${slug}/grants/${personId}`, { method: 'DELETE' }),
};
