import { config } from '../config';
import { refuse } from '../domain/errors';
import type { ProviderVehicle } from '../domain/record';

const TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * One call to the roadworthiness-record API for the car's stored registration,
 * with no credentials and no query parameters.
 */
export const pullVehicleRecord = async (registration: string): Promise<ProviderVehicle> => {
  const url = `${config.wiremockUrl}/v1/trade/vehicles/registration/${registration}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw refuse(503, 'record_unreachable', 'The roadworthiness record service is not answering');
  }

  if (response.status === 404) {
    throw refuse(404, 'record_not_found', 'No test record was found for this registration');
  }

  if (response.status === 429) {
    const header = response.headers.get('Retry-After');
    const parsed = header === null ? Number.NaN : Number(header);
    const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_RETRY_AFTER_SECONDS;
    throw refuse(429, 'record_throttled', 'The record service is busy', { retryAfterSeconds });
  }

  if (response.status >= 500) {
    throw refuse(503, 'record_unreachable', 'The roadworthiness record service is not answering');
  }

  try {
    return (await response.json()) as ProviderVehicle;
  } catch {
    throw refuse(503, 'record_unreachable', 'The roadworthiness record service is not answering');
  }
};

export const recordApiReachable = async (registration: string): Promise<boolean> => {
  try {
    const response = await fetch(`${config.wiremockUrl}/v1/trade/vehicles/registration/${registration}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};
