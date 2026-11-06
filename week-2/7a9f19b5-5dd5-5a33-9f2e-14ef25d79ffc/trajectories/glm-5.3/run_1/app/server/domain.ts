/**
 * Shared domain rules: light-pool geometry, GST and money format.
 * Used by the server and by the browser build.
 */

/** Round-half-up to a whole number. */
export function round_half_up(value: number): number {
  return Math.floor(value + 0.5)
}

/** Pool diameter in mm, rounded half up. */
export function pool_diameter_mm(beam_deg: number, h_mm: number): number {
  return round_half_up(2 * h_mm * Math.tan((beam_deg * Math.PI) / 360))
}

/** Unrounded pool diameter in mm, used for the Q inclusion rule. */
export function pool_diameter_mm_exact(beam_deg: number, h_mm: number): number {
  return 2 * h_mm * Math.tan((beam_deg * Math.PI) / 360)
}

/** Lux directly below the fitting. */
export function own_lux(candela: number, h_mm: number): number {
  const h_m = h_mm / 1000
  return round_half_up(candela / (h_m * h_m))
}

export interface LuxContribution {
  candela: number
  x_mm: number
  y_mm: number
  beam_deg: number
}

/**
 * Centre lux of a placement: the sum of contributions from every placement,
 * including itself. A contributor counts only when its horizontal distance
 * is no more than half of its unrounded pool diameter.
 */
export function centre_lux(p: LuxContribution, all: LuxContribution[], h_mm: number): number {
  const h_m = h_mm / 1000
  let sum = 0
  for (const q of all) {
    const dx = q.x_mm - p.x_mm
    const dy = q.y_mm - p.y_mm
    const d = Math.sqrt(dx * dx + dy * dy)
    const limit = pool_diameter_mm_exact(q.beam_deg, h_mm) / 2
    if (d > limit) continue
    const cos = h_mm / Math.sqrt(h_mm * h_mm + d * d)
    sum += (q.candela * cos * cos * cos) / (h_m * h_m)
  }
  return round_half_up(sum)
}

/** GST on a subtotal, computed once per order: 15% rounded half up. */
export function gst_cents(subtotal_cents: number): number {
  return round_half_up(subtotal_cents * 0.15)
}

/** `$1,234.50` format from integer cents. */
export function money(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100)
  const frac = Math.abs(cents) % 100
  return `${cents < 0 ? '-' : ''}$${dollars.toLocaleString('en-NZ')}.${String(frac).padStart(2, '0')}`
}
