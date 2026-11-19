/** A provider that could not be reached at all, as opposed to one that answered with an error. */
export class ProviderUnreachable extends Error {
  constructor(
    readonly provider: string,
    cause: unknown,
  ) {
    super(`${provider} unreachable`, { cause });
  }
}

export class ProviderRefused extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} answered ${status}`);
  }
}

export interface ProviderRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
}

export async function providerFetch(
  provider: string,
  url: string,
  request: ProviderRequest = {},
): Promise<{ status: number; text: string; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 15_000);
  try {
    const response = await fetch(url, {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body as BodyInit | undefined,
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text(), headers: response.headers };
  } catch (error) {
    throw new ProviderUnreachable(provider, error);
  } finally {
    clearTimeout(timer);
  }
}

export async function providerJson<T>(
  provider: string,
  url: string,
  request: ProviderRequest = {},
): Promise<T> {
  const response = await providerFetch(provider, url, request);
  if (response.status >= 400) throw new ProviderRefused(provider, response.status, response.text);
  return (response.text.length > 0 ? JSON.parse(response.text) : null) as T;
}

export async function reachable(provider: string, url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const response = await providerFetch(provider, url, { timeoutMs });
    return response.status < 500;
  } catch {
    return false;
  }
}
