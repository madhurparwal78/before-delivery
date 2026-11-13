import { type Ml, roundMl } from './decimal.ts';
import { minutesBefore } from './time.ts';

/**
 * The one conversion rule. Every cap volume, turnout max volume and order rate
 * in the app is produced here, rounded once to three decimals, halves up.
 */

export interface CapInputs {
  tableCapMlDay: Ml;
  hours: number;
  restrictionCapMlDay: Ml | null;
  opensAt: Date;
  restrictionEffectiveAt: Date | null;
}

export function effectiveCap(tableCapMlDay: Ml, restrictionCapMlDay: Ml | null): Ml {
  if (restrictionCapMlDay === null) return tableCapMlDay;
  return restrictionCapMlDay < tableCapMlDay ? restrictionCapMlDay : tableCapMlDay;
}

export function capVolumeMl(inputs: CapInputs): Ml {
  const hours = BigInt(inputs.hours);
  if (inputs.restrictionCapMlDay === null || inputs.restrictionEffectiveAt === null) {
    return roundMl(inputs.tableCapMlDay * hours, 24n);
  }
  const before = BigInt(minutesBefore(inputs.opensAt, inputs.restrictionEffectiveAt));
  const after = hours * 60n - before;
  const capAfter = effectiveCap(inputs.tableCapMlDay, inputs.restrictionCapMlDay);
  return roundMl(inputs.tableCapMlDay * before + capAfter * after, 1440n);
}

/** A turnout's max volume for a window: its outlet limit over the window's hours. */
export function turnoutMaxVolumeMl(maxRateMlDay: Ml, hours: number): Ml {
  return roundMl(maxRateMlDay * BigInt(hours), 24n);
}

/** The rate an order of this volume runs at over the window's hours. */
export function orderRateMlDay(volumeMl: Ml, hours: number): Ml {
  return roundMl(volumeMl * 24n, BigInt(hours));
}
