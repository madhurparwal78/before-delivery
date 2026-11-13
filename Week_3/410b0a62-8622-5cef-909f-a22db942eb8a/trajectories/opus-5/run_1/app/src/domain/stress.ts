const ROLLING_WINDOW = 30;

/** 30-sample trailing mean, each mean to the 4th power, averaged, 4th root. */
function normalise(samples: readonly number[]): number {
  if (samples.length < ROLLING_WINDOW) {
    return samples.reduce((total, value) => total + value, 0) / samples.length;
  }
  let window = 0;
  for (let index = 0; index < ROLLING_WINDOW; index += 1) window += samples[index] as number;
  let quartics = (window / ROLLING_WINDOW) ** 4;
  let count = 1;
  for (let index = ROLLING_WINDOW; index < samples.length; index += 1) {
    window += (samples[index] as number) - (samples[index - ROLLING_WINDOW] as number);
    quartics += (window / ROLLING_WINDOW) ** 4;
    count += 1;
  }
  return (quartics / count) ** 0.25;
}

export function normalisedPower(powerSamples: readonly number[]): number {
  return normalise(powerSamples);
}

export function normalisedSpeed(speedSamples: readonly number[]): number {
  return normalise(speedSamples);
}

export function speedFromPace(paceSPerKm: number): number {
  return 1000 / paceSPerKm;
}

export function paceFromSpeed(speedMps: number): number {
  return 1000 / speedMps;
}

export interface Score {
  if: number;
  tss: number;
}

/** Bike stress from normalised power against the FTP in force. */
export function scoreBike(durationS: number, npW: number, ftpW: number): Score {
  const intensity = npW / ftpW;
  return { if: intensity, tss: ((durationS * npW * intensity) / (ftpW * 3600)) * 100 };
}

/** Run stress from normalised speed against the threshold pace in force. */
export function scoreRun(durationS: number, nsMps: number, thresholdPaceSPerKm: number): Score {
  const intensity = nsMps / speedFromPace(thresholdPaceSPerKm);
  return { if: intensity, tss: (durationS / 3600) * intensity ** 2 * 100 };
}
