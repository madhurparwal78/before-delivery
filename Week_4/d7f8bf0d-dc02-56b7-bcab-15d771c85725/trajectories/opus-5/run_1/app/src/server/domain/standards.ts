import type { StandardsProfile } from '../../shared/protocol.js';

export const DEFAULT_STANDARDS: StandardsProfile = {
  endplate_single_mm: 610,
  endplate_double_mm: 660,
  double_track_offset_mm: 25,
  end_straight_mm: 152,
  min_radius_mm: 1067,
  max_grade_tenths_percent: 20,
  min_frog_number: 6,
  reverse_curve_straight_mm: 305,
  elevation_step_hundredths_mm: 1905,
  display_units: 'in',
};

const LENGTH_FIELDS = [
  'endplate_single_mm',
  'endplate_double_mm',
  'double_track_offset_mm',
  'end_straight_mm',
  'min_radius_mm',
  'reverse_curve_straight_mm',
] as const;

export function parseStandards(body: Record<string, unknown>): StandardsProfile | null {
  const profile: StandardsProfile = { ...DEFAULT_STANDARDS };
  for (const field of LENGTH_FIELDS) {
    const value = body[field];
    if (!Number.isInteger(value) || (value as number) < 0) return null;
    profile[field] = value as number;
  }
  for (const field of ['max_grade_tenths_percent', 'min_frog_number', 'elevation_step_hundredths_mm'] as const) {
    const value = body[field];
    if (!Number.isInteger(value) || (value as number) < 0) return null;
    profile[field] = value as number;
  }
  const units = body['display_units'];
  if (units !== 'in' && units !== 'mm') return null;
  profile.display_units = units;
  return profile;
}
