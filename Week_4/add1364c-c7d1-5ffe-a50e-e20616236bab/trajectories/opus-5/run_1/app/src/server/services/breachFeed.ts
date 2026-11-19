import { config } from '../config.js';

const TIMEOUT_MS = 5_000;

export class FeedUnreachable extends Error {}

type RangeAnswer = { results: { suffix: string; count: number }[] };
type DomainAnswer = { domains: { domain: string; title: string; breached_on: string; data_classes: string[] }[] };

async function read<T>(path: string, extraHeaders: Record<string, string>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.breachFeedUrl}${path}`, {
      headers: { accept: 'application/json', ...extraHeaders },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new FeedUnreachable('The breach feed is unreachable.');
  }
  if (response.status !== 200) throw new FeedUnreachable('The breach feed refused the request.');
  try {
    return (await response.json()) as T;
  } catch {
    throw new FeedUnreachable('The breach feed sent no answer.');
  }
}

/** Sends only the five-character hash prefix. Padding rows (count 0) are ignored. */
export async function exposedSuffixes(prefix: string): Promise<Set<string>> {
  const answer = await read<RangeAnswer>(`/v1/range/${prefix}`, { 'Add-Padding': 'true' });
  const suffixes = new Set<string>();
  for (const row of answer.results ?? []) {
    if (typeof row.suffix === 'string' && typeof row.count === 'number' && row.count > 0) {
      suffixes.add(row.suffix.toUpperCase());
    }
  }
  return suffixes;
}

export async function breachedDomains(): Promise<Set<string>> {
  const answer = await read<DomainAnswer>('/v1/breached-domains', {});
  return new Set((answer.domains ?? []).map((entry) => entry.domain.toLowerCase()));
}
