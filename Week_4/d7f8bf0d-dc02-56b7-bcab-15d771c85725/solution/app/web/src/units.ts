import type { DisplayUnits } from '../../shared/domain'
import { MM_PER_INCH } from '../../shared/units'

// Inches show the shortest decimal (up to three places) that still means the same stored millimetres: 610 mm is 24.
function shortestInches(valueInches: number, converts: (text: string) => boolean): string {
  for (let places = 0; places <= 3; places += 1) {
    const text = valueInches.toFixed(places)
    if (converts(text)) return String(Number(text))
  }
  return String(Math.round(valueInches * 1000) / 1000)
}

// Length controls follow the workspace display units: decimal inches (up to three decimals) or whole millimetres.
export function mmToField(mm: number, units: DisplayUnits): string {
  return units === 'in' ? shortestInches(mm / MM_PER_INCH, text => fieldToMm(text, 'in') === mm) : String(Math.round(mm))
}

export function fieldToMm(text: string, units: DisplayUnits): number | null {
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) return null
  return Math.round(units === 'in' ? value * MM_PER_INCH : value)
}

// The elevation step is kept in hundredths of a millimetre: 0.75 in or 19.05 mm is 1905.
export function hundredthsToField(hundredths: number, units: DisplayUnits): string {
  return units === 'in'
    ? shortestInches(hundredths / 100 / MM_PER_INCH, text => fieldToHundredths(text, 'in') === hundredths)
    : String(Math.round(hundredths) / 100)
}

export function fieldToHundredths(text: string, units: DisplayUnits): number | null {
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) return null
  return Math.round(units === 'in' ? value * MM_PER_INCH * 100 : value * 100)
}
