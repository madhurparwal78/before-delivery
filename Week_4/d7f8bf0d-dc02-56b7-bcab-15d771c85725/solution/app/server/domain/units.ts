import type { DisplayUnits } from '../../shared/domain'
import { MM_PER_INCH } from '../../shared/units'

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

// Inch display rounds to the nearest eighth and reduces the fraction ("42 in", "3/4 in", "1 1/2 in").
function formatInches(mm: number): string {
  const eighths = Math.round((mm / MM_PER_INCH) * 8)
  const whole = Math.floor(eighths / 8)
  const remainder = eighths % 8
  if (remainder === 0) return `${whole} in`
  const divisor = gcd(remainder, 8)
  const fraction = `${remainder / divisor}/${8 / divisor}`
  return whole === 0 ? `${fraction} in` : `${whole} ${fraction} in`
}

export function formatLength(mm: number, units: DisplayUnits): string {
  if (units === 'in') return formatInches(mm)
  return `${Math.round(mm * 100) / 100} mm`
}

export function formatHundredthsLength(hundredthsMm: number, units: DisplayUnits): string {
  return formatLength(hundredthsMm / 100, units)
}
