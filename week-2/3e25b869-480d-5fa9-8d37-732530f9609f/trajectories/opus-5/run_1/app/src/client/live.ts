import type { Bilingual } from '../shared/catalog.js';
import { locale } from './i18n.js';
import { refresh } from './ui.js';

export type RegionName = 'cart' | 'account' | 'studio' | 'contact';

const messages = new Map<RegionName, Bilingual[]>();

/**
 * Each action replaces a region's whole text; several messages from one action are joined with a
 * single space in the order they were given.
 */
export function announce(region: RegionName, ...parts: (Bilingual | null)[]): void {
  messages.set(
    region,
    parts.filter((part): part is Bilingual => part !== null),
  );
  refresh();
}

export function clearRegion(region: RegionName): void {
  messages.delete(region);
}

export function regionText(region: RegionName): string {
  const parts = messages.get(region) ?? [];
  return parts.map((part) => part[locale()]).join(' ');
}
