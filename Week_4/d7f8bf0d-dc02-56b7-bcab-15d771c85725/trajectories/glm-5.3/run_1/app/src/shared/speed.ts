/**
 * Scale speed (HO 1:87.1). One decision for the whole product:
 *   total = speed_mph * 16093440 + carry
 *   advance = floor(total / 3135600)
 *   carry = total mod 3135600
 */
export const SPEED_MICROMM_PER_MPH = 16093440;
export const SPEED_DIVISOR = 3135600;

export interface SpeedAdvance {
  advance: number;
  carry: number;
}

export function scaleSpeedAdvance(speed_mph: number, carry: number): SpeedAdvance {
  const total = speed_mph * SPEED_MICROMM_PER_MPH + carry;
  const advance = Math.floor(total / SPEED_DIVISOR);
  return { advance, carry: total % SPEED_DIVISOR };
}
