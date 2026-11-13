/** round(a / b) on non-negative integers, half up. */
export const rnd = (a: number, b: number): number => Math.floor((2 * a + b) / (2 * b))

/** Minor units in one euro: prices typed in whole euros are stored in cents. */
export const EURO_MINOR = 100

export const MAX_ADULTS = 16

/** The most rooms one stay may take. */
export const MAX_ROOMS = 4

/** Splits ages into the pricing bands (12-17, 3-11, 0-2), each kept in input order. */
export const ageBands = (ages: readonly number[]): [number[], number[], number[]] => [
  ages.filter((age) => age >= 12),
  ages.filter((age) => age >= 3 && age < 12),
  ages.filter((age) => age < 3),
]

/** Booking room states that hold a stay, and the states of rooms that no longer count. */
export const ACTIVE_STATES: readonly string[] = ['confirmed', 'changed']
export const ENDED_STATES: readonly string[] = ['cancelled', 'expired']

export const isActive = (state: string): boolean => ACTIVE_STATES.includes(state)
export const isLive = (state: string): boolean => !ENDED_STATES.includes(state)

/** Whether a refund percentage is a full, a partial or no refund. */
export const refundKind = (pct: number): 'free' | 'partial' | 'none' => (pct === 100 ? 'free' : pct > 0 ? 'partial' : 'none')
