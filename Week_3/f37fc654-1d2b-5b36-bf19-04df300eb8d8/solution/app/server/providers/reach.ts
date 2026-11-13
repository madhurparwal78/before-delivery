import type { ServiceName } from "../../shared/copy.js";

/** A provider did not answer at all (refused, reset, timed out). Routes map it to the published 503. */
export class ServiceDown extends Error {
  constructor(readonly service: ServiceName) {
    super(`${service} unreachable`);
  }
}

/** A provider answered with a status the caller did not expect. */
export class ProviderRefused extends Error {
  constructor(
    readonly service: ServiceName,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${service} answered ${status}: ${detail.slice(0, 300)}`);
  }
}

export async function reach(service: ServiceName, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ServiceDown(service);
  }
}

export async function expectOk(service: ServiceName, response: Response, ...statuses: number[]): Promise<Response> {
  if (statuses.includes(response.status)) return response;
  throw new ProviderRefused(service, response.status, await response.text().catch(() => ""));
}
