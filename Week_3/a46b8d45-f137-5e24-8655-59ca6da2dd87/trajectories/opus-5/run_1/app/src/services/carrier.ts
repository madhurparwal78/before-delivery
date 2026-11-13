/**
 * The carrier pricing service is the only source of carriage bands and charges. No answer,
 * no quote and no estimate: every failure is sorted into slow, failing or malformed.
 */

import { config } from '../config';
import { CarrierFailure } from './outages';

/** An answer not complete within this wait is slow. */
const CARRIER_WAIT_MS = 4000;

export interface CarriageQuote {
  band: string;
  chargeMinor: number;
  currency: 'GBP';
  validUntil: Date;
}

export interface CarriageRequest {
  weightG: number;
  longestSideMm: number;
  postcodeArea: string;
}

const BAND_PATTERN = /^[A-Z0-9]{1,4}$/;

export async function askCarrier(request: CarriageRequest, asOf: Date): Promise<CarriageQuote> {
  const query = new URLSearchParams({
    weight_g: String(request.weightG),
    longest_side_mm: String(request.longestSideMm),
    postcode_area: request.postcodeArea,
  });

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${config.carrierUrl}/v1/carriage/quote?${query.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CARRIER_WAIT_MS),
    });
    text = await response.text();
  } catch (error) {
    // An abort is the wait running out; anything else is a refused or reset connection.
    const slow = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new CarrierFailure(slow ? 'carrier_timeout' : 'carrier_unavailable', error);
  }

  if (response.status !== 200) throw new CarrierFailure('carrier_unavailable');

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch (error) {
    throw new CarrierFailure('carrier_malformed', error);
  }

  return readCarriageQuote(body, asOf);
}

/** A 200 that cannot be read as a usable quote is malformed. */
function readCarriageQuote(body: unknown, asOf: Date): CarriageQuote {
  if (typeof body !== 'object' || body === null) throw new CarrierFailure('carrier_malformed');
  const answer = body as { band?: unknown; charge_minor?: unknown; currency?: unknown; valid_until?: unknown };

  if (typeof answer.band !== 'string' || !BAND_PATTERN.test(answer.band)) throw new CarrierFailure('carrier_malformed');
  if (typeof answer.charge_minor !== 'number' || !Number.isInteger(answer.charge_minor) || answer.charge_minor < 0) {
    throw new CarrierFailure('carrier_malformed');
  }
  if (answer.currency !== 'GBP') throw new CarrierFailure('carrier_malformed');
  if (typeof answer.valid_until !== 'string') throw new CarrierFailure('carrier_malformed');

  const validUntil = new Date(answer.valid_until);
  if (Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= asOf.getTime()) {
    throw new CarrierFailure('carrier_malformed');
  }

  return { band: answer.band, chargeMinor: answer.charge_minor, currency: 'GBP', validUntil };
}

/** The postcode area is the letters before the postcode's first digit, in capitals. */
export function postcodeArea(postcode: string): string {
  const compact = postcode.replace(/\s+/g, '').toUpperCase();
  const match = /^([A-Z]+)/.exec(compact);
  return match?.[1] ?? '';
}
