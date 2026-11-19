import { config } from "../config.ts";
import type { Lot } from "../domain/estimate.ts";
import type { HoldQuantity } from "../domain/holds.ts";
import type { PriceKey } from "../domain/money.ts";
import { call, ProviderDown, rememberWait, waitUntil } from "./call.ts";

export interface SupplierMaterial {
  code: string;
  name: string;
  family: string;
  unit: "sqFt" | "metre";
  prices: Record<PriceKey, string>;
}

/** The supplier answered 429, or its Retry-After instant is still ahead: no call goes before `until`. */
export class SupplierBusy extends Error {
  constructor(readonly until: Date) {
    super("supplier busy");
  }
}

async function supplierCall(path: string, init?: RequestInit): Promise<Response> {
  const until = await waitUntil("supplier");
  if (until) throw new SupplierBusy(until);
  const response = await call(`${config.wiremockUrl}${path}`, init);
  if (response.status === 429) throw new SupplierBusy(await rememberWait("supplier", response.headers.get("retry-after")));
  if (!response.ok) throw new ProviderDown(`${path} answered ${response.status}`);
  return response;
}

/** Every page of the catalogue, or a throw: nothing partial leaves here. */
export async function readCatalogue(): Promise<SupplierMaterial[]> {
  const materials: SupplierMaterial[] = [];
  let path: string | null = "/v2/materials";
  while (path) {
    const response: Response = await supplierCall(path);
    const page = (await response.json()) as { materials: SupplierMaterial[]; nextCursor?: string | null };
    materials.push(...page.materials);
    path = page.nextCursor ? `/v2/materials?cursor=${encodeURIComponent(page.nextCursor)}` : null;
  }
  return materials;
}

export async function readLots(code: string): Promise<Lot[]> {
  const response = await supplierCall(`/v2/materials/${encodeURIComponent(code)}/lots`);
  return ((await response.json()) as { lots: Lot[] }).lots;
}

export async function placeHold(hold: { code: string; lot: string; quantity: HoldQuantity; pieceRef: string }, repeatKey: string): Promise<string> {
  const response = await supplierCall("/v2/holds", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": repeatKey },
    body: JSON.stringify(hold),
  });
  return ((await response.json()) as { holdId: string }).holdId;
}
