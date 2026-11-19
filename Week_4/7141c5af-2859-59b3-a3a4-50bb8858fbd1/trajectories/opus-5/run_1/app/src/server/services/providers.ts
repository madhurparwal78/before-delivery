/**
 * The supplier and the courier, both reached only through WIREMOCK_URL. The app
 * waits at most five seconds and then treats the provider as unavailable.
 */
import { PROVIDER_TIMEOUT_MS, type Config } from '../config.ts';

export class ProviderUnavailable extends Error {
  constructor(cause?: unknown) {
    super('provider unavailable');
    this.name = 'ProviderUnavailable';
    this.cause = cause;
  }
}

/** A 429 with its Retry-After read as an instant. */
export class ProviderBusy extends Error {
  readonly retryAt: number;
  constructor(retryAt: number) {
    super('provider busy');
    this.name = 'ProviderBusy';
    this.retryAt = retryAt;
  }
}

/** The courier's own refusal of a time already taken. */
export class SlotTaken extends Error {
  constructor() {
    super('slot taken');
    this.name = 'SlotTaken';
  }
}

export interface SupplierMaterial {
  code: string;
  name: string;
  family: string;
  unit: 'sqFt' | 'metre';
  prices: Record<string, string>;
}

export interface SupplierLot {
  lot: string;
  hides?: number;
  averageSqFt?: string;
  metres?: string;
}

export interface CourierQuote {
  quoteId: string;
  amount: string;
  currency: string;
}

export interface CourierCollection {
  id: string;
  state: 'booked' | 'collected' | 'delivered';
  labelPath: string;
}

function readRetryAfter(header: string | null, now: number): number {
  if (!header) return now + 60_000;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return now + Math.max(0, Math.ceil(asSeconds)) * 1000;
  const asDate = Date.parse(header);
  return Number.isFinite(asDate) ? asDate : now + 60_000;
}

export class Providers {
  constructor(private readonly config: Config) {}

  private async call(
    path: string,
    init: RequestInit = {},
    now = Date.now(),
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.config.wiremockUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new ProviderUnavailable(cause);
    }
    if (res.status === 429) {
      const retryAt = readRetryAfter(res.headers.get('retry-after'), now);
      await res.arrayBuffer();
      throw new ProviderBusy(retryAt);
    }
    if (res.status >= 500) {
      await res.arrayBuffer();
      throw new ProviderUnavailable(`status ${res.status}`);
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit, now?: number): Promise<T> {
    const res = await this.call(path, init, now);
    if (!res.ok) throw new ProviderUnavailable(`status ${res.status}`);
    try {
      return (await res.json()) as T;
    } catch (cause) {
      throw new ProviderUnavailable(cause);
    }
  }

  /** Reads every catalogue page, following `nextCursor` to the end. */
  async readCatalogue(): Promise<SupplierMaterial[]> {
    const all: SupplierMaterial[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const path: string =
        cursor === null ? '/v2/materials' : `/v2/materials?cursor=${encodeURIComponent(cursor)}`;
      const body: { materials: SupplierMaterial[]; nextCursor?: string | null } = await this.json(path);
      all.push(...body.materials);
      cursor = body.nextCursor ?? null;
      if (cursor === null) return all;
    }
    throw new ProviderUnavailable('catalogue did not end');
  }

  async readLots(code: string): Promise<SupplierLot[]> {
    const body = await this.json<{ lots: SupplierLot[] }>(
      `/v2/materials/${encodeURIComponent(code)}/lots`,
    );
    return body.lots;
  }

  async placeHold(
    repeatKey: string,
    body: { code: string; lot: string; quantity: number | string; pieceRef: string },
  ): Promise<string> {
    const answer = await this.json<{ holdId: string }>('/v2/holds', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': repeatKey },
      body: JSON.stringify(body),
    });
    return answer.holdId;
  }

  async quote(body: {
    fromTown: string;
    toTown: string;
    widthCm: number;
    depthCm: number;
    heightCm: number;
    weightKg: string;
  }): Promise<CourierQuote> {
    return this.json<CourierQuote>('/v1/quotes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async book(
    repeatKey: string,
    body: { quoteId: string; collectAt: string; town: string },
  ): Promise<CourierCollection> {
    const res = await this.call('/v1/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': repeatKey },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      await res.arrayBuffer();
      throw new SlotTaken();
    }
    if (!res.ok) throw new ProviderUnavailable(`status ${res.status}`);
    try {
      return (await res.json()) as CourierCollection;
    } catch (cause) {
      throw new ProviderUnavailable(cause);
    }
  }

  async readCollection(id: string): Promise<CourierCollection> {
    return this.json<CourierCollection>(`/v1/collections/${encodeURIComponent(id)}`);
  }

  /** The label's bytes, which are what MinIO keeps. */
  async readLabel(labelPath: string): Promise<Uint8Array> {
    const res = await this.call(labelPath);
    if (!res.ok) throw new ProviderUnavailable(`status ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
