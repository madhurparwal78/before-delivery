export class ProviderUnavailable extends Error {}

const TIMEOUT_MS = 5000;

/** Any non-2xx reply, timeout or connection failure counts as unavailable. */
export async function providerFetch(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderUnavailable(error instanceof Error ? error.message : "provider unreachable");
  }
  if (!response.ok) throw new ProviderUnavailable(`${url} answered ${response.status}`);
  return response;
}
