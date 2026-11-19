import { config } from "../config.ts";
import { copy } from "../domain/copy.ts";
import { minuteCopy } from "../domain/time.ts";
import { tooMany } from "../http/errors.ts";
import { call, ProviderDown, rememberWait, waitUntil } from "./call.ts";

function busy(until: Date): Error {
  return tooMany("courierBusy", copy("F-73", { minute: minuteCopy(until) }), until);
}

/** Every courier call: none before a Retry-After instant, and a 429 keeps its instant. Failures throw ProviderDown. */
async function ask(path: string, init: RequestInit = {}): Promise<Response> {
  const wait = await waitUntil("courier");
  if (wait) throw busy(wait);
  const response = await call(`${config.wiremockUrl}${path}`, init);
  if (response.status === 429) throw busy(await rememberWait("courier", response.headers.get("retry-after")));
  return response;
}

function posted(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

async function readJson<Shape>(response: Response): Promise<Shape> {
  if (!response.ok) throw new ProviderDown(`courier answered ${response.status}`);
  try {
    return (await response.json()) as Shape;
  } catch {
    throw new ProviderDown("courier answered no JSON");
  }
}

interface QuoteRequest {
  fromTown: string;
  toTown: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  weightKg: number;
}

export async function askQuote(request: QuoteRequest): Promise<{ quoteId: string; amount: string; currency: string }> {
  return readJson(await ask("/v1/quotes", posted(request)));
}

interface CourierCollection {
  id: string;
  state: string;
  labelPath: string;
}

/** Books under the repeat key; null means the courier says the time was just taken. */
export async function bookCollection(request: { quoteId: string; collectAt: string; town: string }, repeatKey: string): Promise<CourierCollection | null> {
  const response = await ask("/v1/collections", posted(request, { "Idempotency-Key": repeatKey }));
  if (response.status === 409) return null;
  return readJson(response);
}

export async function readCollection(courierId: string): Promise<CourierCollection> {
  return readJson(await ask(`/v1/collections/${encodeURIComponent(courierId)}`));
}

export async function fetchLabel(labelPath: string): Promise<Buffer> {
  const response = await ask(labelPath);
  if (!response.ok) throw new ProviderDown(`label answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
