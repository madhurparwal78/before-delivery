import { config, PROVIDER_TIMEOUT_MS } from '../config.js';
import type { FrameRate } from '../../domain/timecode.js';
import type { LicenceMarket } from '../../domain/time.js';

/** A later answer, a dropped connection or an unpublished status counts as unavailable. */
export class ProviderDown extends Error {}

/** A 429 with Retry-After means no call before that instant. */
export class ProviderBusy extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('provider busy');
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${config.wiremockUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    throw new ProviderDown('provider unreachable');
  }
}

function readRetryAfter(response: Response): number {
  const header = response.headers.get('retry-after');
  const value = header === null ? Number.NaN : Number(header);
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : 60;
}

export type Track = { id: string; title: string; composer: string; seconds: number };

export type TrackPage = { tracks: Track[]; nextCursor: string | null };

export async function searchTracks(text: string, cursor: string | null): Promise<TrackPage> {
  const query = new URLSearchParams({ q: text });
  if (cursor !== null) query.set('cursor', cursor);
  const response = await call(`/v2/tracks?${query.toString()}`);
  if (response.status === 429) throw new ProviderBusy(readRetryAfter(response));
  if (response.status !== 200) throw new ProviderDown(`tracks said ${response.status}`);
  const body = (await response.json()) as Partial<TrackPage>;
  if (!Array.isArray(body.tracks)) throw new ProviderDown('tracks answered no list');
  return { tracks: body.tracks, nextCursor: body.nextCursor ?? null };
}

export type PriceRow = { validFrom: string; perMarket: string };

export async function readPrices(): Promise<PriceRow[]> {
  const response = await call('/v2/prices');
  if (response.status === 429) throw new ProviderBusy(readRetryAfter(response));
  if (response.status !== 200) throw new ProviderDown(`prices said ${response.status}`);
  const body = (await response.json()) as { prices?: PriceRow[] };
  if (!Array.isArray(body.prices)) throw new ProviderDown('prices answered no list');
  return body.prices;
}

export async function takeLicence(request: {
  trackId: string;
  market: LicenceMarket;
  from: string;
  until: string;
  fee: string;
}): Promise<string> {
  const response = await call('/v2/licences', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (response.status === 429) throw new ProviderBusy(readRetryAfter(response));
  if (response.status !== 201) throw new ProviderDown(`licences said ${response.status}`);
  const body = (await response.json()) as { licenceId?: string };
  if (typeof body.licenceId !== 'string') throw new ProviderDown('licences answered no id');
  return body.licenceId;
}

export type RenderClip = { frame: number; durationFrames: number; sha256: string | null };

export async function askForRender(request: {
  cutId: string;
  frameRate: FrameRate;
  width: number;
  burnTimecode: boolean;
  clips: RenderClip[];
}): Promise<string> {
  const response = await call('/v1/renders', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': `${request.cutId}-${request.width}-${request.burnTimecode}`,
    },
    body: JSON.stringify(request),
  });
  if (response.status === 429) throw new ProviderBusy(readRetryAfter(response));
  if (response.status !== 202) throw new ProviderDown(`renders said ${response.status}`);
  const body = (await response.json()) as { id?: string };
  if (typeof body.id !== 'string') throw new ProviderDown('renders answered no id');
  return body.id;
}

export type RenderProgress =
  | { state: 'queued' }
  | { state: 'running'; progress: number }
  | { state: 'done'; url: string; size: number; sha256: string }
  | { state: 'failed'; reason: string };

export async function readRender(providerId: string): Promise<RenderProgress> {
  const response = await call(`/v1/renders/${encodeURIComponent(providerId)}`);
  if (response.status === 429) throw new ProviderBusy(readRetryAfter(response));
  if (response.status !== 200) throw new ProviderDown(`render said ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  switch (body['state']) {
    case 'queued':
      return { state: 'queued' };
    case 'running':
      return { state: 'running', progress: Number(body['progress'] ?? 0) };
    case 'done':
      if (
        typeof body['url'] !== 'string' ||
        typeof body['size'] !== 'number' ||
        typeof body['sha256'] !== 'string'
      ) {
        throw new ProviderDown('render answered an incomplete done');
      }
      return {
        state: 'done',
        url: body['url'],
        size: body['size'],
        sha256: body['sha256'],
      };
    case 'failed':
      return { state: 'failed', reason: String(body['reason'] ?? '') };
    default:
      throw new ProviderDown('render answered an unpublished state');
  }
}

export async function downloadFilm(path: string): Promise<Buffer> {
  const response = await call(path);
  if (response.status === 429) throw new ProviderBusy(readRetryAfter(response));
  if (response.status !== 200) throw new ProviderDown(`film said ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
