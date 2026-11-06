// Units formatting. Display only; never changes a verdict.
export type Units = 'metric' | 'imperial';

export function formatLength(mm: number, units: Units): string {
  if (units === 'imperial') {
    const inches = mm / 25.4;
    return `${inches.toFixed(3)} in`;
  }
  return `${(mm / 10).toFixed(1)} mm`;
}

export function formatMass(kg: number, units: Units): string {
  if (units === 'imperial') {
    const lb = kg / 0.45359237;
    return `${lb.toFixed(1)} lb`;
  }
  return `${kg.toFixed(1)} kg`;
}
