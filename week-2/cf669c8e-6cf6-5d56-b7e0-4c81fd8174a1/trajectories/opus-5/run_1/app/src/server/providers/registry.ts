/**
 * The national plate registry stand-in.
 *
 * Every lookup, gate check and inspection makes its own request, with no
 * cached answer. Calls time out after 3 seconds. Any answer below 500 means
 * the registry is up; a connection failure, timeout or 5xx means down, and a
 * failed lookup marks it down until the next probe succeeds.
 */

import type { PlateColour, RegCountry, RoadClass } from '../../shared/types.js';

const REGISTRY_TIMEOUT_MS = 3_000;
const PROBE_INTERVAL_MS = 5_000;

const baseUrl = process.env.WIREMOCK_URL;
if (!baseUrl) throw new Error('WIREMOCK_URL is required');

export interface RegistryRecord {
  plate: string;
  country: RegCountry;
  model: string;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  plateColour: PlateColour;
  /** tenths of a kg */
  registeredMassTenthsKg: number;
}

export type RegistryAnswer =
  | { outcome: 'found'; record: RegistryRecord }
  | { outcome: 'not_found' }
  | { outcome: 'unreachable' };

let up = true;

export function registryStatus(): 'up' | 'down' {
  return up ? 'up' : 'down';
}

function markUp(): void {
  up = true;
}

function markDown(): void {
  up = false;
}

function toTenths(value: unknown): number {
  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(asNumber)) throw new Error(`registry mass is not a number: ${String(value)}`);
  return Math.round(asNumber * 10);
}

/** Read a plate in canonical form. Never caches. */
export async function lookupPlate(plate: string, country: RegCountry): Promise<RegistryAnswer> {
  const url = `${baseUrl}/v1/plates/${encodeURIComponent(plate)}?country=${country}`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch {
    markDown();
    return { outcome: 'unreachable' };
  }

  if (response.status >= 500) {
    markDown();
    return { outcome: 'unreachable' };
  }

  markUp();

  if (response.status === 404) return { outcome: 'not_found' };

  if (!response.ok) return { outcome: 'not_found' };

  try {
    const body = (await response.json()) as Record<string, unknown>;
    return {
      outcome: 'found',
      record: {
        plate: String(body.plate ?? plate),
        country: (body.country as RegCountry) ?? country,
        model: String(body.model),
        firstAdmissionYear: Number(body.firstAdmissionYear),
        roadClass: Number(body.roadClass) as RoadClass,
        plateColour: body.plateColour as PlateColour,
        registeredMassTenthsKg: toTenths(body.registeredMassKg),
      },
    };
  } catch {
    markDown();
    return { outcome: 'unreachable' };
  }
}

/** The probe answers the published 404, which still means the registry is up. */
async function probe(): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/v1/plates/PROBE?country=NL`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (response.status >= 500) markDown();
    else markUp();
  } catch {
    markDown();
  }
}

export function startRegistryProbe(): void {
  void probe();
  setInterval(() => void probe(), PROBE_INTERVAL_MS).unref();
}
