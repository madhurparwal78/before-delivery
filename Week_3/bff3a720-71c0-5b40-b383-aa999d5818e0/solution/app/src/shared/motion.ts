/** Published motion durations in milliseconds, by `data-motion` name. */
export const MOTION_MS = {
  "handle-snap": 160,
  "price-roll": 280,
  "shutter-reveal": 420,
  "swap-rotate": 280,
  "result-reveal": 240,
  "seat-fill": 280,
  "booking-confirm": 420,
  sheet: 280,
  "rating-reveal": 420,
  toast: 200,
} as const;

export type MotionName = keyof typeof MOTION_MS;
