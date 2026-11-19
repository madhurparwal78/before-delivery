// The published zone list: UTC, the Etc/GMT offset zones, and every IANA zone
// name the runtime knows under the accepted region prefixes, links included.
// The runtime's own zoneinfo tree is the source; Intl's supported values are
// the fallback. Every entry is checked against the runtime before it is
// offered.

import { readdirSync } from 'node:fs';
import { isAcceptedZone } from '../shared/timezones.js';

const ETC: string[] = [];
for (let h = 14; h >= 1; h -= 1) ETC.push(`Etc/GMT-${h}`);
for (let h = 1; h <= 12; h += 1) ETC.push(`Etc/GMT+${h}`);

const REGIONS = ['Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific'];

function fromZoneInfo(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
      else found.push(`${prefix}${entry.name}`);
    }
  };
  for (const region of REGIONS) walk(`/usr/share/zoneinfo/${region}`, `${region}/`);
  return found;
}

function fromIntl(): string[] {
  const supported: string[] = Intl.supportedValuesOf('timeZone');
  return supported.filter((z) => REGIONS.some((region) => z.startsWith(`${region}/`)));
}

const discovered = new Set<string>([...fromZoneInfo(), ...fromIntl()]);

export const ZONE_LIST: string[] = ['UTC', ...ETC, ...discovered].filter(isAcceptedZone).sort();
