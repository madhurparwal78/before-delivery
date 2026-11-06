/** Shared domain code used by the browser: money, light-pool geometry, copy. */

export function money(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100)
  const frac = Math.abs(cents) % 100
  return `${cents < 0 ? '-' : ''}$${dollars.toLocaleString('en-NZ')}.${String(frac).padStart(2, '0')}`
}

export function round_half_up(value: number): number {
  return Math.floor(value + 0.5)
}

export function pool_diameter_mm(beam_deg: number, h_mm: number): number {
  return round_half_up(2 * h_mm * Math.tan((beam_deg * Math.PI) / 360))
}

export function pool_diameter_mm_exact(beam_deg: number, h_mm: number): number {
  return 2 * h_mm * Math.tan((beam_deg * Math.PI) / 360)
}

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

export function gst_cents(subtotal_cents: number): number {
  return round_half_up(subtotal_cents * 0.15)
}

/** Lighting dial bands from the viewer's local hour. */
export function auto_light_state(hour: number): 'morning' | 'day' | 'evening' | 'night' {
  if (hour >= 5 && hour <= 10) return 'morning'
  if (hour >= 11 && hour <= 16) return 'day'
  if (hour >= 17 && hour <= 20) return 'evening'
  return 'night'
}

export const LIGHT_STATES = ['morning', 'day', 'evening', 'night', 'gallery'] as const
export type LightState = (typeof LIGHT_STATES)[number]
export type DialMode = 'auto' | LightState

export function reduced_motion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Colour of the pool tint for a colour temperature. */
export function cct_tint(cct_k: number): string {
  if (cct_k <= 2700) return 'rgba(232, 163, 61, 0.55)'
  if (cct_k <= 3000) return 'rgba(245, 220, 170, 0.5)'
  return 'rgba(184, 196, 216, 0.5)'
}
