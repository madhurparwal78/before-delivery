import type { StandardsProfile } from '../../shared/domain'
import { invalidFields } from '../http/errors'

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
}

const NUMERIC_FIELDS = [
  'endplate_single_mm', 'endplate_double_mm', 'double_track_offset_mm', 'end_straight_mm', 'min_radius_mm',
  'max_grade_tenths_percent', 'min_frog_number', 'reverse_curve_straight_mm', 'elevation_step_hundredths_mm',
] as const

export function parseStandards(body: Record<string, unknown>): StandardsProfile {
  const fields: Record<string, string> = {}
  const profile: Record<string, unknown> = {}
  for (const name of NUMERIC_FIELDS) {
    const value = body[name]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000) fields[name] = 'Enter a whole number of at least zero.'
    else profile[name] = value
  }
  if (body.display_units !== 'in' && body.display_units !== 'mm') fields.display_units = 'Choose inches or millimetres.'
  else profile.display_units = body.display_units
  if (Object.keys(fields).length > 0) throw invalidFields(fields)
  return profile as unknown as StandardsProfile
}
