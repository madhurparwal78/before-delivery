import { createHash } from 'node:crypto';
import type { Settings } from '../config.js';

export interface RangeAnswer {
  results: Array<{ suffix: string; count: number }>;
}

export interface BreachedDomain {
  domain: string;
  title: string;
  breached_on: string;
  data_classes: string[];
}

const CALL_TIMEOUT_MS = 5000;

/**
 * The breach-exposure feed. Only the five-character SHA-1 prefix of each secret
 * ever leaves the server, in the request path, with the `Add-Padding: true` header.
 */
export class BreachFeedClient {
  constructor(private readonly settings: Settings) {}

  private async call(path: string, headers: Record<string, string>): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      return await fetch(`${this.settings.wiremockUrl}${path}`, { headers, signal: controller.signal });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Look up the SHA-1 range of a secret. Padding rows (count 0) are ignored. */
  async rangeLookup(secret: string): Promise<Map<string, number> | null> {
    const hash = createHash('sha1').update(secret, 'utf8').digest('hex').toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const response = await this.call(`/v1/range/${prefix}`, { 'Add-Padding': 'true' });
    if (response === null || !response.ok) return null;
    const parsed = (await response.json().catch(() => null)) as RangeAnswer | null;
    if (parsed === null || !Array.isArray(parsed.results)) return null;
    const map = new Map<string, number>();
    for (const row of parsed.results) {
      if (row.count > 0) {
        map.set(row.suffix.toUpperCase(), row.count);
      }
    }
    void suffix;
    return map;
  }

  /** Whether a password is exposed: its hash suffix has a count above zero in the range answer. */
  async isExposed(secret: string): Promise<boolean | null> {
    const hash = createHash('sha1').update(secret, 'utf8').digest('hex').toUpperCase();
    const map = await this.rangeLookup(secret);
    if (map === null) return null;
    const suffix = hash.slice(5);
    for (const [rowSuffix, count] of map) {
      if (rowSuffix.toUpperCase() === suffix && count > 0) return true;
    }
    return false;
  }

  /** The breached-domain list. */
  async breachedDomains(): Promise<Map<string, BreachedDomain> | null> {
    const response = await this.call('/v1/breached-domains', {});
    if (response === null || !response.ok) return null;
    const parsed = (await response.json().catch(() => null)) as { domains?: BreachedDomain[] } | null;
    if (parsed === null || !Array.isArray(parsed.domains)) return null;
    const map = new Map<string, BreachedDomain>();
    for (const domain of parsed.domains) {
      map.set(domain.domain.toLowerCase(), domain);
    }
    return map;
  }
}
