import { config } from "../config.js";

export type SupplierLot = { lot: string; hides?: number; averageSqFt?: string; metres?: string };
export type SupplierMaterial = { code: string; name: string; family: string; unit: string; prices: Record<string, string> };

export class ProviderError extends Error {
  readonly kind: "busy" | "down";
  readonly retryAfter?: number;
  constructor(kind: "busy" | "down", retryAfter?: number) {
    super(kind);
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

async function call<T>(path: string, method: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: T | null; retryAfter?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${config.wiremockUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(headers ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const retryAfter = res.headers.get("retry-after") ?? undefined;
    const data = (await res.json().catch(() => null)) as T | null;
    return { status: res.status, data, retryAfter };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Read every supplier page or fail without changing anything. */
export async function fetchAllMaterials(): Promise<SupplierMaterial[] | ProviderError> {
  const all: SupplierMaterial[] = [];
  let cursor: string | undefined;
  do {
    const res = await call<{ materials: SupplierMaterial[]; nextCursor?: string }>(`/v2/materials${cursor ? `?cursor=${cursor}` : ""}`, "GET");
    if (res.status === 429) return new ProviderError("busy", Number(res.retryAfter ?? 0));
    if (res.status !== 200 || !res.data) return new ProviderError("down");
    all.push(...res.data.materials);
    cursor = res.data.nextCursor;
  } while (cursor);
  return all;
}

export async function fetchLots(code: string): Promise<SupplierLot[] | ProviderError> {
  const res = await call<{ lots: SupplierLot[] }>(`/v2/materials/${encodeURIComponent(code)}/lots`, "GET");
  if (res.status === 429) return new ProviderError("busy", Number(res.retryAfter ?? 0));
  if (res.status !== 200 || !res.data) return new ProviderError("down");
  return res.data.lots;
}

export async function placeHold(code: string, lot: string, quantity: string, pieceRef: string, idempotencyKey: string): Promise<{ holdId: string } | ProviderError> {
  const res = await call<{ holdId: string }>("/v2/holds", "POST", { code, lot, quantity, pieceRef }, { "Idempotency-Key": idempotencyKey });
  if (res.status === 429) return new ProviderError("busy", Number(res.retryAfter ?? 0));
  if (res.status === 0) return new ProviderError("down");
  if (res.status >= 500) return new ProviderError("down");
  if (res.status !== 201 || !res.data) return new ProviderError("down");
  return res.data;
}

export type CourierQuote = { quoteId: string; amount: string; currency: string };

export async function courierQuote(from: string, to: string, w: number, d: number, h: number, kg: number): Promise<CourierQuote | ProviderError> {
  const res = await call<CourierQuote>("/v1/quotes", "POST", { fromTown: from, toTown: to, widthCm: w, depthCm: d, heightCm: h, weightKg: kg });
  if (res.status === 429) return new ProviderError("busy", Number(res.retryAfter ?? 0));
  if (res.status !== 200 || !res.data) return new ProviderError("down");
  return res.data;
}

export type CourierCollection = { id: string; state: string; labelPath: string };

export async function courierBook(quoteId: string, collectAt: string, town: string, idempotencyKey: string): Promise<CourierCollection | ProviderError> {
  const res = await call<CourierCollection>("/v1/collections", "POST", { quoteId, collectAt, town }, { "Idempotency-Key": idempotencyKey });
  if (res.status === 429) return new ProviderError("busy", Number(res.retryAfter ?? 0));
  if (res.status === 409) return new ProviderError("busy");
  if (res.status !== 201 || !res.data) return new ProviderError("down");
  return res.data;
}

export async function courierRead(id: string): Promise<CourierCollection | ProviderError> {
  const res = await call<CourierCollection>(`/v1/collections/${encodeURIComponent(id)}`, "GET");
  if (res.status === 429) return new ProviderError("busy", Number(res.retryAfter ?? 0));
  if (res.status !== 200 || !res.data) return new ProviderError("down");
  return res.data;
}

export async function courierLabel(labelPath: string): Promise<Buffer | ProviderError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${config.wiremockUrl}${labelPath}`, { signal: controller.signal });
    if (res.status === 429) return new ProviderError("busy", Number(res.headers.get("retry-after") ?? 0));
    if (!res.ok) return new ProviderError("down");
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return new ProviderError("down");
  } finally {
    clearTimeout(timer);
  }
}
