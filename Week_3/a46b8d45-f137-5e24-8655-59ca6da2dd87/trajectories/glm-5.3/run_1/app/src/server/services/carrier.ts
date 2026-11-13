// The carrier pricing service is the only source of carriage bands and charges.
export type CarrierOutcome =
  | { kind: 'ok'; band: string; chargeMinor: number; validUntil: number }
  | { kind: 'unavailable' }
  | { kind: 'timeout' }
  | { kind: 'malformed' };

export interface CarrierQuoteRequest {
  weightG: number;
  longestSideMm: number;
  postcodeArea: string;
}

const CARRIER_WAIT_MS = 4000;

export class CarrierClient {
  constructor(private readonly baseUrl: string) {}

  async quote(req: CarrierQuoteRequest): Promise<CarrierOutcome> {
    const url =
      `${this.baseUrl.replace(/\/$/, '')}/v1/carriage/quote` +
      `?weight_g=${encodeURIComponent(String(req.weightG))}` +
      `&longest_side_mm=${encodeURIComponent(String(req.longestSideMm))}` +
      `&postcode_area=${encodeURIComponent(req.postcodeArea)}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(CARRIER_WAIT_MS) });
    } catch (e) {
      const err = e as { name?: string };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') return { kind: 'timeout' };
      return { kind: 'unavailable' };
    }
    if (res.status !== 200) return { kind: 'unavailable' };
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { kind: 'malformed' };
    }
    const obj = json as Record<string, unknown>;
    if (typeof obj['band'] !== 'string' || !/^[A-Z0-9]{1,4}$/.test(obj['band'])) return { kind: 'malformed' };
    if (typeof obj['charge_minor'] !== 'number' || !Number.isInteger(obj['charge_minor']) || (obj['charge_minor'] as number) < 0) return { kind: 'malformed' };
    if (obj['currency'] !== 'GBP') return { kind: 'malformed' };
    if (typeof obj['valid_until'] !== 'string') return { kind: 'malformed' };
    const until = Date.parse(obj['valid_until']);
    if (!Number.isFinite(until) || until <= Date.now()) return { kind: 'malformed' };
    return {
      kind: 'ok',
      band: obj['band'],
      chargeMinor: obj['charge_minor'],
      validUntil: until,
    };
  }
}
