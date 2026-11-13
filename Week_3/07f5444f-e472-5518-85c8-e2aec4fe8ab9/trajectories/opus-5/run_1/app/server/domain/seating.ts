import type { Chair, ProgrammeStatus, StringCount } from '../../shared/api.js';
import { stringSectionByChairKey } from './sections.js';

/**
 * A string player is seated when their chair number is at or below their section's count.
 * Every other player is seated when a work in the programme has a part for their chair.
 */
export function isSeated(chair: Chair, stringCount: StringCount, programmeChairKeys: ReadonlySet<string>): boolean {
  const section = stringSectionByChairKey(chair.key);
  if (section) return chair.number <= stringCount[section.countKey];
  return programmeChairKeys.has(chair.key);
}

export function folderIsVisible(
  status: ProgrammeStatus,
  chair: Chair,
  stringCount: StringCount,
  programmeChairKeys: ReadonlySet<string>,
): boolean {
  if (status !== 'published' && status !== 'in_performance') return false;
  return isSeated(chair, stringCount, programmeChairKeys);
}
