import { config } from '../config.js';
import { formatPostcode } from '../../domain/text.js';

const TIMEOUT_MS = 5000;

export class ProviderDown extends Error {}

async function readJson(path: string, init?: RequestInit): Promise<unknown> {
  let answer: Response;
  try {
    answer = await fetch(`${config.wiremockUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ProviderDown(`${path} did not answer`);
  }
  if (!answer.ok) throw new ProviderDown(`${path} answered ${answer.status}`);
  try {
    return await answer.json();
  } catch {
    throw new ProviderDown(`${path} did not answer JSON`);
  }
}

export type AddressSuggestion = { id: string; text: string };

export async function findAddresses(text: string): Promise<AddressSuggestion[]> {
  const body = (await readJson(`/v1/find?q=${encodeURIComponent(text)}`)) as {
    suggestions?: { id?: unknown; text?: unknown }[];
  };
  const suggestions = Array.isArray(body.suggestions) ? body.suggestions : [];
  return suggestions
    .filter((row) => typeof row.id === 'string' && typeof row.text === 'string')
    .slice(0, 6)
    .map((row) => ({ id: row.id as string, text: row.text as string }));
}

export type AddressDetail = { id: string; line1: string; town: string; postcode: string; text: string };

export async function getAddress(id: string): Promise<AddressDetail> {
  const body = (await readJson(`/v1/get/${encodeURIComponent(id)}`)) as {
    line1?: unknown;
    town?: unknown;
    postcode?: unknown;
  };
  if (typeof body.line1 !== 'string' || typeof body.town !== 'string' || typeof body.postcode !== 'string') {
    throw new ProviderDown('address detail missing fields');
  }
  const postcode = formatPostcode(body.postcode);
  return {
    id,
    line1: body.line1,
    town: body.town,
    postcode,
    text: `${body.line1}, ${body.town} ${postcode}`,
  };
}

export type RouteLeg = { km: string; minutes: number };

export async function readRoute(vehicleClass: 'coach' | 'minibus', stops: string[]): Promise<RouteLeg[]> {
  const body = (await readJson('/v1/route', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vehicleClass, stops: stops.map((text) => ({ text })) }),
  })) as { legs?: { km?: unknown; minutes?: unknown }[] };
  const legs = Array.isArray(body.legs) ? body.legs : [];
  return legs.map((leg) => ({
    km: typeof leg.km === 'string' ? leg.km : String(leg.km ?? '0'),
    minutes: Number(leg.minutes ?? 0),
  }));
}

export type FlightStatus = { scheduledArrival: string | null; actualArrival: string | null; status: string };

export async function readFlight(code: string, date: string): Promise<FlightStatus> {
  const body = (await readJson(`/v1/flights/${encodeURIComponent(code)}?date=${encodeURIComponent(date)}`)) as {
    scheduledArrival?: unknown;
    actualArrival?: unknown;
    status?: unknown;
  };
  return {
    scheduledArrival: typeof body.scheduledArrival === 'string' ? body.scheduledArrival : null,
    actualArrival: typeof body.actualArrival === 'string' ? body.actualArrival : null,
    status: typeof body.status === 'string' ? body.status : 'unknown',
  };
}

export async function readBankHolidays(): Promise<string[]> {
  const body = (await readJson('/bank-holidays.json')) as {
    'england-and-wales'?: { events?: { date?: unknown }[] };
  };
  const events = body['england-and-wales']?.events;
  if (!Array.isArray(events)) throw new ProviderDown('holiday list missing events');
  return events.filter((event) => typeof event.date === 'string').map((event) => event.date as string);
}

export type DirectoryOperator = {
  id: string;
  name: string;
  town: string;
  email: string;
  telephone: string;
  sizes: number[];
};

/** Reads every page of the directory. One failing page throws, so the list is left as it was. */
export async function readDirectory(): Promise<DirectoryOperator[]> {
  const operators: DirectoryOperator[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < 50; page += 1) {
    const path = cursor ? `/v2/operators?cursor=${encodeURIComponent(cursor)}` : '/v2/operators';
    const body = (await readJson(path)) as { operators?: unknown; nextCursor?: unknown };
    const rows = Array.isArray(body.operators) ? body.operators : [];
    for (const row of rows as Record<string, unknown>[]) {
      if (
        typeof row.id !== 'string' ||
        typeof row.name !== 'string' ||
        typeof row.town !== 'string' ||
        typeof row.email !== 'string' ||
        typeof row.telephone !== 'string' ||
        !Array.isArray(row.sizes)
      ) {
        throw new ProviderDown('directory row missing fields');
      }
      operators.push({
        id: row.id,
        name: row.name,
        town: row.town,
        email: row.email,
        telephone: row.telephone,
        sizes: (row.sizes as unknown[]).map(Number),
      });
    }
    const next = body.nextCursor;
    if (typeof next !== 'string' || next === '') return operators;
    if (seenCursors.has(next)) return operators;
    seenCursors.add(next);
    cursor = next;
  }
  return operators;
}
