// The two third-party services behind WireMock, read only in answer to a person's action
// (and, for a render it started, by the server's own poll).

import { COPY } from '../shared/copy';
import { dateIn, TOWN_ZONES } from '../shared/time';
import { config } from './config';
import { unavailable } from './http';

const PROVIDER_WAIT_MS = 5000;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.wiremockUrl}${path}`, { ...init, signal: AbortSignal.timeout(PROVIDER_WAIT_MS) });
}

// Hollowreed Music --------------------------------------------------------------------------------

interface Track {
  id: string;
  title: string;
  composer: string;
  seconds: number;
}

interface TrackPage {
  tracks: Track[];
  nextCursor: string | null;
}

const libraryDown = () => unavailable(COPY.libraryDown);
const searches = new Map<string, { until: number; page: TrackPage }>();

export async function searchTracks(q: string, cursor: string | null, now: number): Promise<TrackPage> {
  const key = JSON.stringify([q, cursor]);
  const cached = searches.get(key);
  if (cached && cached.until > now) return cached.page;
  const params = new URLSearchParams({ q });
  if (cursor) params.set('cursor', cursor);
  let page: TrackPage;
  try {
    const response = await call(`/v2/tracks?${params}`);
    if (response.status !== 200) throw libraryDown();
    const answer = (await response.json()) as Partial<TrackPage>;
    if (!Array.isArray(answer.tracks)) throw libraryDown();
    page = { tracks: answer.tracks, nextCursor: answer.nextCursor ?? null };
  } catch {
    throw libraryDown();
  }
  searches.set(key, { until: now + config.cueCacheSeconds * 1000, page });
  return page;
}

/** The fee of the newest price row in effect today; no row in effect counts as unavailable. */
export async function currentFee(now: number): Promise<string> {
  const today = dateIn(now, TOWN_ZONES.amsterdam);
  let prices: { validFrom: string; perMarket: string }[];
  try {
    const response = await call('/v2/prices');
    if (response.status !== 200) throw libraryDown();
    prices = ((await response.json()) as { prices: typeof prices }).prices;
  } catch {
    throw libraryDown();
  }
  const inEffect = prices.filter((row) => row.validFrom <= today).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  if (!inEffect[0]) throw libraryDown();
  return inEffect[0].perMarket;
}

export async function buyLicence(body: { trackId: string; market: string; from: string; until: string; fee: string }): Promise<string> {
  try {
    const response = await call('/v2/licences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status !== 201) throw libraryDown();
    return ((await response.json()) as { licenceId: string }).licenceId;
  } catch {
    throw libraryDown();
  }
}

// Quaymill Render ---------------------------------------------------------------------------------

type RenderAsk = { kind: 'started'; providerId: string } | { kind: 'busy'; retryAfterSeconds: number } | { kind: 'unavailable' };

interface RenderBody {
  cutId: string;
  frameRate: string;
  width: number;
  burnTimecode: boolean;
  clips: { frame: number; durationFrames: number; sha256: string | null }[];
}

function retryAfter(response: Response): number {
  return Math.max(1, Number(response.headers.get('retry-after')) || 1);
}

export async function askForRender(body: RenderBody): Promise<RenderAsk> {
  try {
    const response = await call('/v1/renders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `${body.cutId}-${body.width}-${body.burnTimecode}` },
      body: JSON.stringify(body),
    });
    if (response.status === 429) return { kind: 'busy', retryAfterSeconds: retryAfter(response) };
    if (response.status !== 202) return { kind: 'unavailable' };
    const answer = (await response.json()) as { id?: unknown };
    return typeof answer.id === 'string' ? { kind: 'started', providerId: answer.id } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

type RenderPoll =
  | { kind: 'working'; state: 'queued' | 'running'; progress: number }
  | { kind: 'done'; url: string; size: number; sha256: string }
  | { kind: 'failed' }
  | { kind: 'busy'; retryAfterSeconds: number }
  | { kind: 'later' };

export async function pollRender(providerId: string): Promise<RenderPoll> {
  try {
    const response = await call(`/v1/renders/${encodeURIComponent(providerId)}`);
    if (response.status === 429) return { kind: 'busy', retryAfterSeconds: retryAfter(response) };
    if (response.status !== 200) return { kind: 'later' };
    const answer = (await response.json()) as { state?: string; progress?: number; url?: string; size?: number; sha256?: string };
    if (answer.state === 'queued') return { kind: 'working', state: 'queued', progress: 0 };
    if (answer.state === 'running') return { kind: 'working', state: 'running', progress: answer.progress ?? 0 };
    if (answer.state === 'failed') return { kind: 'failed' };
    if (answer.state === 'done' && answer.url) return { kind: 'done', url: answer.url, size: answer.size ?? -1, sha256: answer.sha256 ?? '' };
    return { kind: 'later' };
  } catch {
    return { kind: 'later' };
  }
}

/** The film's bytes, or null when the service could not hand them over this time. */
export async function fetchFilm(url: string): Promise<Buffer | null> {
  try {
    const response = await call(url);
    return response.status === 200 ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
