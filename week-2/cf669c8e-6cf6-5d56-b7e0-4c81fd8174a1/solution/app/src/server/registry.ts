/** The national plate registry stand-in served by WireMock. */
import { oneOf } from '../shared/choice.js';
import { PLATE_COLOURS, ROAD_CLASSES, type PlateColour, type RegCountry, type RoadClass } from '../shared/types.js';
import { parseTenths } from './catalogue.js';
import { config } from './config.js';
import { sql } from './db.js';
import { fail, isRecord } from './errors.js';
import { readHealth, recordHealth } from './health.js';

const PATTERNS: Record<RegCountry, { match: RegExp; format: (c: string) => string; example: string }> = {
  NL: { match: /^[A-Z]{3}\d{2}[A-Z]$/, format: (c) => `${c.slice(0, 3)}-${c.slice(3, 5)}-${c.slice(5)}`, example: 'FGH-12-K' },
  BE: { match: /^[A-Z]{4}\d{3}$/, format: (c) => `${c.slice(0, 1)}-${c.slice(1, 4)}-${c.slice(4)}`, example: 'A-KLM-204' },
  DE: { match: /^\d{3}[A-Z]{3}$/, format: (c) => `${c.slice(0, 3)}-${c.slice(3)}`, example: '418-RTV' },
};

export function plateExample(country: RegCountry): string {
  return PATTERNS[country].example;
}

/** Uppercase, drop spaces and hyphens, then match the country's format; null when it does not match. */
export function canonicalPlate(input: string, country: RegCountry): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, '');
  const pattern = PATTERNS[country];
  return pattern.match.test(compact) ? pattern.format(compact) : null;
}

export interface RegistryRecord {
  plate: string;
  country: RegCountry;
  model: string;
  firstAdmissionYear: number;
  roadClass: RoadClass;
  plateColour: PlateColour;
  registeredMassT: number;
}

export class RegistryUnreachable extends Error {}

export const registryUnreachable = () => fail(503, 'registry_unreachable');

async function request(path: string): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${config.wiremockUrl}${path}`, { signal: AbortSignal.timeout(3000), headers: { Accept: 'application/json' } });
  } catch {
    await recordHealth(config.wiremockUrl, false);
    throw new RegistryUnreachable();
  }
  if (response.status >= 500) {
    await recordHealth(config.wiremockUrl, false);
    throw new RegistryUnreachable();
  }
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, json };
}

/** A fresh read of the registry, never cached. Null when the plate is unknown. */
export async function readPlate(plate: string, country: RegCountry): Promise<RegistryRecord | null> {
  const { status, json } = await request(`/v1/plates/${encodeURIComponent(plate)}?country=${country}`);
  if (status !== 200 || !isRecord(json)) return null;
  const registeredMassT = parseTenths(json['registeredMassKg']);
  const roadClass = oneOf(json['roadClass'], ROAD_CLASSES);
  const plateColour = oneOf(json['plateColour'], PLATE_COLOURS);
  const { model, firstAdmissionYear } = json;
  if (typeof model !== 'string' || typeof firstAdmissionYear !== 'number' || !roadClass || !plateColour || registeredMassT === null) return null;
  return { plate, country, model, firstAdmissionYear, roadClass, plateColour, registeredMassT };
}

export const REGISTRY_PROBE_MS = 3000;

/** Any answer below 500 means the registry is up; a failed request has already recorded it down. */
export async function runRegistryProbe(): Promise<void> {
  try {
    await request('/v1/plates/PROBE?country=NL');
    await recordHealth(config.wiremockUrl, true);
  } catch (error) {
    if (!(error instanceof RegistryUnreachable)) throw error;
  }
}

export async function registryStatus(): Promise<'up' | 'down'> {
  if ((await readHealth(sql, config.wiremockUrl)) === null) await runRegistryProbe();
  return (await readHealth(sql, config.wiremockUrl)) ? 'up' : 'down';
}
