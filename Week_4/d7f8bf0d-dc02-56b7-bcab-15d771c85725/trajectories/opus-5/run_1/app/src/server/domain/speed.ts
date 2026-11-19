const MM_PER_MILE = 16_093_440;
const HO_TICK_DIVISOR = 3_135_600; // 3600 ticks an hour times the 1:87.1 ratio

export interface Advance {
  advanceMm: number;
  carry: number;
}

/** Scale millimetres a train covers in one tick, with the remainder carried. */
export function advancePerTick(speedMph: number, carry: number): Advance {
  const total = speedMph * MM_PER_MILE + carry;
  return {
    advanceMm: Math.floor(total / HO_TICK_DIVISOR),
    carry: total % HO_TICK_DIVISOR,
  };
}
