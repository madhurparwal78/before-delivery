import { PROVIDER_TIMEOUT_MS } from "../config.js";
import type { ServiceName } from "../../shared/types.js";

/**
 * Raised when a provider cannot be connected to, or gives no reply within the
 * published timeout. The server keeps no lasting record that a provider is down:
 * every request, retry and health probe calls it afresh.
 */
export class ProviderUnavailable extends Error {
  constructor(readonly service: ServiceName, cause?: unknown) {
    super(`${service} is unavailable`);
    this.name = "ProviderUnavailable";
    this.cause = cause;
  }
}

export interface ProviderResponse {
  status: number;
  headers: Headers;
  text: string;
}

/** A single HTTP call to a provider. Connection and timeout failures become `ProviderUnavailable`. */
export async function providerFetch(
  service: ServiceName,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<ProviderResponse> {
  const { timeoutMs = PROVIDER_TIMEOUT_MS, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    throw new ProviderUnavailable(service, cause);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    throw new ProviderUnavailable(service, cause);
  }
  return { status: response.status, headers: response.headers, text };
}

/** Provider replies in the 5xx range mean the provider is not serving requests. */
export function expectOk(service: ServiceName, response: ProviderResponse, allowed: readonly number[]): void {
  if (allowed.includes(response.status)) return;
  throw new ProviderUnavailable(
    service,
    new Error(`unexpected ${response.status} from ${service}: ${response.text.slice(0, 300)}`),
  );
}

export function parseJson<T>(service: ServiceName, response: ProviderResponse): T {
  try {
    return JSON.parse(response.text) as T;
  } catch (cause) {
    throw new ProviderUnavailable(service, cause);
  }
}
