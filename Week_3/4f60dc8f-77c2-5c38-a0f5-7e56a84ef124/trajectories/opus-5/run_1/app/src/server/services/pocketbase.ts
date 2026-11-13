import { config } from '../config.js';
import { AppError } from '../http/app-error.js';
import {
  SCENE_ACCENTS,
  SCENE_PRIMITIVES,
  type CaseStudy,
  type Insight,
  type SceneAccent,
  type ScenePrimitive,
  type Service,
  type StudioContent,
  type TeamMember,
} from '../../shared/domain.js';

export class ContentUnavailable extends AppError {
  constructor() {
    super('content_unavailable');
  }
}

type AuthState = { token: string; fetchedAt: number };
let auth: AuthState | null = null;

const authenticate = async (): Promise<string> => {
  if (auth !== null && Date.now() - auth.fetchedAt < 10 * 60_000) return auth.token;
  const response = await request('/api/admins/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({
      identity: config.pocketbase.adminEmail,
      password: config.pocketbase.adminPassword,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new ContentUnavailable();
  const body = (await response.json()) as { token?: string };
  if (typeof body.token !== 'string') throw new ContentUnavailable();
  auth = { token: body.token, fetchedAt: Date.now() };
  return auth.token;
};

const request = async (path: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetch(`${config.pocketbase.url}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ContentUnavailable();
  }
};

const api = async <T>(
  path: string,
  init: RequestInit = {},
  expect: number[] = [200],
): Promise<T> => {
  const token = await authenticate();
  const response = await request(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: token,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });
  if (response.status === 401 || response.status === 403) {
    auth = null;
    throw new ContentUnavailable();
  }
  if (response.status >= 500) throw new ContentUnavailable();
  if (!expect.includes(response.status)) {
    const text = await response.text().catch(() => '');
    throw new Error(`PocketBase ${init.method ?? 'GET'} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  }
  return (await response.json()) as T;
};

export const contentUp = async (): Promise<boolean> => {
  try {
    const response = await request('/api/health', { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
};

type CollectionField = { name: string; type: string; options: Record<string, unknown> };

const text = (name: string): CollectionField => ({ name, type: 'text', options: {} });
const number = (name: string): CollectionField => ({ name, type: 'number', options: {} });
const editor = (name: string): CollectionField => ({ name, type: 'editor', options: {} });

const COLLECTIONS: { name: string; schema: CollectionField[] }[] = [
  {
    name: 'case_studies',
    schema: [
      text('slug'),
      text('title'),
      text('client'),
      editor('summary'),
      { name: 'primitives', type: 'json', options: { maxSize: 2_000_000 } },
      text('accent'),
      { name: 'published', type: 'bool', options: {} },
      number('sort'),
    ],
  },
  {
    name: 'services',
    schema: [
      text('code'),
      text('title'),
      number('list_price_pence'),
      number('azimuth_deg'),
      number('elevation_deg'),
      number('sort'),
    ],
  },
  { name: 'team', schema: [text('name'), text('role'), editor('bio'), number('sort')] },
  { name: 'insights', schema: [text('slug'), text('title'), editor('summary'), number('sort')] },
  { name: 'marquee', schema: [text('name'), number('sort')] },
];

export const ensureCollections = async (): Promise<void> => {
  const existing = await api<{ items: { name: string }[] }>('/api/collections?perPage=200');
  const names = new Set(existing.items.map((item) => item.name));
  for (const collection of COLLECTIONS) {
    if (names.has(collection.name)) continue;
    await api(
      '/api/collections',
      { method: 'POST', body: JSON.stringify({ type: 'base', ...collection }) },
      [200, 400],
    );
  }
};

type Record_ = { id: string } & Record<string, unknown>;

const listAll = async (collection: string): Promise<Record_[]> => {
  const result = await api<{ items: Record_[] }>(
    `/api/collections/${collection}/records?perPage=500&sort=sort`,
  );
  return result.items;
};

const asPrimitives = (value: unknown): ScenePrimitive[] => {
  const list = Array.isArray(value) ? value : [];
  return list.filter((entry): entry is ScenePrimitive =>
    (SCENE_PRIMITIVES as readonly string[]).includes(entry as string),
  );
};

const asAccent = (value: unknown): SceneAccent =>
  (SCENE_ACCENTS as readonly string[]).includes(value as string)
    ? (value as SceneAccent)
    : 'ember';

const toCaseStudy = (record: Record_): CaseStudy => ({
  slug: String(record.slug ?? ''),
  title: String(record.title ?? ''),
  client: String(record.client ?? ''),
  summary: String(record.summary ?? ''),
  scene: { primitives: asPrimitives(record.primitives), accent: asAccent(record.accent) },
  published: record.published === true,
  sort: Number(record.sort ?? 0),
});

const toService = (record: Record_): Service => ({
  code: String(record.code ?? ''),
  title: String(record.title ?? ''),
  list_price_pence: Number(record.list_price_pence ?? 0),
  azimuth_deg: Number(record.azimuth_deg ?? 0),
  elevation_deg: Number(record.elevation_deg ?? 0),
  sort: Number(record.sort ?? 0),
});

export const loadContent = async (): Promise<StudioContent & { allCaseStudies: CaseStudy[] }> => {
  const [caseStudies, services, team, insights, marquee] = await Promise.all([
    listAll('case_studies'),
    listAll('services'),
    listAll('team'),
    listAll('insights'),
    listAll('marquee'),
  ]);
  const allCaseStudies = caseStudies.map(toCaseStudy).sort((a, b) => a.sort - b.sort);
  return {
    allCaseStudies,
    case_studies: allCaseStudies.filter((entry) => entry.published),
    services: services.map(toService).sort((a, b) => a.sort - b.sort),
    team: team.map(
      (record): TeamMember => ({
        name: String(record.name ?? ''),
        role: String(record.role ?? ''),
        bio: String(record.bio ?? ''),
      }),
    ),
    insights: insights.map(
      (record): Insight => ({
        slug: String(record.slug ?? ''),
        title: String(record.title ?? ''),
        summary: String(record.summary ?? ''),
      }),
    ),
    marquee: marquee.map((record) => String(record.name ?? '')),
  };
};

export const findRecordId = async (
  collection: string,
  field: string,
  value: string,
): Promise<string | null> => {
  const result = await api<{ items: Record_[] }>(
    `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(`${field}="${value}"`)}`,
  );
  return result.items[0]?.id ?? null;
};

export const createRecord = async (
  collection: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await api(`/api/collections/${collection}/records`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const updateRecord = async (
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await api(`/api/collections/${collection}/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
};
