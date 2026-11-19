import { config } from "./config.js";

/** The breach-exposure feed could not be reached or answered with something other than 200. */
export class FeedUnreachable extends Error {}

const TIMEOUT_MS = 5000;

async function get(path: string, headers: Record<string, string> = {}): Promise<unknown> {
  try {
    const response = await fetch(`${config.wiremockUrl}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) throw new FeedUnreachable("The feed answered with an error");
    return await response.json();
  } catch (error) {
    throw error instanceof FeedUnreachable ? error : new FeedUnreachable("The feed cannot be reached");
  }
}

/** Only the five-character prefix of a SHA-1 ever leaves the server. Padding rows (count 0) are ignored. */
export async function rangeSuffixes(prefix: string): Promise<Set<string>> {
  const body = (await get(`/v1/range/${prefix}`, { "Add-Padding": "true" })) as {
    results?: Array<{ suffix?: unknown; count?: unknown }>;
  };
  const found = new Set<string>();
  for (const row of body.results ?? []) {
    if (typeof row.suffix === "string" && typeof row.count === "number" && row.count > 0) found.add(row.suffix.toUpperCase());
  }
  return found;
}

export async function breachedDomains(): Promise<string[]> {
  const body = (await get("/v1/breached-domains")) as { domains?: Array<{ domain?: unknown }> };
  return (body.domains ?? []).flatMap((row) => (typeof row.domain === "string" ? [row.domain.toLowerCase()] : []));
}
