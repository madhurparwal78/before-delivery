/** Published copy for statuses, chips and the lens chip text. */

import type { BandId, Facing, ViewTag } from './units';
import type { CellStatus } from './types';

export type DisplayStatus = CellStatus | 'held-by-you';

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  available: 'Available',
  held: 'Held',
  'held-by-you': 'Held by you',
  reserved: 'Reserved',
  withdrawn: 'Withdrawn',
  unreleased: 'Not released',
};

export const BEDROOM_LABELS: Record<string, string> = {
  '1': '1 bedroom',
  '2': '2 bedrooms',
  '3': '3 bedrooms',
};

export const BAND_LABELS: Record<BandId, string> = {
  '03-09': 'Floors 3-9',
  '10-19': 'Floors 10-19',
  '20-29': 'Floors 20-29',
  '30-35': 'Floors 30-35',
  '36-38': 'Floors 36-38',
};

export const VIEW_LABELS: Record<ViewTag, string> = {
  harbour: 'Harbour',
  'harbour-partial': 'Harbour, partly blocked',
  park: 'Park',
  city: 'City',
  ridge: 'Ridge',
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  available: 'Available',
  held: 'Held',
  reserved: 'Reserved',
};

export interface ChipTextInput {
  code: string;
  bearing: number;
  facing: Facing;
  status: DisplayStatus;
  syncing: boolean;
  outsideFilters: boolean;
}

/** The lens chip text, which is also the gridcell's accessible name. */
export function chipText(input: ChipTextInput): string {
  const parts: string[] = [input.code];
  if (input.status !== 'withdrawn' && input.status !== 'unreleased') {
    parts.push(`${input.bearing}° ${input.facing}`);
  }
  parts.push(STATUS_LABELS[input.status]);
  if (input.syncing) parts.push('Syncing');
  if (input.outsideFilters) parts.push('Outside your filters');
  return parts.join(' · ');
}
