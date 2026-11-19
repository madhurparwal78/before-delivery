/** Browser-side formatting: sales-office time, money and the published row copy. */

import { formatDollars } from '../shared/derived';
import { formatSalesOfficeTime } from '../shared/salesOfficeTime';
import { BAND_LABELS, VIEW_LABELS } from '../shared/labels';
import type { PublicUnit, SharedUnit } from '../shared/types';

/** The display zone the server was configured with. */
function salesOfficeZone(): string {
  const node = document.getElementById('hw-display');
  const parsed = node ? (JSON.parse(node.textContent ?? '{}') as { salesOfficeTz?: string }) : {};
  if (!parsed.salesOfficeTz) throw new Error('the sales office zone is missing');
  return parsed.salesOfficeTz;
}

const zone = salesOfficeZone();

export function salesTime(instant: string | Date): string {
  return formatSalesOfficeTime(instant, zone);
}

export function money(price: number): string {
  return formatDollars(price);
}

/** The facts each result row and the detail dialog show. */
export function unitFacts(unit: PublicUnit | SharedUnit): string[] {
  return [
    `${unit.areaM2} m² · ${unit.areaSqft} sq ft`,
    `${unit.bearing}° ${unit.facing}`,
    `${unit.bedrooms} bed`,
    VIEW_LABELS[unit.viewTag],
    BAND_LABELS[unit.band],
  ];
}
