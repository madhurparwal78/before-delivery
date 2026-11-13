// The rental house HTTP API (Kaaiverhuur, played by WireMock): stock, asks, quotes,
// confirms and releases, each with the published timeout and idempotency keys (DP-18).

import type { Config } from './config.js';

const CALL_LIMIT_MS = 3000;

export type AskOutcome =
  | { kind: 'held'; holdRef: string; serial: string; loggedHours: string; expiresInSeconds: number }
  | { kind: 'no_stock' }
  | { kind: 'refused' }
  | { kind: 'ambiguous' };

export type ConfirmOutcome =
  | { kind: 'hired' }
  | { kind: 'hold_expired' }
  | { kind: 'refused' }
  | { kind: 'ambiguous' };

export type ReleaseOutcome = { kind: 'released' } | { kind: 'ambiguous' };

export type StockOutcome =
  | { kind: 'ok'; model: string; available: number; dayRateCents: number }
  | { kind: 'unknown_model' }
  | { kind: 'ambiguous' };

export type QuoteOutcome =
  | { kind: 'ok'; dayRateCents: number; days: number; factorPermille: number; netCents: number; vatCents: number; totalCents: number }
  | { kind: 'ambiguous' };

export interface RentalHouse {
  stock(model: string, from: string, days: number): Promise<StockOutcome>;
  ask(key: string, model: string, from: string, days: number): Promise<AskOutcome>;
  quote(holdRef: string, days: number): Promise<QuoteOutcome>;
  confirm(key: string, holdRef: string, totalCents: number): Promise<ConfirmOutcome>;
  release(holdRef: string): Promise<ReleaseOutcome>;
}

class WiremockRentalHouse implements RentalHouse {
  constructor(private readonly baseUrl: string) {}

  async stock(model: string, from: string, days: number): Promise<StockOutcome> {
    const url = `${this.baseUrl}/v1/stock?model=${encodeURIComponent(model)}&from=${from}&days=${days}`;
    const response = await this.fetchWithTimeout(url, { method: 'GET' });
    if (response === null) return { kind: 'ambiguous' };
    if (response.status === 404) return { kind: 'unknown_model' };
    if (response.status !== 200) return { kind: 'ambiguous' };
    const body = readJson(response.parsed);
    if (body === null || typeof body.available !== 'number' || typeof body.dayRateCents !== 'number') return { kind: 'ambiguous' };
    return { kind: 'ok', model: String(body.model ?? model), available: body.available, dayRateCents: body.dayRateCents };
  }

  async ask(key: string, model: string, from: string, days: number): Promise<AskOutcome> {
    const url = `${this.baseUrl}/v1/holds`;
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ model, from, days }),
    });
    if (response === null) return { kind: 'ambiguous' };
    if (response.status === 201) {
      const body = readJson(response.parsed);
      if (body === null || typeof body.holdRef !== 'string' || typeof body.serial !== 'string') return { kind: 'ambiguous' };
      if (body.status !== 'held') return { kind: 'ambiguous' };
      const hours = body.loggedHours;
      return {
        kind: 'held',
        holdRef: body.holdRef,
        serial: body.serial,
        loggedHours: typeof hours === 'number' ? String(hours) : String(hours ?? '0'),
        expiresInSeconds: typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 1800,
      };
    }
    if (response.status === 409) {
      const body = readJson(response.parsed);
      if (body !== null && body.error === 'no_stock') return { kind: 'no_stock' };
      return { kind: 'ambiguous' };
    }
    if (response.status >= 500) return { kind: 'ambiguous' };
    return { kind: 'refused' };
  }

  async quote(holdRef: string, days: number): Promise<QuoteOutcome> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdRef, days }),
    });
    if (response === null || response.status !== 200) return { kind: 'ambiguous' };
    const body = readJson(response.parsed);
    if (body === null) return { kind: 'ambiguous' };
    const required = ['dayRateCents', 'days', 'factorPermille', 'netCents', 'vatCents', 'totalCents'];
    for (const field of required) {
      if (typeof (body as Record<string, unknown>)[field] !== 'number') return { kind: 'ambiguous' };
    }
    const record = body as Record<string, number>;
    return {
      kind: 'ok',
      dayRateCents: record.dayRateCents!,
      days: record.days!,
      factorPermille: record.factorPermille!,
      netCents: record.netCents!,
      vatCents: record.vatCents!,
      totalCents: record.totalCents!,
    };
  }

  async confirm(key: string, holdRef: string, totalCents: number): Promise<ConfirmOutcome> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/holds/${encodeURIComponent(holdRef)}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ totalCents }),
    });
    if (response === null) return { kind: 'ambiguous' };
    if (response.status === 200) {
      const body = readJson(response.parsed);
      if (body !== null && body.status === 'hired') return { kind: 'hired' };
      return { kind: 'ambiguous' };
    }
    if (response.status === 409) {
      const body = readJson(response.parsed);
      if (body !== null && body.error === 'hold_expired') return { kind: 'hold_expired' };
      return { kind: 'ambiguous' };
    }
    return { kind: 'ambiguous' };
  }

  async release(holdRef: string): Promise<ReleaseOutcome> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/holds/${encodeURIComponent(holdRef)}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (response === null || response.status !== 200) return { kind: 'ambiguous' };
    const body = readJson(response.parsed);
    if (body !== null && body.status === 'released') return { kind: 'released' };
    return { kind: 'ambiguous' };
  }

  private async fetchWithTimeout(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; parsed: unknown } | null> {
    // A connection refused on the first send of an ask is a definite refusal; every
    // other transport failure inside the limit counts as silence.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_LIMIT_MS);
    try {
      const request: RequestInit = {
        method: init.method,
        headers: init.headers ?? {},
        signal: controller.signal,
      };
      if (init.body !== undefined) request.body = init.body;
      const response = await fetch(url, request);
      const text = await response.text();
      return { status: response.status, parsed: safeJson(text) };
    } catch (err) {
      if (init.method === 'GET') return null;
      if (err instanceof Error && err.name === 'AbortError') return null;
      if (typeof (err as { code?: string }).code === 'string') return null;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJson(parsed: unknown): Record<string, unknown> | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  return parsed as Record<string, unknown>;
}

export function rentalHouse(config: Config): RentalHouse {
  return new WiremockRentalHouse(config.wiremockUrl);
}
